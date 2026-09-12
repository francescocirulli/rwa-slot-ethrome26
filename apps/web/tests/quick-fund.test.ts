import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQuickFundPlan,parseFundingTurns,restoreQuickFundBatch} from '../lib/admin/quick-fund';
import {RWA_ASSETS} from '../lib/assets';
const nvidia=RWA_ASSETS.find(asset=>asset.id==='nvidia')!;
const gold=RWA_ASSETS.find(asset=>asset.id==='gold')!;
const balance=(id:string,value:string|null,verified=true)=>({id,balance:value,verified});
const funding=(assets:unknown[])=>({assets} as never);
test('quick fund adds N turns to existing reserves and splits buy versus deposit',()=>{
  const plan=buildQuickFundPlan({turns:3,funding:funding([{kind:1,token:nvidia.address,required:'100',available:'150'}]),assets:[balance('nvidia','50')]});
  assert.equal(plan.length,1);
  assert.equal(plan[0].required,450n);
  assert.equal(plan[0].toFund,300n);
  assert.equal(plan[0].wallet,50n);
  assert.equal(plan[0].toBuy,250n);
  assert.equal(plan[0].toDeposit,50n);
});
test('quick fund only covers ERC20 prizes that map to the six RWA token symbols',()=>{
  const plan=buildQuickFundPlan({turns:1,funding:funding([
    {kind:2,token:nvidia.address,tokenId:'5',required:'10',available:'0'},
    {kind:1,token:'0x00000000000000000000000000000000000000ff',required:'10',available:'0'},
    {kind:1,token:gold.address,required:'10',available:'0'},
  ]),assets:[balance('nvidia','0'),balance('gold','0')]});
  assert.deepEqual(plan.map(item=>item.id),['gold']);
});
test('an existing reserve can be topped up again and invalid input returns empty',()=>{
  const plan=buildQuickFundPlan({turns:2,funding:funding([{kind:1,token:nvidia.address,required:'100',available:'200'}]),assets:[balance('nvidia','0')]});
  assert.equal(plan[0].toFund,200n);
  assert.deepEqual(buildQuickFundPlan({turns:0,funding:funding([]),assets:[]}),[]);
  assert.deepEqual(buildQuickFundPlan({turns:1,funding:null,assets:[]}),[]);
});
test('unverified balances are never treated as spendable',()=>{
  const plan=buildQuickFundPlan({turns:1,funding:funding([{kind:1,token:nvidia.address,required:'100',available:'0'}]),assets:[balance('nvidia',null,false)]});
  assert.equal(plan[0].verified,false);
  assert.equal(plan[0].wallet,null);
  assert.equal(plan[0].toDeposit,0n);
  assert.equal(plan[0].toBuy,100n);
});

test('frozen targets skip confirmed deposits on resume, while a new batch adds again',()=>{
  const input={turns:2,funding:funding([{kind:1,token:nvidia.address,required:'100',available:'150'}]),assets:[balance('nvidia','1000')]};
  const initial=buildQuickFundPlan(input),targets={[nvidia.address.toLowerCase()]:initial[0].required.toString()};
  assert.equal(initial[0].toFund,200n);
  const partial={...input,funding:funding([{kind:1,token:nvidia.address,required:'100',available:'250'}])};
  assert.equal(buildQuickFundPlan({...partial,targets})[0].toFund,100n);
  const finished={...input,funding:funding([{kind:1,token:nvidia.address,required:'100',available:'350'}])};
  assert.equal(buildQuickFundPlan({...finished,targets})[0].toFund,0n);
  assert.equal(buildQuickFundPlan(finished)[0].toFund,200n);
});
test('turn input supports clearing and rejects fractions, signs and out-of-range values',()=>{
  for(const value of ['','0','100','-1','1.5','1e1',' 2','01'])assert.equal(parseFundingTurns(value),null);
  for(const value of ['1','12','99'])assert.equal(parseFundingTurns(value),Number(value));
});
test('recovery stores only valid turns and exact integer targets for known RWA tokens',()=>{
  const batch={turns:3,targets:{[nvidia.address.toLowerCase()]:'450'}};
  assert.deepEqual(restoreQuickFundBatch(JSON.stringify(batch)),batch);
  for(const invalid of [null,'broken',JSON.stringify({...batch,turns:0}),JSON.stringify({...batch,targets:{}}),JSON.stringify({...batch,targets:{unknown:'1'}}),JSON.stringify({...batch,targets:{[nvidia.address.toLowerCase()]:'1.5'}})])assert.equal(restoreQuickFundBatch(invalid),null);
});
