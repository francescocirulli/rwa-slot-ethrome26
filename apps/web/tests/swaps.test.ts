import test from 'node:test';
import assert from 'node:assert/strict';
import {APIError,type PrivyClient} from '@privy-io/node';
import {encodeFunctionData,decodeFunctionData,encodeEventTopics,encodeAbiParameters,erc20Abi,toHex,type Address,type Hash,type TransactionReceipt} from 'viem';
import type {Identity,WalletService} from '../lib/types';
import {PAYMENT_ASSET,ETH_ASSET,RWA_ASSETS,SWAP_INPUTS,assetUnits} from '../lib/assets';
import {createSwapService,type SwapChain} from '../lib/admin/swaps';
import {createWriteCoordinator} from '../lib/admin/write-coordinator';
import {createAssetsHandler} from '../lib/admin/assets-api';
import {validateLifiQuote,createLifiClient,lifiSwapAbi,lifiEventAbi,LIFI_ROUTER,LIFI_INTEGRATOR,type SwapIntent} from '../lib/admin/lifi';
import {sendWithGas} from '../lib/slot/gas';
import {SlotError} from '../lib/slot/errors';
const address='0x0000000000000000000000000000000000000099' as Address;
const wallet={id:'shared0001',address};
const owner:Identity={userId:'did:privy:owner',wallets:[]},other:Identity={userId:'did:privy:other',wallets:[]};
const router='0x0000000000000000000000000000000000000088' as Address;
const txHash=('0x'+'1'.repeat(64)) as Hash,quoteId=('0x'+'2'.repeat(64)) as Hash;
function rawQuote(intent:SwapIntent,price='1000000'){
  const native=intent.inputAsset.id==='eth';
  const swap={callTo:router,approveTo:router,sendingAssetId:intent.inputAsset.address,receivingAssetId:intent.outputAsset.address,fromAmount:BigInt(intent.amount),callData:'0x11223344' as const,requiresDeposit:true};
  return {tool:'fixture',action:{fromChainId:8453,toChainId:8453,fromToken:{address:intent.inputAsset.address,decimals:intent.inputAsset.decimals},toToken:{address:intent.outputAsset.address,decimals:intent.outputAsset.decimals},fromAddress:intent.address,toAddress:intent.address,fromAmount:intent.amount,slippage:0.005},estimate:{fromAmount:intent.amount,toAmount:price,toAmountMin:price,approvalAddress:LIFI_ROUTER,gasCosts:[{amount:'100',token:{address:ETH_ASSET.address,chainId:8453}}],feeCosts:[]},transactionRequest:{from:intent.address,to:LIFI_ROUTER,chainId:8453,value:toHex(native?BigInt(intent.amount):0n),data:encodeFunctionData({abi:lifiSwapAbi,functionName:native?'swapTokensSingleV3NativeToERC20':'swapTokensSingleV3ERC20ToERC20',args:[quoteId,LIFI_INTEGRATOR,'',intent.address,BigInt(price),swap]})}};
}
function swapReceipt(intent:SwapIntent,price='1000000',recipient:Address=address):TransactionReceipt{
  const topics=encodeEventTopics({abi:lifiEventAbi,eventName:'LiFiGenericSwapCompleted',args:{transactionId:quoteId}});
  const data=encodeAbiParameters([{type:'string'},{type:'string'},{type:'address'},{type:'address'},{type:'address'},{type:'uint256'},{type:'uint256'}],[LIFI_INTEGRATOR,'',recipient,intent.inputAsset.address,intent.outputAsset.address,BigInt(intent.amount),BigInt(price)]);
  return {status:'success',logs:[{address:LIFI_ROUTER,topics,data}]} as unknown as TransactionReceipt;
}
function fixture(){
  let now=10000,authorized=true,swapEnabled=true,price='1000000',allowance=1000000000n,balance=10n**25n,fail:unknown,wait:Promise<void>|undefined,receipt:TransactionReceipt|null=null,shortGas=false,revokeOnSend=false;
  const sent:any[]=[],quotes:SwapIntent[]=[],transactions=new Map<string,any>(),coordinator=createWriteCoordinator();
  const admin={resolve:async(user:Identity)=>{if(!authorized||!['did:privy:owner','did:privy:other'].includes(user.userId))throw new SlotError('AdminAccess','Forbidden',403);return{wallet,role:user.userId===owner.userId?'owner' as const:'operator' as const,operationsEnabled:true,swapEnabled};},assertAction:async()=>{throw new Error('Unused');}};
  const client={transactions:()=>({get:async(id:string)=>transactions.get(id)})} as unknown as PrivyClient;
  const walletService={sendOwned:async(w:any,token:any,transaction:any,key:any,mode:any,onGasToken:any,assertValid:any)=>sendWithGas({mode,key,onGasToken,assertValid,send:async(gas)=>{
    sent.push({wallet:w,token,transaction,key,gas});if(wait)await wait;
    if(revokeOnSend)authorized=false;
    if(shortGas&&gas.sponsor)throw new APIError(400,{error:'Insufficient USDC balance to cover gas'},'Rejected',new Headers());
    if(fail)throw fail;
    const id='transaction_'+sent.length;transactions.set(id,{id,wallet_id:wallet.id,caip2:'eip155:8453',status:'pending',transaction_hash:null});return {transactionId:id};
  }})} as unknown as WalletService;
  const chain:SwapChain={blockNumber:async()=>100n,userOperation:async()=>({nextBlock:100n}),allowance:async()=>allowance,balance:async()=>balance,receipt:async()=>receipt,transaction:async()=>({from:address,to:LIFI_ROUTER,input:'0x'})};
  const getQuote=async(intent:SwapIntent)=>{quotes.push(intent);return validateLifiQuote(rawQuote(intent,price),intent);};
  const deps={client,walletService,admin,coordinator,chain,getQuote,now:()=>now};
  const service=createSwapService(deps);
  return {service,deps,client,admin,coordinator,sent,quotes,transactions,expire:()=>{now+=31000;},revoke:()=>{authorized=false;},permissions:()=>{swapEnabled=false;},price:()=>{price='900000';},allowance:(v:bigint)=>{allowance=v;},balance:(v:bigint)=>{balance=v;},fail:(e:unknown=new Error('Network timeout'))=>{fail=e;},wait:(p:Promise<void>)=>{wait=p;},shortGas:()=>{shortGas=true;},revokeOnSend:()=>{revokeOnSend=true;},confirm:(id:string,step='swap',recipient:Address=address)=>{transactions.get(id).transaction_hash=txHash;transactions.get(id).status='confirmed';receipt=step==='approval'?{status:'success',logs:[]} as unknown as TransactionReceipt:swapReceipt(quotes.at(-1)!,price,recipient);},receipt:(r:TransactionReceipt)=>{receipt=r;}};
}
test('asset units reject rounding, exponent notation and nonpositive amounts; USDC and ETH inputs',()=>{
  assert.equal(RWA_ASSETS.length,6);assert.deepEqual(SWAP_INPUTS.map(a=>a.id),['usdc','eth']);assert.equal(assetUnits('1.23456789',8),123456789n);
  assert.equal(assetUnits('0.000000000000000001',18),1n);
  for(const input of ['1.0000001','1e6','-1','0','NaN','01'])assert.throws(()=>assetUnits(input,6));
});
test('LI.FI quote validates chain, calldata, recipient, input budget, token pair and minimum independently of metadata',()=>{
  const intent={address,inputAsset:PAYMENT_ASSET,outputAsset:RWA_ASSETS[0],amount:'10000000'};
  const valid=rawQuote(intent);assert.equal(validateLifiQuote(valid,intent).input,'10000000');
  for(const mutate of [(q:any)=>q.transactionRequest.to=address,(q:any)=>q.transactionRequest.chainId=1,(q:any)=>q.transactionRequest.value='0x1',(q:any)=>q.action.toAddress=router,(q:any)=>q.action.fromAmount='1',(q:any)=>q.estimate.approvalAddress=router,(q:any)=>q.estimate.toAmountMin='1',(q:any)=>q.transactionRequest.data+='00',(q:any)=>q.action.fromToken.decimals=18]){
    const q=structuredClone(valid);mutate(q);assert.throws(()=>validateLifiQuote(q,intent));
  }
  for(const alter of [(a:any)=>a[3]=router,(a:any)=>a[5].fromAmount=20n,(a:any)=>a[5].sendingAssetId=router,(a:any)=>a[5].receivingAssetId=router,(a:any)=>a[5].requiresDeposit=false,(a:any)=>a[5].callTo=address]){
    const q=structuredClone(valid),d=decodeFunctionData({abi:lifiSwapAbi,data:q.transactionRequest.data});const args=structuredClone(d.args);alter(args);q.transactionRequest.data=encodeFunctionData({abi:lifiSwapAbi,functionName:d.functionName,args:args as never});assert.throws(()=>validateLifiQuote(q,intent));
  }
});
test('LI.FI client fixes network, wallet and slippage; rejects error responses and does not expose provider messages',async()=>{
  const intent={address,inputAsset:ETH_ASSET,outputAsset:RWA_ASSETS[0],amount:'1000000000000000'};
  const get=createLifiClient(async(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,'https://li.quest');for(const [key,value]of Object.entries({fromChain:'8453',toChain:'8453',fromToken:ETH_ASSET.address,toAddress:address,fromAddress:address,slippage:'0.005'}))assert.equal(url.searchParams.get(key),value);assert.equal(init?.cache,'no-store');return Response.json(rawQuote(intent));});
  assert.equal((await get(intent)).transaction.value,toHex(BigInt(intent.amount)));
  await assert.rejects(createLifiClient(async()=>Response.json({message:'untrusted secret provider response'},{status:400}))(intent),error=>{assert.ok(!String(error).includes('untrusted'));return true;});
});
test('both admins execute exactly once; identity binding and shared wallet gas USDC',async()=>{
  for(const actor of [owner,other]){
    const f=fixture(),q=await f.service.quote(actor,'nvidia','12.5');assert.equal(q.step,'swap');assert.equal(f.sent.length,0);
    await assert.rejects(f.service.execute(actor===owner?other:owner,'other-id',q.id,true));await assert.rejects(f.service.execute(actor,'identity-token',q.id,false));
    let release!:()=>void;f.wait(new Promise<void>(r=>{release=r;}));const first=f.service.execute(actor,'identity-token',q.id,true);await new Promise(r=>setImmediate(r));assert.equal((await f.service.execute(actor,'identity-token',q.id,true)).stage,'submitting');release();const result=await first;
    assert.equal(result.stage,'pending');assert.equal(f.sent.length,1);const sent=f.sent[0];assert.equal(sent.wallet.id,wallet.id);assert.equal(sent.token,'identity-token');assert.equal(sent.transaction.to,LIFI_ROUTER);assert.equal(sent.transaction.value,'0x0');assert.equal(sent.transaction.chainId,8453);assert.deepEqual(sent.gas.sponsor_options,{asset:'usdc'});assert.ok(!JSON.stringify(result).includes('identity-token'));
    assert.equal((await f.service.status(other,q.id,null)).stage,'pending');f.confirm(result.actionId!);assert.equal((await f.service.status(other,q.id,null)).output,'1000000');
    const restarted=createSwapService(f.deps);assert.equal((await restarted.status(other,q.id,result.actionId)).stage,'succeeded');
    f.transactions.get(result.actionId!)!.wallet_id='other-wallet';await assert.rejects(restarted.status(other,q.id,result.actionId));
  }
});
test('USDC approval has the exact allowance and never reports swap success or submits a swap automatically',async()=>{
  const f=fixture();f.allowance(0n);const q=await f.service.quote(other,'gold','3.123456');assert.equal(q.step,'approval');
  const op=await f.service.execute(other,'id-token',q.id,true),sent=f.sent[0];
  const decoded=decodeFunctionData({abi:erc20Abi,data:sent.transaction.data});assert.equal(decoded.functionName,'approve');assert.deepEqual(decoded.args,[LIFI_ROUTER,3123456n]);assert.equal(sent.transaction.to,PAYMENT_ASSET.address);
  f.confirm(op.actionId!,'approval');const done=await f.service.status(owner,q.id,null);assert.equal(done.stage,'approved');assert.equal(done.output,null);assert.equal(f.sent.length,1);
  await f.service.execute(other,'id-token',q.id,true);assert.equal(f.sent.length,1);await f.coordinator.acquire(wallet.id,'deposit',async()=>true);
});
test('ETH input uses native value, skips approval, and falls back to ETH gas only on definitive USDC shortage',async()=>{
  const f=fixture();f.allowance(0n);f.shortGas();const q=await f.service.quote(other,'gold','0.004000000000000001','eth');assert.equal(q.step,'swap');assert.equal(q.input,'4000000000000001');
  const result=await f.service.execute(other,'identity-token',q.id,true);assert.equal(result.gasToken,'ETH');assert.equal(f.sent.length,2);assert.equal(f.sent[0].transaction.value,toHex(4000000000000001n));assert.deepEqual(f.sent[0].transaction,f.sent[1].transaction);assert.equal(f.sent[1].gas.sponsor,false);assert.notEqual(f.sent[0].gas.idempotency_key,f.sent[1].gas.idempotency_key);
  f.confirm(result.actionId!);assert.equal((await f.service.status(owner,q.id,null)).stage,'succeeded');
});
test('uncertain and provider policy failures never trigger gas fallback; uncertain requests block competing writes',async()=>{
  for(const error of [new Error('Network timeout'),new APIError(403,{error:'Denied'},'Denied',new Headers())]){
    const f=fixture();const q=await f.service.quote(other,'nvidia','1');f.fail(error);const result=await f.service.execute(other,'identity',q.id,true);assert.equal(result.stage,error instanceof APIError?'rejected':'uncertain');
    await f.service.execute(other,'identity',q.id,true);assert.equal(f.sent.length,1);if(!(error instanceof APIError))await assert.rejects(f.coordinator.acquire(wallet.id,'deposit',async()=>true));
  }
});
test('revocation between fee attempts prevents ETH fallback',async()=>{
  const f=fixture();f.shortGas();f.revokeOnSend();const q=await f.service.quote(other,'nvidia','1');assert.equal((await f.service.execute(other,'identity',q.id,true)).stage,'rejected');assert.equal(f.sent.length,1);
});
test('expiry, worse prices, unavailable balance and permissions block sends',async()=>{
  const f=fixture();await assert.rejects(f.service.quote(owner,'arbitrary','1'));await assert.rejects(f.service.quote(owner,'gold','1','arbitrary'));
  const q=await f.service.quote(owner,'gold','1');f.price();assert.equal((await f.service.execute(owner,'identity',q.id,true)).stage,'rejected');assert.equal(f.sent.length,0);
  const q2=await f.service.quote(owner,'gold','1');f.expire();await assert.rejects(f.service.execute(owner,'identity',q2.id,true));
  const q3=await f.service.quote(other,'gold','1');f.permissions();await assert.rejects(f.service.execute(other,'identity',q3.id,true));await assert.rejects(f.service.quote(other,'gold','1'));
  f.balance(0n);await assert.rejects(f.service.quote(owner,'gold','1'));assert.equal(f.sent.length,0);
});
test('pending contract write prevents swap; reverted receipts release the shared coordinator',async()=>{
  const f=fixture();let done=false;await f.coordinator.acquire(wallet.id,'contract',async()=>done);
  const q=await f.service.quote(other,'gold','1');assert.equal((await f.service.execute(other,'identity',q.id,true)).stage,'rejected');assert.equal(f.sent.length,0);
  done=true;const q2=await f.service.quote(other,'gold','1');const op=await f.service.execute(other,'identity',q2.id,true);f.confirm(op.actionId!);f.receipt({status:'reverted',logs:[]} as unknown as TransactionReceipt);
  assert.equal((await f.service.status(owner,q2.id,null)).stage,'failed');await f.coordinator.acquire(wallet.id,'deposit',async()=>true);
});
test('wrong receiver or missing completion event never counts as a successful swap',async()=>{
  const f=fixture();const q=await f.service.quote(other,'gold','1');const op=await f.service.execute(other,'identity',q.id,true);f.confirm(op.actionId!,'swap',router);
  await assert.rejects(f.service.status(owner,q.id,null));await assert.rejects(f.coordinator.acquire(wallet.id,'deposit',async()=>true));
});
test('asset API rejects unauthenticated, cross-origin and mismatched identity-token requests',async()=>{
  const f=fixture(),origin='https://slot.example';
  const service={authenticate:async(token:string)=>{if(token!=='access')throw new Error('Unauthorized');return other;},verifyIdentityToken:async(token:string)=>{if(token!=='identity')throw new Error('Mismatch');}} as unknown as WalletService;
  const handle=createAssetsHandler({admin:f.admin,walletService:service,swaps:f.service,inventory:async()=>({address:wallet.address}) as any,contract:()=>null,origin});
  const call=(headers:Record<string,string>,action:'quote'|'execute'='quote',body:unknown={assetId:'nvidia',amount:'0.004',inputAssetId:'eth'})=>handle(new Request(origin+'/'+action,{method:'POST',headers:{Origin:origin,'X-Slot-Request':'1','Content-Type':'application/json',Authorization:'Bearer access','Privy-Id-Token':'identity',...headers},body:JSON.stringify(body)}),action);
  assert.equal((await call({Authorization:''})).status,401);assert.equal((await call({Origin:'https://evil.example'})).status,403);assert.equal(f.quotes.length,0);
  const response=await call({'Privy-Id-Token':''});assert.equal(response.status,200);const quote=await response.json();assert.equal(quote.inputAssetId,'eth');
  assert.equal((await call({'Privy-Id-Token':'other'},'execute',{id:quote.id,confirm:true})).status,401);assert.equal(f.sent.length,0);
});

