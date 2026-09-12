import {randomBytes} from 'node:crypto';
import {APIError,type PrivyClient} from '@privy-io/node';
import {createPublicClient,http,erc20Abi,encodeFunctionData,parseEventLogs,parseAbi,type Address,type Hash,type TransactionReceipt} from 'viem';
import {base} from 'viem/chains';
import {entryPoint06Address,entryPoint07Address,entryPoint08Address,entryPoint09Address} from 'viem/account-abstraction';
import {PAYMENT_ASSET,RWA_ASSETS,SWAP_INPUTS,assetUnits} from '../assets';
import type {Identity,WalletService,WalletAuthorization} from '../types';
import type {AdminAccessService} from './service';
import {SlotError} from '../slot/errors';
import {definiteSendFailure,transactionError,type GasToken} from '../slot/gas';
import type {SubmittedSpin} from '../slot/engine';
import {createWriteCoordinator,type WriteCoordinator} from './write-coordinator';
import {createLifiClient,LIFI_ROUTER,lifiEventAbi,type LifiQuote,type SwapIntent} from './lifi';

type Stage='quoted'|'submitting'|'pending'|'approved'|'succeeded'|'failed'|'rejected'|'uncertain'|'expired';
type Step='approval'|'swap';
type Operation={id:string;userId:string;walletId:string;address:Address;assetId:string;inputAssetId:string;expiresAt:number;stage:Stage;step:Step;intent:SwapIntent;quote:LifiQuote;submission?:SubmittedSpin;fromBlock?:string;gasToken?:GasToken;output?:string;error?:string};
export type SwapView={id:string;address:string;assetId:string;inputAssetId:string;expiresAt:number;stage:Stage;step:Step;input:string;estimated:string;minimum:string;gasEstimate:string;feeAmount:string;route:string;gasToken:GasToken|null;actionId:string|null;userOperationHash:string|null;fromBlock:string|null;output:string|null;hashes:string[];error:string|null};
export type SwapChain={blockNumber:()=>Promise<bigint>;userOperation:(hash:Hash,address:Address,fromBlock:bigint)=>Promise<{hash?:Hash;success?:boolean;nextBlock:bigint}>;allowance:(address:Address)=>Promise<bigint>;balance:(address:Address,inputId:string)=>Promise<bigint>;receipt:(hash:Hash)=>Promise<TransactionReceipt|null>;transaction:(hash:Hash)=>Promise<{from:Address;to:Address|null;input:`0x${string}`}>};
const userOperationEvent=parseAbi(['event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)'])[0];
const entryPoints=[entryPoint06Address,entryPoint07Address,entryPoint08Address,entryPoint09Address];
export function createSwapChain(rpcUrl='https://base-rpc.publicnode.com'):SwapChain {
  const client=createPublicClient({chain:base,transport:http(rpcUrl,{timeout:15000,retryCount:1})});
  async function check(){if(await client.getChainId()!==8453)throw new SlotError('Chain','The RPC node is not on Base.',503);}
  return {
    async blockNumber(){await check();return client.getBlockNumber({cacheTime:0});},
    async userOperation(hash,address,fromBlock){
      await check();const head=await client.getBlockNumber({cacheTime:0});
      if(fromBlock>head)return {nextBlock:fromBlock};
      const toBlock=head<fromBlock+1999n?head:fromBlock+1999n;
      const events=await client.getLogs({address:entryPoints,event:userOperationEvent,args:{userOpHash:hash,sender:address},fromBlock,toBlock,strict:true});
      const event=events[0];
      // Overlap recent blocks while polling, and cap RPC ranges for long-lived operations.
      return {hash:event?.transactionHash,success:event?.args.success,nextBlock:toBlock>2n?toBlock-2n:0n};
    },
    async allowance(address){await check();return client.readContract({address:PAYMENT_ASSET.address,abi:erc20Abi,functionName:'allowance',args:[address,LIFI_ROUTER]});},
    async balance(address,inputId){await check();return inputId==='eth'?client.getBalance({address,blockTag:'pending'}):client.readContract({address:PAYMENT_ASSET.address,abi:erc20Abi,functionName:'balanceOf',args:[address]});},
    async receipt(hash){await check();try{return await client.getTransactionReceipt({hash});}catch(error){if((error as Error).name==='TransactionReceiptNotFoundError')return null;throw error;}},
    async transaction(hash){await check();return client.getTransaction({hash});},
  };
}
export function swapError(error:unknown) {
  if(error instanceof SlotError)return error;
  if(error instanceof APIError)return new SlotError('SwapPrivy',transactionError(error),[400,401,403,422].includes(error.status||0)?error.status!:503);
  return new SlotError('SwapProvider','Status cannot be verified. Refresh before repeating the operation.',503);
}
export function createSwapService({client,walletService,admin,chain=createSwapChain(),getQuote=createLifiClient(),coordinator=createWriteCoordinator(),now=Date.now}:{client:PrivyClient;walletService:WalletService;admin:AdminAccessService;chain?:SwapChain;getQuote?:(intent:SwapIntent)=>Promise<LifiQuote>;coordinator?:WriteCoordinator;now?:()=>number}) {
  const operations=new Map<string,Operation>();
  const terminal=(op:Operation)=>['approved','succeeded','failed','rejected','expired'].includes(op.stage);
  function view(op:Operation):SwapView{return {id:op.id,address:op.address,assetId:op.assetId,inputAssetId:op.inputAssetId,expiresAt:op.expiresAt,stage:op.stage,step:op.step,input:op.quote.input,estimated:op.quote.estimated,minimum:op.quote.minimum,gasEstimate:op.quote.gasEstimate,feeAmount:op.quote.feeAmount,route:op.quote.route,gasToken:op.submission?.gasToken||op.gasToken||null,actionId:op.submission?.transactionId||null,userOperationHash:op.submission?.userOperationHash||null,fromBlock:op.fromBlock||null,output:op.output||null,hashes:op.submission?.hash?[op.submission.hash]:[],error:op.error||null};}
  async function access(user:Identity,write=false){const value=await admin.resolve(user);if(write&&value.role!=='owner'&&!value.swapEnabled)throw new SlotError('SwapAccess','The owner must update your permissions in the pagina Wallet admin per abilitare LI.FI.',403);return value;}
  async function resolveSubmission(walletId:string,submission:SubmittedSpin,address:Address,fromBlock?:string,onProgress?:(block:string)=>void){
    if(submission.transactionId){
      const tx=await client.transactions().get(submission.transactionId);
      if(tx.wallet_id!==walletId||tx.caip2!=='eip155:8453')throw new SlotError('SwapAccess','Transaction does not match the shared wallet.',403);
      if(tx.user_operation_hash&&/^0x[\da-f]{64}$/i.test(tx.user_operation_hash))submission.userOperationHash=tx.user_operation_hash as Hash;
      if(['execution_reverted','failed'].includes(tx.status))throw new SlotError('TransactionFailed','The transaction failed. Gas already spent is not refunded.',409);
      if(tx.transaction_hash&&/^0x[\da-f]{64}$/i.test(tx.transaction_hash))submission.hash=tx.transaction_hash as Hash;
      if(tx.status==='replaced'&&!submission.hash)throw new SlotError('SwapPending','Transaction replaced: wait for the new reference before retrying.',409);
    }
    if(!submission.hash&&submission.userOperationHash&&fromBlock){
      const event=await chain.userOperation(submission.userOperationHash,address,BigInt(fromBlock));
      if(event.hash){submission.hash=event.hash;if(event.success===false)throw new SlotError('TransactionFailed','The USDC-gas operation was reverted onchain.',409);}
      else onProgress?.(event.nextBlock.toString());
    }
    const receipt=submission.hash?await chain.receipt(submission.hash):null;
    if(receipt&&submission.userOperationHash){
      const events=parseEventLogs({abi:[userOperationEvent],eventName:'UserOperationEvent',logs:receipt.logs.filter(log=>entryPoints.some(entry=>entry.toLowerCase()===log.address.toLowerCase())),strict:true}).filter(event=>event.args.userOpHash.toLowerCase()===submission.userOperationHash!.toLowerCase()&&event.args.sender.toLowerCase()===address.toLowerCase());
      if(events.length!==1)throw new SlotError('SwapReceipt','The Privy operation receipt cannot be verified yet.',409);
      if(!events[0].args.success)throw new SlotError('TransactionFailed','The USDC-gas operation was reverted onchain.',409);
    }
    return receipt;
  }
  function result(receipt:TransactionReceipt,address:string,quote?:LifiQuote){
    return parseEventLogs({abi:lifiEventAbi,eventName:'LiFiGenericSwapCompleted',logs:receipt.logs.filter(log=>log.address.toLowerCase()===LIFI_ROUTER.toLowerCase()),strict:true})
      .filter(event=>event.args.receiver.toLowerCase()===address.toLowerCase()&&(!quote||event.args.transactionId.toLowerCase()===quote.transactionId.toLowerCase()));
  }
  async function reconcile(op:Operation){
    if(terminal(op)||!op.submission)return terminal(op);
    try{
      const receipt=await resolveSubmission(op.walletId,op.submission,op.address,op.fromBlock,block=>{op.fromBlock=block;});if(!receipt)return false;
      if(receipt.status==='reverted')throw new SlotError('TransactionFailed','Transaction reverted onchain. The swap was not completed.',409);
      if(op.step==='approval'){op.stage='approved';}
      else {
        const matches=result(receipt,op.address,op.quote);
        if(matches.length!==1)throw new SlotError('SwapReceipt','Receipt without a verifiable LI.FI result. Check the transaction before retrying.',409);
        const event=matches[0].args;
        if(event.fromAssetId.toLowerCase()!==op.intent.inputAsset.address.toLowerCase()||event.toAssetId.toLowerCase()!==op.intent.outputAsset.address.toLowerCase()||event.fromAmount!==BigInt(op.intent.amount)||event.toAmount<BigInt(op.quote.minimum))throw new SlotError('SwapReceipt','The LI.FI result requires manual verification.',409);
        op.stage='succeeded';op.output=event.toAmount.toString();
      }
    }catch(error){if(error instanceof SlotError&&error.code==='TransactionFailed'){op.stage='failed';op.error=error.message;}else throw error;}
    if(terminal(op))coordinator.release(op.walletId,op.id);return terminal(op);
  }
  return {
    async quote(user:Identity,assetId:unknown,amount:unknown,inputAssetId:unknown='usdc'){
      const {wallet}=await access(user,true),asset=RWA_ASSETS.find(a=>a.id===assetId),inputAsset=SWAP_INPUTS.find(a=>a.id===inputAssetId);
      if(!asset||!inputAsset)throw new SlotError('SwapAsset','Choose USDC or ETH as input and one of the six prize tokens as output.',400);
      let baseAmount:string;try{baseAmount=assetUnits(amount,inputAsset.decimals).toString();}catch(e){throw new SlotError('SwapAmount',(e as Error).message,400);}
      for(const [id,op]of operations)if(op.expiresAt<=now()&&(op.stage==='quoted'||terminal(op)))operations.delete(id);
      if(operations.size>=256)throw new SlotError('SwapBusy','Too many pending requests.',503);
      const intent:SwapIntent={address:wallet.address as Address,inputAsset,outputAsset:asset,amount:baseAmount};
      const [quote,allowance,balance]=await Promise.all([getQuote(intent),inputAsset.id==='usdc'?chain.allowance(intent.address):Promise.resolve(0n),chain.balance(intent.address,inputAsset.id)]);
      if(balance<BigInt(baseAmount))throw new SlotError('SwapBalance','Insufficient '+inputAsset.ticker+' balance for this amount.',400);
      const op:Operation={id:randomBytes(32).toString('hex'),userId:user.userId,walletId:wallet.id,address:intent.address,assetId:asset.id,inputAssetId:inputAsset.id,expiresAt:now()+30000,stage:'quoted',step:inputAsset.id==='usdc'&&allowance<BigInt(baseAmount)?'approval':'swap',intent,quote};operations.set(op.id,op);return view(op);
    },
    async execute(user:Identity,authorization:WalletAuthorization,id:unknown,confirm:unknown){
      const {wallet}=await access(user,true),op=typeof id==='string'?operations.get(id):undefined;
      if(!op||op.userId!==user.userId||op.walletId!==wallet.id)throw new SlotError('SwapUnknown','Quote expired or unavailable. Check any transactions already sent first.',404);
      if(confirm!==true)throw new SlotError('Consent','Confirm the operation before sending.',400);
      if(op.stage!=='quoted'){await reconcile(op);return view(op);}
      if(op.expiresAt<=now()){op.stage='expired';throw new SlotError('SwapExpired','Quote expired. Request a new one.',409);}
      op.stage='submitting';let sending=false;
      try {
        await coordinator.acquire(wallet.id,op.id,()=>reconcile(op));
        if(!walletService.sendOwned)throw new SlotError('Config','Privy sending not configured.',503);
        if(await chain.balance(op.address,op.inputAssetId)<BigInt(op.intent.amount))throw new SlotError('SwapBalance','Insufficient balance for the swap.',400);
        const allowance=op.inputAssetId==='usdc'?await chain.allowance(op.address):0n;
        if(op.step==='approval'&&allowance>=BigInt(op.intent.amount)){op.stage='approved';coordinator.release(wallet.id,op.id);return view(op);}
        if(op.step==='swap'&&op.inputAssetId==='usdc'&&allowance<BigInt(op.intent.amount))throw new SlotError('SwapAllowance','The USDC approval changed. Request a new quote.',409);
        if(op.step==='swap'){
          const fresh=await getQuote(op.intent);
          if(BigInt(fresh.minimum)<BigInt(op.quote.minimum))throw new SlotError('SwapPriceChanged','The minimum received dropped. Request a new quote and confirm it.',409);
          op.quote=fresh;
        }
        const assertAccess=async()=>{const current=await access(user,true);if(current.wallet.id!==wallet.id)throw new SlotError('AdminAccess','The shared wallet changed.',403);if(op.expiresAt<=now())throw new SlotError('Cancelled','Quote expired before sending. Request a new one.',409);};
        op.fromBlock=(await chain.blockNumber()).toString();
        await assertAccess();
        const transaction=op.step==='approval'?{to:PAYMENT_ASSET.address,data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[LIFI_ROUTER,BigInt(op.intent.amount)]}),value:'0x0' as const}:op.quote.transaction;
        sending=true;
        op.submission=await walletService.sendOwned(wallet,authorization,{...transaction,chainId:8453},op.id+':'+op.step,'usdc',token=>{op.gasToken=token;},assertAccess);
        if(!op.submission.hash&&!op.submission.transactionId&&!op.submission.userOperationHash)throw new Error('Missing transaction reference');
        op.stage='pending';
      }catch(error){
        const definite=!sending||definiteSendFailure(error);
        op.stage=definite?'rejected':'uncertain';op.error=definite?swapError(error).message:'Invio da verificare: la richiesta potrebbe essere stata accettata. Non ripeterla.';
        if(definite)coordinator.release(wallet.id,op.id);
      }
      return view(op);
    },
    async status(user:Identity,id:string|null,actionId:string|null,hash:string|null=null,userOperationHash:string|null=null,fromBlock:string|null=null):Promise<SwapView>{
      const {wallet}=await access(user),op=id?operations.get(id):undefined;
      if(op&&op.walletId===wallet.id){await reconcile(op);return view(op);}
      // Recovery is read-only. Privy scopes transaction IDs; direct ETH hashes require sender verification.
      const submission:SubmittedSpin={};
      if(actionId&&/^[a-zA-Z0-9_-]{8,128}$/.test(actionId))submission.transactionId=actionId;
      else if(userOperationHash&&/^0x[\da-f]{64}$/i.test(userOperationHash)&&fromBlock&&/^\d{1,20}$/.test(fromBlock))submission.userOperationHash=userOperationHash as Hash;
      else if(hash&&/^0x[\da-f]{64}$/i.test(hash)){
        const tx=await chain.transaction(hash as Hash);if(tx.from.toLowerCase()!==wallet.address.toLowerCase())throw new SlotError('SwapAccess','Transaction does not belong to the shared wallet.',403);submission.hash=hash as Hash;
      }else throw new SlotError('SwapUnknown','Reference not recoverable after the restart. Check the wallet transactions on BaseScan and Privy before a new swap.',404);
      const recover=async():Promise<SwapView>=>{
      const empty:SwapView={id:id||actionId||hash||userOperationHash!,address:wallet.address,assetId:'',inputAssetId:'usdc',expiresAt:0,stage:'pending',step:'swap',input:'0',estimated:'0',minimum:'0',gasEstimate:'0',feeAmount:'0',route:'LI.FI',gasToken:null,actionId:submission.transactionId||null,userOperationHash:submission.userOperationHash||null,fromBlock,hashes:submission.hash?[submission.hash]:[],output:null,error:null};
      let receipt:TransactionReceipt|null;
      try{receipt=await resolveSubmission(wallet.id,submission,wallet.address as Address,fromBlock||undefined,block=>{fromBlock=block;});}catch(error){if(error instanceof SlotError&&error.code==='TransactionFailed')return {...empty,stage:'failed',error:error.message};throw error;}
      empty.fromBlock=fromBlock;
      empty.hashes=submission.hash?[submission.hash]:[];
      if(!receipt)return empty;
      if(receipt.status==='reverted')return {...empty,stage:'failed',error:'Transazione annullata onchain.'};
      const events=result(receipt,wallet.address);
      if(events.length===1){const event=events[0].args,asset=RWA_ASSETS.find(a=>a.address.toLowerCase()===event.toAssetId.toLowerCase()),input=SWAP_INPUTS.find(a=>a.address.toLowerCase()===event.fromAssetId.toLowerCase());if(asset&&input)return {...empty,stage:'succeeded',assetId:asset.id,inputAssetId:input.id,input:event.fromAmount.toString(),output:event.toAmount.toString()};}
      const approvals=parseEventLogs({abi:erc20Abi,eventName:'Approval',logs:receipt.logs.filter(l=>l.address.toLowerCase()===PAYMENT_ASSET.address.toLowerCase()),strict:true}).filter(e=>e.args.owner.toLowerCase()===wallet.address.toLowerCase()&&e.args.spender.toLowerCase()===LIFI_ROUTER.toLowerCase());
      if(approvals.length)return {...empty,stage:'approved',step:'approval'};
      throw new SlotError('SwapReceipt','The receipt does not contain a recognizable LI.FI swap or approval. Verify manually.',409);
      };
      const recovered=await recover();
      if(recovered.stage==='pending')await coordinator.acquire(wallet.id,recovered.id,async()=>{const value=await recover();return ['approved','succeeded','failed'].includes(value.stage);});
      else coordinator.release(wallet.id,recovered.id);
      return recovered;
    },
  };
}
