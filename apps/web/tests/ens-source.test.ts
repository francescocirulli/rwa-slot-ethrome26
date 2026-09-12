import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,encodeFunctionData,keccak256,toHex,type Address,type Hex,type PublicClient} from 'viem';
import {createVoucherSource,ENS_DISCARD_ADDRESS,voucherPayload,voucherTransaction,voucherTransferEvent} from '../lib/ens/source';
import {BASE_PRIZE_COLLECTION,prizeCollectionAbi} from '../lib/prize-collection';
const owner='0x0000000000000000000000000000000000000011' as Address,other='0x0000000000000000000000000000000000000022' as Address,registrar='0x0000000000000000000000000000000000000033' as Address;
const id=keccak256(toHex('claim')),labelHash=keccak256(toHex('frank')),hash=keccak256(toHex('transaction')),blockHash=keccak256(toHex('block'));
function fixture(){
 let finalized=9n,fail=false,visible=true;
 const log:any={address:BASE_PRIZE_COLLECTION,args:{operator:owner,from:owner,to:ENS_DISCARD_ADDRESS,id:2n,value:1n},data:encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[2n,1n]),topics:encodeEventTopics({abi:[voucherTransferEvent],eventName:'TransferSingle',args:{operator:owner,from:owner,to:ENS_DISCARD_ADDRESS}}),blockNumber:10n,blockHash,transactionHash:hash,transactionIndex:0,logIndex:3,removed:false};
 const tx:any={hash,from:owner,to:BASE_PRIZE_COLLECTION,input:voucherTransaction(registrar,owner,id,labelHash).data,blockHash};
 const receipt:any={status:'success',transactionHash:hash,blockNumber:10n,blockHash,logs:[{...log}]};
 const client={getLogs:async({fromBlock,toBlock,args}:any)=>visible&&fromBlock<=10n&&toBlock>=10n&&(!args.from||args.from===owner)?[log]:[],getTransaction:async()=>tx,getTransactionReceipt:async()=>{if(fail)throw Error('RPC unavailable');return receipt;},getBlock:async({blockTag,blockNumber}:any)=>({number:blockTag==='finalized'?finalized:blockNumber,hash:blockHash}),getBlockNumber:async()=>11n} as unknown as PublicClient;
 const create=(fromBlock=8n)=>createVoucherSource({client,registrar,fromBlock,pageBlocks:2n});
 return {log,tx,receipt,create,client,finalize(){finalized=10n;},fail(){fail=true;},recover(){fail=false;},reorg(){visible=false;}};
}
test('direct transfer binds the reserved name, destination chain and registrar in calldata',async()=>{
 const f=fixture(),source=f.create();let result=await source.find(id,owner,labelHash);
 assert.equal(result?.finalized,false);assert.equal(result?.proof.transactionHash,hash);
 f.finalize();result=await source.find(id,owner,labelHash);assert.equal(result?.finalized,true);
 assert.equal(result?.proof.source,keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'bytes32'},{type:'uint256'}],[8453n,BASE_PRIZE_COLLECTION,hash,3n])));
 assert.equal(await source.find(id,other,labelHash),null);
 assert.equal(await source.find(keccak256(toHex('other claim')),owner,labelHash),null);
 assert.equal(await source.find(id,owner,keccak256(toHex('other name'))),null);
});
test('a restart reconstructs finalized proof without a database or an in-memory transaction reference',async()=>{
 const f=fixture();f.finalize();const a=await f.create().find(id,owner,labelHash),b=await f.create().find(id,owner,labelHash);assert.deepEqual(a,b);assert.equal(b?.finalized,true);
});
test('unfinalized reorgs disappear and finalized proofs are rechecked before use',async()=>{
 const f=fixture(),source=f.create();assert.ok(await source.find(id,owner,labelHash));f.reorg();assert.equal(await source.find(id,owner,labelHash),null);
 const g=fixture();g.finalize();const saved=g.create();assert.ok(await saved.find(id,owner,labelHash));g.reorg();await assert.rejects(saved.find(id,owner,labelHash),/proof changed/);
});
test('RPC failure cannot be treated as no voucher or advance a scan past its proof',async()=>{
 const f=fixture();f.finalize();f.fail();const source=f.create();await assert.rejects(source.find(id,owner,labelHash),/RPC/);f.recover();assert.equal((await source.find(id,owner,labelHash))?.finalized,true);
});
for(const [name,alter] of Object.entries({
 'wrong collection':(f:ReturnType<typeof fixture>)=>{f.log.address=other;},
 'wrong destination':(f:ReturnType<typeof fixture>)=>{f.log.args.to=other;},
 'wrong token':(f:ReturnType<typeof fixture>)=>{f.log.args.id=1n;},
 'wrong quantity':(f:ReturnType<typeof fixture>)=>{f.log.args.value=2n;},
 'third-party operator':(f:ReturnType<typeof fixture>)=>{f.tx.from=other;},
 'reverted receipt':(f:ReturnType<typeof fixture>)=>{f.receipt.status='reverted';},
 'receipt without event':(f:ReturnType<typeof fixture>)=>{f.receipt.logs=[];},
 'receipt with altered event':(f:ReturnType<typeof fixture>)=>{f.receipt.logs[0].data='0x';},
 'changed block hash':(f:ReturnType<typeof fixture>)=>{f.receipt.blockHash=hash;},
 'removed event':(f:ReturnType<typeof fixture>)=>{f.log.removed=true;},
 'ordinary transfer':(f:ReturnType<typeof fixture>)=>{f.tx.input=encodeFunctionData({abi:prizeCollectionAbi,functionName:'safeTransferFrom',args:[owner,ENS_DISCARD_ADDRESS,2n,1n,'0x']});},
 'another registrar':(f:ReturnType<typeof fixture>)=>{f.tx.input=voucherTransaction(other,owner,id,labelHash).data;},
 'trailing calldata':(f:ReturnType<typeof fixture>)=>{f.tx.input+='00';},
 'wrong destination chain':(f:ReturnType<typeof fixture>)=>{const payload=voucherPayload(registrar,id,labelHash);const data=(payload.slice(0,66)+(1n).toString(16).padStart(64,'0')+payload.slice(130)) as Hex;f.tx.input=encodeFunctionData({abi:prizeCollectionAbi,functionName:'safeTransferFrom',args:[owner,ENS_DISCARD_ADDRESS,2n,1n,data]});},
}))test('voucher proof rejects '+name,async()=>{const f=fixture();alter(f);assert.equal(await f.create().find(id,owner,labelHash),null);});
test('source activation block excludes earlier transfers',async()=>{const f=fixture();assert.equal(await f.create(11n).find(id,owner,labelHash),null);});

