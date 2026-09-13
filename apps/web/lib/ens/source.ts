import {decodeAbiParameters,decodeFunctionData,encodeAbiParameters,encodeFunctionData,keccak256,parseAbi,toHex,type Address,type Hex,type PublicClient,type TransactionReceipt} from 'viem';
import {BASE_PRIZE_COLLECTION,prizeCollectionAbi} from '../prize-collection';
import {voucherCallData} from './user-operation-proof';
import {SlotError} from '../slot/errors';
export const ENS_DISCARD_ADDRESS='0x000000000000000000000000000000000000dEaD' as Address;
export const voucherTransferEvent=parseAbi(['event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)'])[0];
const schema=[{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'bytes32'},{type:'bytes32'}] as const;
const protocol=keccak256(toHex('wallstreetslot ENS dead-address redemption v1'));
const same=(a:string|undefined|null,b:string)=>a?.toLowerCase()===b.toLowerCase();
export function voucherPayload(registrar:Address,id:Hex,labelHash:Hex){return encodeAbiParameters(schema,[protocol,11155111n,registrar,id,labelHash]);}
export function voucherTransaction(registrar:Address,owner:Address,id:Hex,labelHash:Hex){return {to:BASE_PRIZE_COLLECTION,chainId:8453,data:encodeFunctionData({abi:prizeCollectionAbi,functionName:'safeTransferFrom',args:[owner,ENS_DISCARD_ADDRESS,2n,1n,voucherPayload(registrar,id,labelHash)]})};}
export type VoucherProof={id:Hex;owner:Address;labelHash:Hex;source:Hex;transactionHash:Hex;logIndex:number;blockNumber:bigint;blockHash:Hex;timestamp?:bigint};
type SourceClient=Pick<PublicClient,'getLogs'> & {
 getTransaction:(args:{hash:Hex})=>Promise<{hash:Hex;from:Address;to:Address|null;input:Hex;blockHash:Hex|null}>;
 getTransactionReceipt:(args:{hash:Hex})=>Promise<Pick<TransactionReceipt,'status'|'transactionHash'|'blockHash'|'blockNumber'|'logs'>>;
 getBlock:(args:{blockTag:'finalized'}|{blockNumber:bigint})=>Promise<{number:bigint|null;hash:Hex|null;timestamp?:bigint}>;
 getBlockNumber:(args?:{cacheTime?:number})=>Promise<bigint>;
};
export function createVoucherSource({client,registrar,fromBlock,pageBlocks=1000n}:{client:SourceClient;registrar:Address;fromBlock:bigint;pageBlocks?:bigint}){
 if(fromBlock<0n||pageBlocks<1n)throw Error('Invalid ENS source scan configuration');
 type Event=Awaited<ReturnType<typeof logs>>[number];
 function logs(from:bigint,to:bigint,owner?:Address){return client.getLogs({address:BASE_PRIZE_COLLECTION,event:voucherTransferEvent,args:{to:ENS_DISCARD_ADDRESS,...(owner?{from:owner}:{})},fromBlock:from,toBlock:to,strict:true});}
 async function verify(event:Event):Promise<VoucherProof|null>{
  if(event.removed||event.blockNumber===null||event.blockNumber<fromBlock||event.logIndex===null||!event.transactionHash||!event.blockHash||!same(event.address,BASE_PRIZE_COLLECTION)||!same(event.args.to,ENS_DISCARD_ADDRESS)||event.args.id!==2n||event.args.value!==1n||!event.args.from||!same(event.args.operator,event.args.from))return null;
  // RPC errors propagate: a failed read must never advance the source scan.
  const [tx,receipt]=await Promise.all([client.getTransaction({hash:event.transactionHash}),client.getTransactionReceipt({hash:event.transactionHash})]);
  if(receipt.status!=='success'||receipt.transactionHash!==event.transactionHash||tx.hash!==event.transactionHash||receipt.blockHash!==event.blockHash||tx.blockHash!==event.blockHash||receipt.blockNumber!==event.blockNumber)return null;
  const actual=receipt.logs.find(log=>log.logIndex===event.logIndex);
  if(!actual||!same(actual.address,BASE_PRIZE_COLLECTION)||actual.data!==event.data||actual.topics.join()!==event.topics.join())return null;
  const callData=voucherCallData(tx,receipt,event.logIndex,event.args.from);if(!callData)return null;
  let id:Hex,labelHash:Hex;
  try{
   const decoded=decodeFunctionData({abi:prizeCollectionAbi,data:callData});
   if(decoded.functionName!=='safeTransferFrom')return null;
   const [owner,to,token,amount,data]=decoded.args;
   if(!same(owner,event.args.from)||!same(to,ENS_DISCARD_ADDRESS)||token!==2n||amount!==1n)return null;
   const [version,chain,target,claim,label]=decodeAbiParameters(schema,data);
   if(version!==protocol||chain!==11155111n||!same(target,registrar)||/^0x0+$/.test(claim)||data!==voucherPayload(registrar,claim,label))return null;
   // The exact call must belong to the sender or its successful sponsored
   // operation. Unrelated bundle calldata cannot authorize a redemption.
   if(callData!==voucherTransaction(registrar,owner,claim,label).data)return null;
   id=claim;labelHash=label;
  }catch{return null;}
  const block=await client.getBlock({blockNumber:event.blockNumber});
  if(block.hash!==event.blockHash)return null;
  const source=keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'bytes32'},{type:'uint256'}],[8453n,BASE_PRIZE_COLLECTION,event.transactionHash,BigInt(event.logIndex)]));
  return {id,owner:event.args.from,labelHash,source,transactionHash:event.transactionHash,logIndex:event.logIndex,blockNumber:event.blockNumber,blockHash:event.blockHash,timestamp:block.timestamp};
 }
 async function events(from:bigint,to:bigint,owner?:Address){const proofs:VoucherProof[]=[];for(const log of await logs(from,to,owner)){if(log.blockNumber===null||log.blockNumber<from||log.blockNumber>to)continue;const proof=await verify(log);if(proof)proofs.push(proof);}return proofs;}
 let cursor=fromBlock,scanning:Promise<void>|undefined;
 const finalizedProofs=new Map<string,VoucherProof>(),recentProofs=new Map<string,VoucherProof>();
 let recentCursor:bigint|undefined;
 const proofKey=(id:Hex,owner:Address,labelHash:Hex)=>[id,owner.toLowerCase(),labelHash].join(':');
 async function indexFinalized(){
  const finalized=await client.getBlock({blockTag:'finalized'});
  if(finalized.number===null)throw new SlotError('EnsFinality','Base finality is unavailable.',503);
  const finalizedNumber=finalized.number;
  if(!scanning)scanning=(async()=>{
   for(let page=0;cursor<=finalizedNumber&&page<20;page++){
    const to=cursor+pageBlocks-1n>finalizedNumber?finalizedNumber:cursor+pageBlocks-1n;
    for(const proof of await events(cursor,to)){const key=proofKey(proof.id,proof.owner,proof.labelHash);if(!finalizedProofs.has(key))finalizedProofs.set(key,proof);}
    cursor=to+1n;
   }
  })().finally(()=>{scanning=undefined;});
  await scanning;
  return {finalizedNumber,caughtUp:cursor>finalizedNumber};
 }
 // Two Base block confirmations are enough for the app's fast redemption policy.
 // Finalized indexing remains a restart/backfill mechanism, not a minting gate.
 async function confirmed(proof:VoucherProof,finalizedNumber:bigint){
  const head=await client.getBlockNumber({cacheTime:0});
  return {proof,finalized:proof.blockNumber<=finalizedNumber,confirmed:head>=proof.blockNumber+1n};
 }
 async function indexRecent(){
  const boundary=await client.getBlock({blockTag:'finalized'});
  if(boundary.number===null)throw new SlotError('EnsFinality','Base history boundary is unavailable.',503);
  const head=await client.getBlockNumber({cacheTime:0}),start=boundary.number+1n>fromBlock?boundary.number+1n:fromBlock;
  let next=recentCursor===undefined||recentCursor<start||recentCursor>head?start:recentCursor;
  const proofs:VoucherProof[]=[];
  for(let page=0;next<head&&page<20;page++){
   const to=next+pageBlocks-1n<head?next+pageBlocks-1n:head-1n;
   for(const proof of await events(next,to)){recentProofs.set(proofKey(proof.id,proof.owner,proof.labelHash),proof);proofs.push(proof);}
   next=to+1n;recentCursor=next;
  }
  const catchingUp=next<head;if(!catchingUp)recentCursor=undefined;
  return {proofs,catchingUp};
 }
 async function lookup(id:Hex,owner:Address,labelHash:Hex):Promise<{proof:VoucherProof;finalized:boolean;confirmed:boolean}|null>{
  const key=proofKey(id,owner,labelHash),saved=finalizedProofs.get(key)||recentProofs.get(key);
  if(saved){
   // Cached entries are only hints. Every authorization verifies the exact
   // canonical receipt/event again, including successful execution and owner.
   const proof=(await events(saved.blockNumber,saved.blockNumber,owner)).find(p=>p.source===saved.source);
   if(proof){const boundary=await client.getBlock({blockTag:'finalized'});return confirmed(proof,boundary.number??0n);}
   if(finalizedProofs.has(key))throw new SlotError('EnsSource','Voucher proof changed. Registration will retry; do not send another voucher.',503);
  }
  const boundary=await client.getBlock({blockTag:'finalized'});
  if(boundary.number===null)throw new SlotError('EnsFinality','Base history boundary is unavailable.',503);
  const finalizedNumber=boundary.number,head=await client.getBlockNumber({cacheTime:0});
  let from=finalizedNumber+1n>fromBlock?finalizedNumber+1n:fromBlock;
  // Find new transfers before historical catch-up, so old logs cannot delay minting.
  for(let page=0;from<=head&&page<200;page++){
   const to=from+pageBlocks-1n>head?head:from+pageBlocks-1n;
   const proof=(await events(from,to,owner)).find(p=>p.id===id&&p.labelHash===labelHash&&same(p.owner,owner));
   if(proof){recentProofs.set(key,proof);return confirmed(proof,finalizedNumber);}from=to+1n;
  }
  if(from<=head)throw new SlotError('EnsIndex','Voucher checks are catching up. Do not send another voucher.',503);
  const indexed=await indexFinalized();
  if(!indexed.caughtUp)throw new SlotError('EnsIndex','Voucher history is catching up. Refresh shortly.',503);
  const historical=finalizedProofs.get(key);
  if(!historical){if(saved)throw new SlotError('EnsSource','Voucher proof changed. Registration will retry; do not send another voucher.',503);return null;}
  const proof=(await events(historical.blockNumber,historical.blockNumber,owner)).find(p=>p.source===historical.source);
  if(!proof)throw new SlotError('EnsSource','Voucher proof changed. Registration will retry; do not send another voucher.',503);
  return confirmed(proof,indexed.finalizedNumber);
 }
 // Phone refresh, review and worker reconciliation can overlap. Share only the
 // in-flight lookup: subsequent calls still revalidate the canonical proof.
 const lookups=new Map<string,ReturnType<typeof lookup>>();
 function find(id:Hex,owner:Address,labelHash:Hex){
  const key=proofKey(id,owner,labelHash),existing=lookups.get(key);if(existing)return existing;
  const work=lookup(id,owner,labelHash).finally(()=>lookups.delete(key));lookups.set(key,work);return work;
 }
 function finalizedEvents(from:bigint,to:bigint){
  if(to>=cursor)throw new SlotError('EnsIndex','Voucher history is catching up. Refresh shortly.',503);
  return [...finalizedProofs.values()].filter(proof=>proof.blockNumber>=from&&proof.blockNumber<=to);
 }
 return {events,find,indexFinalized,indexRecent,finalizedEvents};
}
