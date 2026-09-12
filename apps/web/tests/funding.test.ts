import test from 'node:test';
import assert from 'node:assert/strict';
import {prizeRequirements,readFunding} from '../lib/slot/funding';
import type {SlotReader} from '../lib/slot/reader';
const token='0x0000000000000000000000000000000000000001';
const prize={kind:1,token,tokenId:0n,fiveMatchAmount:100n,threeMatchWeight:100,fiveMatchWeight:0} as const;
test('funding sums shared assets and uses the actual maximum payout for three-only prizes',()=>{
  const required=prizeRequirements([prize,{...prize,fiveMatchWeight:100},{...prize,kind:2,tokenId:1n,fiveMatchAmount:2n},{...prize,kind:2,tokenId:2n,fiveMatchAmount:3n},{...prize,kind:3}]);
  assert.deepEqual(required.map(p=>[p.kind,p.tokenId,p.required]),[[1,0n,150n],[2,1n,2n],[2,2n,3n]]);
});
test('reserved stock cannot fund another round and missing RPC data never reports ready',async()=>{
  let fail=false,available=99n;
  const reader={contract:{},client:{readContract:async({blockNumber}:{blockNumber:bigint})=>{assert.equal(blockNumber,42n);if(fail)throw new Error('RPC unavailable');return [200n,200n-available,available];}}} as unknown as Pick<SlotReader,'client'|'contract'>;
  const prizes=[{...prize,fiveMatchWeight:100}];
  let state=await readFunding(reader,prizes,42n);assert.equal(state.ready,false);assert.equal(state.assets[0].missing,1n);
  available=100n;state=await readFunding(reader,prizes,42n);assert.equal(state.ready,true);
  fail=true;await assert.rejects(readFunding(reader,prizes,42n),/RPC unavailable/);
});