test('a provider returning logs outside the finalized query cannot authorize early fulfillment',async()=>{
 const f=fixture();const original=f.client.getLogs;f.client.getLogs=(async()=>[f.log]) as typeof original;
 assert.equal((await f.create().find(id,owner,labelHash))?.finalized,false);
});

test('background indexing keeps finalized proofs ready before the phone requests them',async()=>{
 const f=fixture();f.finalize();const source=f.create();assert.deepEqual(await source.indexFinalized(),{finalizedNumber:10n,caughtUp:true});
 assert.equal((await source.find(id,owner,labelHash))?.finalized,true);
});

test('a sponsored successful UserOperation yields the same final source-proof guarantees',async()=>{
 const {entryPoint07Abi,entryPoint07Address}=await import('viem/account-abstraction');
 const {operationEvents}=await import('../lib/ens/user-operation-proof');
 const {concat,parseAbi,zeroHash}=await import('viem');
 const f=fixture();f.finalize();
 const callData=encodeFunctionData({abi:parseAbi(['function execute(bytes32 mode,bytes executionCalldata)']),functionName:'execute',args:[zeroHash,concat([BASE_PRIZE_COLLECTION,toHex(0,{size:32}),f.tx.input as Hex])]});
 const op={sender:owner,nonce:1n,initCode:'0x',callData,accountGasLimits:zeroHash,preVerificationGas:0n,gasFees:zeroHash,paymasterAndData:'0x',signature:'0x'} as const;
 f.tx.from=other;f.tx.to=entryPoint07Address;f.tx.input=encodeFunctionData({abi:entryPoint07Abi,functionName:'handleOps',args:[[op],other]});
 f.receipt.logs.unshift({address:entryPoint07Address,logIndex:1,data:'0x',topics:encodeEventTopics({abi:operationEvents,eventName:'BeforeExecution'})});
 f.receipt.logs.push({address:entryPoint07Address,logIndex:4,data:encodeAbiParameters([{type:'uint256'},{type:'bool'},{type:'uint256'},{type:'uint256'}],[1n,true,1n,1n]),topics:encodeEventTopics({abi:operationEvents,eventName:'UserOperationEvent',args:{userOpHash:zeroHash,sender:owner,paymaster:other}})});
 assert.equal((await f.create().find(id,owner,labelHash))?.finalized,true);
});


test('concurrent claim refreshes share one lookup but later authorization rechecks the proof',async()=>{
 const f=fixture();f.finalize();const source=f.create();await source.indexFinalized();
 let reads=0;const read=f.client.getLogs;f.client.getLogs=(async(args:any)=>{reads++;return read(args);}) as typeof read;
 const results=await Promise.all([source.find(id,owner,labelHash),source.find(id,owner,labelHash),source.find(id,owner,labelHash)]);
 assert.equal(reads,1);assert.ok(results.every(result=>result?.finalized));
 await source.find(id,owner,labelHash);assert.equal(reads,2);
});

test('worker consumes the verified finalized index without fetching the same log pages twice',async()=>{
 const f=fixture();f.finalize();const source=f.create();
 assert.throws(()=>source.finalizedEvents(8n,10n),/catching up/);
 await source.indexFinalized();
 f.client.getLogs=(async()=>{throw Error('Unexpected duplicate scan');}) as typeof f.client.getLogs;
 assert.equal(source.finalizedEvents(8n,10n)[0].id,id);
 assert.deepEqual(source.finalizedEvents(8n,9n),[]);
 assert.throws(()=>source.finalizedEvents(11n,12n),/catching up/);
});
