import test from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryReader} from '../lib/admin/inventory';
import {BASE_PRIZE_COLLECTION} from '../lib/prize-collection';
import {WALLET_ASSETS} from '../lib/assets';
const wallet='0x0000000000000000000000000000000000000011',slot='0x0000000000000000000000000000000000000099';
test('inventory reads wallet and slot at the same block, includes unconfigured collection IDs and preserves missing data',async()=>{
  let unavailable=false,blockReads=0;const functions:string[]=[];
  const client={
    getChainId:async()=>8453,getBlockNumber:async()=>{blockReads++;return 100n;},
    getBalance:async({address,blockNumber}:{address:string;blockNumber:bigint})=>{assert.equal(blockNumber,100n);return address===wallet?10n**18n:2n*10n**18n;},
    multicall:async({blockNumber}:{blockNumber:bigint})=>{assert.equal(blockNumber,100n);return WALLET_ASSETS.flatMap(a=>[{status:'success',result:10n*10n**BigInt(a.decimals)},{status:'success',result:a.decimals}]);},
    readContract:async({functionName,blockNumber}:{functionName:string;blockNumber:bigint})=>{
      functions.push(functionName);assert.equal(blockNumber,100n);
      if(functionName==='getPrizeCatalog')return [[3],[{kind:2,token:BASE_PRIZE_COLLECTION,tokenId:1n}]];
      if(functionName==='owner')return slot;
      if(functionName==='pendingOwner')return wallet;
      if(functionName==='tokenExists')return true;
      if(functionName==='getERC20Inventory'||functionName==='getERC1155Inventory'){if(unavailable)throw new Error('RPC read failed');return [20n,15n,5n];}
      if(functionName==='balanceOf')return 7n;
      return 0n;
    },
  } as unknown as NonNullable<Parameters<typeof createInventoryReader>[2]>;
  const read=createInventoryReader(undefined,BASE_PRIZE_COLLECTION,client);
  const [inventory,concurrent]=await Promise.all([read(wallet,slot),read(wallet,slot)]);assert.equal(inventory,concurrent);assert.equal(blockReads,1);
  assert.equal(inventory.eth,'1');assert.equal(inventory.contractEth,'2');
  assert.deepEqual(inventory.assets[0].reserve,{balance:'20',reserved:'15',available:'5'});
  assert.equal(inventory.assets[0].formatted,'10');assert.equal(inventory.assets[0].canDeposit,true);
  assert.equal(inventory.nfts.find(n=>n.symbol===3)?.canDeposit,true);
  const magnet=inventory.nfts.find(n=>n.symbol===0)!;assert.equal(magnet.tokenId,'5');assert.equal(magnet.balance,'7');assert.equal(magnet.canDeposit,false);
  assert.equal(inventory.collection.canMint,false);assert.equal(inventory.collection.canAcceptOwnership,true);
  unavailable=true;const next=await read(wallet,slot);assert.equal(next.assets[0].reserve,null);assert.equal(next.nfts[0].reserve,null);assert.equal(next.nfts[0].balance,'7');
  functions.length=0;const fundingOnly=await read(wallet,slot,true);assert.deepEqual(fundingOnly.nfts,[]);assert.equal(fundingOnly.scope,'funding');assert.ok(!functions.includes('tokenExists'));assert.ok(!functions.includes('getERC1155Inventory'));assert.ok(!functions.includes('owner'));
});
