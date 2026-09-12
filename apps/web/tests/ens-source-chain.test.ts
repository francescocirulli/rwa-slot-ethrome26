import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createPublicClient,createWalletClient,http,keccak256,toHex,zeroAddress,type Abi,type Hex} from 'viem';
import {base} from 'viem/chains';
import {mnemonicToAccount} from 'viem/accounts';
import {BASE_PRIZE_COLLECTION,prizeCollectionAbi} from '../lib/prize-collection';
import {createVoucherSource,voucherTransaction,ENS_DISCARD_ADDRESS} from '../lib/ens/source';
const rpc='http://127.0.0.1:8559',mnemonic='test test test test test test test test test test test junk';
const owner=mnemonicToAccount(mnemonic),player=mnemonicToAccount(mnemonic,{addressIndex:1});
test('actual SlotPrize1155 transfer to dead address produces a recoverable claim proof on Anvil', {timeout:60000},async()=>{
 const node=spawn('anvil',['--host','127.0.0.1','--port','8559','--chain-id','8453','--silent'],{stdio:'ignore'});
 const client=createPublicClient({chain:base,transport:http(rpc,{retryCount:0})}),wallet=createWalletClient({chain:base,account:owner,transport:http(rpc)}),user=createWalletClient({chain:base,account:player,transport:http(rpc)});
 async function local(method:string,params:unknown[]){const r=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const body=await r.json();if(body.error)throw Error(body.error.message);return body.result;}
 try{
  let ready=false;for(let i=0;i<100;i++){if(await client.getChainId().catch(()=>0)===8453){ready=true;break;}await new Promise(r=>setTimeout(r,50));}assert.ok(ready);
  const artifact=JSON.parse(await readFile(new URL('../../../contracts/out/SlotPrize1155.sol/SlotPrize1155.json',import.meta.url),'utf8'));
  const deployment=await client.waitForTransactionReceipt({hash:await wallet.deployContract({abi:artifact.abi as Abi,bytecode:artifact.bytecode.object,args:[owner.address]})});
  // Copy the real constructor-initialized collection into the canonical address
  // on this disposable chain, so production proof validation runs unchanged.
  await local('anvil_setCode',[BASE_PRIZE_COLLECTION,await client.getBytecode({address:deployment.contractAddress!})]);
  for(let slot=0;slot<7;slot++)await local('anvil_setStorageAt',[BASE_PRIZE_COLLECTION,toHex(slot,{size:32}),(await client.getStorageAt({address:deployment.contractAddress!,slot:toHex(slot,{size:32})}))||toHex(0,{size:32})]);
  await client.waitForTransactionReceipt({hash:await wallet.writeContract({address:BASE_PRIZE_COLLECTION,abi:prizeCollectionAbi,functionName:'mint',args:[player.address,2n,3n]})});
  await assert.rejects(client.simulateContract({address:BASE_PRIZE_COLLECTION,abi:prizeCollectionAbi,functionName:'safeTransferFrom',args:[player.address,zeroAddress,2n,1n,'0x'],account:player}));
  let finalized=await client.getBlockNumber({cacheTime:0});
  const id=keccak256(toHex('local claim')),label=keccak256(toHex('frank')),registrar=owner.address;
  const proofClient={...client,getBlock:async(args:{blockTag:'finalized'}|{blockNumber:bigint})=>client.getBlock('blockTag' in args?{blockNumber:finalized}:args)};
  const source=()=>createVoucherSource({client:proofClient,registrar,fromBlock:deployment.blockNumber,pageBlocks:2n});
  const snapshot=await local('evm_snapshot',[]);
  const receipt=await client.waitForTransactionReceipt({hash:await user.sendTransaction(voucherTransaction(registrar,player.address,id,label))});assert.equal(receipt.status,'success');
  assert.equal(await client.readContract({address:BASE_PRIZE_COLLECTION,abi:prizeCollectionAbi,functionName:'balanceOf',args:[ENS_DISCARD_ADDRESS,2n]}),1n);
  assert.equal((await source().find(id,player.address,label))?.finalized,false);
  finalized=receipt.blockNumber;const proof=await source().find(id,player.address,label);assert.equal(proof?.finalized,true);
  assert.deepEqual(await source().find(id,player.address,label),proof);
  assert.equal(await source().find(id,owner.address,label),null);
  await local('evm_revert',[snapshot]);finalized=deployment.blockNumber;
  assert.equal(await source().find(id,player.address,label),null);
 }finally{node.kill('SIGTERM');}
});
