import test from 'node:test';
import assert from 'node:assert/strict';
import {prizeRequirements,readFunding} from '../lib/slot/funding';
import type {SlotReader} from '../lib/slot/reader';
import {createPrizeAvailability} from '../lib/slot/availability';
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

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
test('reserve availability is nonblocking, shared, expires and recovers after refill or RPC failure',async()=>{
  let time=1, calls=0, release!:(value:{ready:boolean})=>void;
  let read=()=>new Promise<{ready:boolean}>(resolve=>{release=resolve;});
  const availability=createPrizeAvailability(()=>{calls++;return read();},()=>time);
  for(let i=0;i<20;i++)assert.equal(availability.view().state,'checking');
  await flush();assert.equal(calls,1);
  release({ready:false});await flush();assert.equal(availability.view().state,'restocking');
  time+=15000;read=async()=>({ready:true});
  assert.equal(availability.view().state,'restocking');await flush();assert.equal(availability.view().state,'ready');
  assert.equal(calls,2);
  time+=15000;read=async()=>{throw new Error('RPC down');};
  assert.equal(availability.view().state,'checking');await flush();assert.equal(availability.view().state,'unavailable');
  for(let i=0;i<20;i++)availability.view();await flush();assert.equal(calls,3);
  time+=15000;read=async()=>({ready:true});availability.view();await flush();assert.equal(availability.view().state,'ready');
});
test('a delayed reserve response cannot overwrite a newer start preflight or invalidation',async()=>{
  let release!:(value:{ready:boolean})=>void;
  const availability=createPrizeAvailability(()=>new Promise(resolve=>{release=resolve;}));
  availability.view();await flush();availability.record(false);release({ready:true});await flush();
  assert.equal(availability.view().state,'restocking');
  availability.invalidate();availability.view();await flush();availability.invalidate();release({ready:true});await flush();
  assert.equal(availability.view().state,'checking');
  await flush();release({ready:false});await flush();assert.equal(availability.view().state,'restocking');
});
