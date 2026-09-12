import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,encodeFunctionData,concat,parseAbi,toHex,zeroHash,type Hex,type Address,type TransactionReceipt} from 'viem';
import {entryPoint07Abi,entryPoint07Address} from 'viem/account-abstraction';
import {voucherCallData,operationEvents,executeUserOpSelector} from '../lib/ens/user-operation-proof';
import {BASE_PRIZE_COLLECTION} from '../lib/prize-collection';
const owner='0x0000000000000000000000000000000000000011',other='0x0000000000000000000000000000000000000022',data='0x12345678' as Hex;
const executionAbi=parseAbi(['function execute(bytes32 mode,bytes executionCalldata)']);
function fixture(){
 const callData=encodeFunctionData({abi:executionAbi,functionName:'execute',args:[zeroHash,concat([BASE_PRIZE_COLLECTION,toHex(0,{size:32}),data])]});
 const op={sender:owner,nonce:1n,initCode:'0x',callData,accountGasLimits:zeroHash,preVerificationGas:0n,gasFees:zeroHash,paymasterAndData:'0x',signature:'0x'} as const;
 function event(sender:Address=owner,success=true,nonce=1n,index=4){return {address:entryPoint07Address,logIndex:index,data:encodeAbiParameters([{type:'uint256'},{type:'bool'},{type:'uint256'},{type:'uint256'}],[nonce,success,1n,1n]),topics:encodeEventTopics({abi:operationEvents,eventName:'UserOperationEvent',args:{userOpHash:zeroHash,sender,paymaster:other}})};}
 const before={address:entryPoint07Address,logIndex:1,data:'0x',topics:encodeEventTopics({abi:operationEvents,eventName:'BeforeExecution'})};
 const logs=[before,event()];
 const tx:{from:Address;to:Address;input:Hex}={from:other,to:entryPoint07Address,input:encodeFunctionData({abi:entryPoint07Abi,functionName:'handleOps',args:[[op],other]})};
 const proof=()=>voucherCallData(tx,{logs} as unknown as Pick<TransactionReceipt,'logs'>,3,owner);
 return {op,tx,logs,event,proof};
}
test('sponsored Kernel call is attributed to its successful sender operation',()=>{const f=fixture();assert.equal(f.proof(),data);});
test('Kernel executeUserOp prefix and a single-call batch are supported',()=>{
 const f=fixture();
 for(const callData of [concat([executeUserOpSelector,f.op.callData]),encodeFunctionData({abi:executionAbi,functionName:'execute',args:[('0x01'+'0'.repeat(62)) as Hex,encodeAbiParameters([{type:'tuple[]',components:[{type:'address',name:'target'},{type:'uint256',name:'value'},{type:'bytes',name:'callData'}]}],[[{target:BASE_PRIZE_COLLECTION,value:0n,callData:data}]])]})]){
  f.tx.input=encodeFunctionData({abi:entryPoint07Abi,functionName:'handleOps',args:[[{...f.op,callData}],other]});assert.equal(f.proof(),data);
 }
});
for(const [name,change] of Object.entries({
 'failed operation':(f:ReturnType<typeof fixture>)=>{f.logs[1]=f.event(owner,false);},
 'different sender':(f:ReturnType<typeof fixture>)=>{f.logs[1]=f.event(other);},
 'wrong nonce':(f:ReturnType<typeof fixture>)=>{f.logs[1]=f.event(owner,true,2n);},
 'no execution boundary':(f:ReturnType<typeof fixture>)=>{f.logs.shift();},
 'transfer emitted during validation':(f:ReturnType<typeof fixture>)=>{f.logs[0].logIndex=3;},
 'transfer belongs to preceding operation':(f:ReturnType<typeof fixture>)=>{f.logs.splice(1,0,f.event(other,true,2n,3));},
 'spoofed EntryPoint':(f:ReturnType<typeof fixture>)=>{f.tx.to=other;},
 'duplicate sender nonce':(f:ReturnType<typeof fixture>)=>{f.tx.input=encodeFunctionData({abi:entryPoint07Abi,functionName:'handleOps',args:[[f.op,f.op],other]});},
}))test('sponsored proof rejects '+name,()=>{const f=fixture();change(f);assert.equal(f.proof(),null);});

test('Privy User Pays batch accepts one voucher with a USDC gas approval only',()=>{
 const f=fixture(),usdc='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
 const approval=encodeFunctionData({abi:parseAbi(['function approve(address spender,uint256 amount)']),functionName:'approve',args:[other,10000n]});
 const voucher={target:BASE_PRIZE_COLLECTION,value:0n,callData:data};
 const fee={target:usdc,value:0n,callData:approval} as const;
 function batch(calls:readonly {target:Address;value:bigint;callData:Hex}[]){
  const callData=encodeFunctionData({abi:executionAbi,functionName:'execute',args:[('0x01'+'0'.repeat(62)) as Hex,encodeAbiParameters([{type:'tuple[]',components:[{name:'target',type:'address'},{name:'value',type:'uint256'},{name:'callData',type:'bytes'}]}],[calls])]});
  f.tx.input=encodeFunctionData({abi:entryPoint07Abi,functionName:'handleOps',args:[[{...f.op,callData}],other]});return f.proof();
 }
 assert.equal(batch([voucher,fee]),data);assert.equal(batch([fee,voucher]),data);
 assert.equal(batch([voucher,voucher]),null);
 assert.equal(batch([voucher,{...fee,target:other}]),null);
 assert.equal(batch([voucher,{...fee,value:1n}]),null);
 assert.equal(batch([voucher,{...fee,callData:concat([approval,'0x00'])}]),null);
 assert.equal(batch([voucher,{...fee,callData:encodeFunctionData({abi:parseAbi(['function transfer(address recipient,uint256 amount)']),functionName:'transfer',args:[other,1n]})}]),null);
});
