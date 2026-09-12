import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQuickFundPlan} from '../lib/admin/quick-fund';
import {RWA_ASSETS} from '../lib/assets';
const nvidia=RWA_ASSETS.find(asset=>asset.id==='nvidia')!;
const gold=RWA_ASSETS.find(asset=>asset.id==='gold')!;
const balance=(id:string,value:string|null,verified=true)=>({id,balance:value,verified});
const funding=(assets:unknown[])=>({assets} as never);
test('quick fund scales the reserve to N turns and splits buy versus deposit',()=>{
  const plan=buildQuickFundPlan({turns:3,funding:funding([{kind:1,token:nvidia.address,required:'100',available:'150'}]),assets:[balance('nvidia','50')]});
  assert.equal(plan.length,1);
  assert.equal(plan[0].required,300n);
  assert.equal(plan[0].toFund,150n);
  assert.equal(plan[0].wallet,50n);
  assert.equal(plan[0].toBuy,100n);
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
test('already funded turns need no operations and invalid input returns empty',()=>{
  const plan=buildQuickFundPlan({turns:2,funding:funding([{kind:1,token:nvidia.address,required:'100',available:'200'}]),assets:[balance('nvidia','0')]});
  assert.equal(plan[0].toFund,0n);
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
