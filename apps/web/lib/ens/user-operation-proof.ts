import {decodeAbiParameters,decodeEventLog,decodeFunctionData,encodeFunctionData,parseAbi,toFunctionSelector,type Abi,type Address,type Hex,type TransactionReceipt} from 'viem';
import {entryPoint06Abi,entryPoint06Address,entryPoint07Abi,entryPoint07Address,entryPoint08Abi,entryPoint08Address,entryPoint09Abi,entryPoint09Address} from 'viem/account-abstraction';
import {BASE_PRIZE_COLLECTION} from '../prize-collection';
import {USDC} from '../types';
const entries=new Map<string,Abi>([[entryPoint06Address,entryPoint06Abi],[entryPoint07Address,entryPoint07Abi],[entryPoint08Address,entryPoint08Abi],[entryPoint09Address,entryPoint09Abi]].map(([a,b])=>[(a as string).toLowerCase(),b as Abi]));
const executionAbi=parseAbi(['function execute(bytes32 mode,bytes executionCalldata) payable']);
const approvalAbi=parseAbi(['function approve(address spender,uint256 amount) returns(bool)']);
export const operationEvents=parseAbi(['event BeforeExecution()','event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)']);
export const executeUserOpSelector=toFunctionSelector('executeUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32)');
const same=(a:string|null|undefined,b:string)=>a?.toLowerCase()===b.toLowerCase();
function kernelCall(input:Hex):Hex|null {
 const data=input.startsWith(executeUserOpSelector)?('0x'+input.slice(10)) as Hex:input;
 const {args}=decodeFunctionData({abi:executionAbi,data});const [mode,execution]=args;
 let target:string,value:bigint,call:Hex;
 if(mode==='0x'+'0'.repeat(64)){
  if(execution.length<106)return null;target='0x'+execution.slice(2,42);value=BigInt('0x'+execution.slice(42,106));call=('0x'+execution.slice(106)) as Hex;
 }else if(mode==='0x01'+'0'.repeat(62)){
  const [calls]=decodeAbiParameters([{type:'tuple[]',components:[{name:'target',type:'address'},{name:'value',type:'uint256'},{name:'callData',type:'bytes'}]}],execution);
  // Privy User Pays can append a USDC gas approval. Only one NFT call is
  // eligible; never select a matching substring from an arbitrary batch.
  if(calls.length<1||calls.length>2)return null;
  const voucher=calls.filter(c=>same(c.target,BASE_PRIZE_COLLECTION));
  if(voucher.length!==1)return null;
  for(const c of calls.filter(c=>c!==voucher[0])){
   if(!same(c.target,USDC)||c.value!==0n)return null;
   const approval=decodeFunctionData({abi:approvalAbi,data:c.callData});
   if(c.callData!==encodeFunctionData({abi:approvalAbi,functionName:'approve',args:approval.args}))return null;
  }
  ({target,value,callData:call}=voucher[0]);
 }else return null; // No delegatecall, try/catch execution, custom modes or arbitrary batches.
 return same(target,BASE_PRIZE_COLLECTION)&&value===0n?call:null;
}
/** Attribute a transfer to its actual successful ERC4337 operation, never to a
 * calldata substring elsewhere in the bundle or to validation-phase events. */
export function voucherCallData(tx:{from:Address;to:Address|null;input:Hex},receipt:Pick<TransactionReceipt,'logs'>,logIndex:number,owner:Address):Hex|null {
 if(same(tx.from,owner)&&same(tx.to,BASE_PRIZE_COLLECTION))return tx.input;
 const abi=tx.to&&entries.get(tx.to.toLowerCase());if(!abi)return null;
 try{
  const decoded=decodeFunctionData({abi,data:tx.input});
  type Op={sender:Address;nonce:bigint;callData:Hex};
  let ops:Op[];
  if(decoded.functionName==='handleOps')ops=(decoded.args as unknown as [Op[]])[0];
  else if(decoded.functionName==='handleAggregatedOps')ops=(decoded.args as unknown as [{userOps:Op[]}[]])[0].flatMap(group=>group.userOps);
  else return null;
  let boundary:number|undefined;
  for(const log of [...receipt.logs].sort((a,b)=>a.logIndex-b.logIndex)){
   if(!same(log.address,tx.to!))continue;
   let event;try{event=decodeEventLog({abi:operationEvents,data:log.data,topics:log.topics});}catch{continue;}
   if(event.eventName==='BeforeExecution'){boundary=log.logIndex;continue;}
   if(boundary!==undefined&&logIndex>boundary&&logIndex<log.logIndex){
    if(!event.args.success||!same(event.args.sender,owner))return null;
    const candidates=ops.filter(op=>same(op.sender,owner)&&op.nonce===event.args.nonce);
    return candidates.length===1?kernelCall(candidates[0].callData):null;
   }
   boundary=log.logIndex;
  }
 }catch{return null;}
 return null;
}