test('USDC gas tracks a user-operation-only response without resubmission, including read-only restart recovery',async()=>{
  const f=fixture(),userOp=('0x'+'7'.repeat(64)) as Hash;
  f.deps.walletService.sendOwned=async()=>({userOperationHash:userOp,gasToken:'USDC'});
  let found=false;
  f.deps.chain.userOperation=async(hash,sender,block)=>{assert.equal(hash,userOp);assert.equal(sender,address);assert.ok(block>=100n);return found?{hash:txHash,success:true,nextBlock:block}:{nextBlock:block+1n};};
  const q=await f.service.quote(other,'gold','1'),op=await f.service.execute(other,'identity',q.id,true);
  assert.equal(op.stage,'pending');assert.equal(op.actionId,null);assert.equal(op.userOperationHash,userOp);assert.equal(op.fromBlock,'100');
  const pending=await f.service.status(other,q.id,null);assert.equal(pending.stage,'pending');assert.equal(pending.fromBlock,'101');
  const {parseAbi}=await import('viem');
  const event=parseAbi(['event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)']);
  const receipt=swapReceipt(f.quotes.at(-1)!);receipt.logs.push({address:'0x0000000071727De22E5E9d8BAf0edAc6f37da032',topics:encodeEventTopics({abi:event,eventName:'UserOperationEvent',args:{userOpHash:userOp,sender:address,paymaster:router}}),data:encodeAbiParameters([{type:'uint256'},{type:'bool'},{type:'uint256'},{type:'uint256'}],[1n,true,1n,1n])} as any);
  f.receipt(receipt);found=true;
  const done=await f.service.status(other,q.id,null);assert.equal(done.stage,'succeeded');assert.deepEqual(done.hashes,[txHash]);
  const restarted=createSwapService(f.deps);assert.equal((await restarted.status(other,q.id,null,null,userOp,'100')).stage,'succeeded');
});

test('failed user operation is terminal even when the containing bundle transaction succeeded',async()=>{
  const f=fixture(),userOp=('0x'+'8'.repeat(64)) as Hash;
  f.deps.walletService.sendOwned=async()=>({userOperationHash:userOp,gasToken:'USDC'});
  f.deps.chain.userOperation=async()=>({hash:txHash,success:false,nextBlock:100n});
  const q=await f.service.quote(other,'gold','1');await f.service.execute(other,'identity',q.id,true);
  f.receipt({status:'success',logs:[]} as unknown as TransactionReceipt);
  assert.equal((await f.service.status(other,q.id,null)).stage,'failed');
  const restarted=createSwapService(f.deps);assert.equal((await restarted.status(other,q.id,null,null,userOp,'100')).stage,'failed');
  await f.coordinator.acquire(wallet.id,'deposit',async()=>true);
});
