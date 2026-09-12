import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData} from 'viem';
import {BASE_PRIZE_COLLECTION,prizeCollectionAbi} from '../lib/prize-collection';
import {buildAction,prepareAction} from '../lib/slot/actions';
import type {SlotReader} from '../lib/slot/reader';
const account='0x0000000000000000000000000000000000000011',slot='0x0000000000000000000000000000000000000099';
function fixture(){
  const state={owner:account,pendingOwner:account,exists:true,configured:true,simulations:0};
  const reader={config:{address:slot,prizeCollection:BASE_PRIZE_COLLECTION,chainId:8453,gasMode:'usdc'},validate:async()=>{},
    catalog:async()=>state.configured?[{kind:2,token:BASE_PRIZE_COLLECTION,tokenId:1n}]:[],
    client:{readContract:async({functionName}:{functionName:string})=>functionName==='owner'?state.owner:functionName==='pendingOwner'?state.pendingOwner:state.exists,simulateContract:async()=>{state.simulations++;}}} as unknown as SlotReader;
  return {reader,state};
}
test('mint restricts collection, existing ID, positive amount and recipient to the shared wallet or slot',async()=>{
  const f=fixture();
  for(const destination of ['wallet','slot']){
    const tx=await prepareAction(f.reader,account,'mintERC1155',[BASE_PRIZE_COLLECTION,'1','12',destination]);
    assert.equal(tx.to,BASE_PRIZE_COLLECTION);assert.equal(tx.value,'0x0');
    assert.deepEqual(decodeFunctionData({abi:prizeCollectionAbi,data:tx.data}),{functionName:'mint',args:[destination==='wallet'?account:slot,1n,12n]});
  }
  for(const args of [[slot,'1','12','wallet'],[BASE_PRIZE_COLLECTION,'1','0','wallet'],[BASE_PRIZE_COLLECTION,'1','1',slot]])assert.throws(()=>buildAction(f.reader,account,'mintERC1155',args));
  f.state.owner=slot;await assert.rejects(prepareAction(f.reader,account,'mintERC1155',[BASE_PRIZE_COLLECTION,'1','1','wallet']),/owner della collezione/);
  f.state.owner=account;f.state.exists=false;await assert.rejects(prepareAction(f.reader,account,'mintERC1155',[BASE_PRIZE_COLLECTION,'1','1','wallet']),/non esiste/);
  assert.equal(f.state.simulations,2);
});
test('slot deposits and direct mint require the exact configured ERC1155 ID; ownership acceptance checks pendingOwner',async()=>{
  const f=fixture();
  await assert.rejects(prepareAction(f.reader,account,'fundERC1155',[BASE_PRIZE_COLLECTION,'2','1']),/Configura prima/);
  f.state.configured=false;await assert.rejects(prepareAction(f.reader,account,'mintERC1155',[BASE_PRIZE_COLLECTION,'1','1','slot']),/Configura questo token ID/);
  await prepareAction(f.reader,account,'mintERC1155',[BASE_PRIZE_COLLECTION,'1','1','wallet']);
  const tx=await prepareAction(f.reader,account,'acceptPrizeOwnership',[BASE_PRIZE_COLLECTION]);assert.equal(decodeFunctionData({abi:prizeCollectionAbi,data:tx.data}).functionName,'acceptOwnership');
  f.state.pendingOwner=slot;await assert.rejects(prepareAction(f.reader,account,'acceptPrizeOwnership',[BASE_PRIZE_COLLECTION]),/Avvia prima/);
});
