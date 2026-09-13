import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelay} from '../lib/relay';
import {walletFixture, pairingSecret, testAccount} from './fixtures';
import type {SlotEngine} from '../lib/slot/engine';
import type {PlayGrant} from '../lib/types';
import {SlotError} from '../lib/slot/errors';
import {logSpinFailure} from '../lib/slot/diagnostics';
const origin='https://slot.example';
const contract='0x0000000000000000000000000000000000000099' as const;
function setup(gasMode:'usdc'|'eth'='eth') {
  let now=1000000, allowance=0n, gate:Promise<void>|undefined, startError:Error|undefined, walletError:Error|undefined;
  const playBudgets:string[]=[];
  const fixture=walletFixture(), calls:{player:string;mode:string}[]=[];
  fixture.service.preparePlay=async(wallet,userId,id,code,address,chainId,budget)=>{playBudgets.push(budget);return ({id:id+'-play',walletId:wallet.id,address:wallet.address,signerId:'signer-play',policyId:'policy-play',message:'',active:false,contract:address,chainId,budget});};
  fixture.service.sendSpin=async()=>({hash:('0x'+'a'.repeat(64)) as `0x${string}`});
  const slot={reader:{config:{address:contract,chainId:8453,gasMode},settings:async()=>({ticketPrice:1000000n}),walletState:async()=>{if(walletError)throw walletError;return {allowance};},snapshot:async()=>({configured:true})},health:()=>({configured:true}),approvalView:async()=>({configured:true,player:{balance:'5000000',allowance:'2000000',busy:false}}),playView:async()=>({configured:true,player:{balance:'5000000',freeSpins:'2'}}),playerView:async()=>({}),
    start:async(player:string,after:bigint,mode:string,options:{assertSession:()=>void;sendPaid?:()=>unknown})=>{await gate;options.assertSession();if(startError)throw startError;calls.push({player,mode});if(mode==='paid')await options.sendPaid?.();return{stage:'confirming',gameId:'1'};}} as unknown as SlotEngine;
  const relay=createRelay({origin,slot,walletService:fixture.service,now:()=>now,readBalance:async()=>({amount:'5',stale:false,updatedAt:now})});
  function browser(token?:string){let cookie='';return{async call(path:string,body?:unknown){const headers:Record<string,string>={cookie};if(token)headers.Authorization='Bearer '+token;if(body!==undefined){headers.Origin=origin;headers['Content-Type']='application/json';headers['X-Slot-Request']='1';}const r=await relay.handle(new Request(origin+'/api/relay'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)}));if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie')!.split(';')[0];return{status:r.status,body:await r.json()};}};}
  const phone=browser('player-a'),tablet=browser();
  async function connect(){const pair=await tablet.call('/pair',{});await phone.call('/approve',{secret:pairingSecret(pair.body.qr),code:pair.body.code});await tablet.call('/tablet/claim',{});}
  return{playBudgets,setWalletError:(error:Error|undefined)=>{walletError=error;},setStartError:(error:Error)=>{startError=error;},connect,phone,tablet,calls,fixture,close:()=>relay.close(),setAllowance:(value:bigint)=>{allowance=value;},advance:()=>{now+=180001;},setGate:(value:Promise<void>)=>{gate=value;}};
}
test('play consent requires phone authentication and exact bounded allowance; logout revokes the play key',async()=>{
  const s=setup();try{
    await s.connect();
    assert.equal((await s.tablet.call('/tablet/spin',{mode:'paid',afterGameId:'0'})).status,403);
    assert.equal((await s.tablet.call('/phone/play/prepare',{budget:'2000000'})).status,401);
    assert.equal((await s.phone.call('/phone/play/prepare',{budget:'999'})).status,400);
    const prepared=await s.phone.call('/phone/play/prepare',{budget:'2000000'});assert.equal(prepared.status,200);assert.equal(prepared.body.playGrant.budget,'2000000');assert.equal(prepared.body.playGrant.active,false);
    s.setAllowance(2n**256n-1n);assert.equal((await s.phone.call('/phone/play/activate',{})).status,409);
    s.setAllowance(2000000n);assert.equal((await s.phone.call('/phone/play/activate',{})).status,200);
    assert.equal((await s.tablet.call('/tablet/spin',{mode:'paid',afterGameId:'0'})).status,202);
    assert.deepEqual(s.calls,[{player:testAccount.address,mode:'paid'}]);
    await s.tablet.call('/tablet/logout',{});assert.equal(s.fixture.calls.revoke,1);
    assert.equal((await s.tablet.call('/tablet/spin',{mode:'paid',afterGameId:'0'})).status,401);
  }finally{s.close();}
});
test('USDC gas requires explicit additional fee and ETH fallback consent on the phone',async()=>{
  const s=setup('usdc');try{
    await s.connect();
    assert.equal((await s.phone.call('/phone/play/prepare',{budget:'2000000'})).status,400);
    assert.equal((await s.phone.call('/phone/play/prepare',{budget:'2000000',gasConsent:'invalid'})).status,400);
    const prepared=await s.phone.call('/phone/play/prepare',{budget:'2000000',gasConsent:'usdc-then-eth-v1'});
    assert.equal(prepared.status,200);assert.equal(prepared.body.playGrant.gasMode,'usdc');assert.equal(prepared.body.playGrant.budget,'2000000');
  }finally{s.close();}
});
test('free-spin receiver comes from the session, and queued writes are cancelled after expiry',async()=>{
  const s=setup();try{
    await s.connect();
    assert.equal((await s.tablet.call('/tablet/spin',{mode:'free',afterGameId:'0',player:contract})).status,202);
    assert.equal(s.calls[0].player,testAccount.address);
    let release!:()=>void;s.setGate(new Promise(resolve=>{release=resolve;}));
    const queued=s.tablet.call('/tablet/spin',{mode:'free',afterGameId:'1'});
    await new Promise(resolve=>setTimeout(resolve,0));s.advance();release();
    assert.equal((await queued).status,401);assert.equal(s.calls.length,1);
    assert.equal((await s.tablet.call('/tablet/game')).status,401);
  }finally{s.close();}
});

test('rejected spins log only a safe code and public wallet context, without sending',async()=>{
  const s=setup(),messages:string[]=[],warn=console.warn;
  console.warn=(message:string)=>{messages.push(message);};
  try{
    await s.connect();s.setStartError(new SlotError('InsufficientPrizeInventory','restock required'));
    const result=await s.tablet.call('/tablet/spin',{mode:'free',afterGameId:'0'});
    assert.equal(result.status,409);assert.equal(result.body.code,'InsufficientPrizeInventory');assert.equal(s.calls.length,0);
    assert.deepEqual(JSON.parse(messages[0]),{event:'slot.spin_rejected',player:testAccount.address,mode:'free',afterGameId:'0',code:'InsufficientPrizeInventory'});
    s.setStartError(new Error('sensitive upstream request bytes and credential URL'));
    assert.equal((await s.tablet.call('/tablet/spin',{mode:'free',afterGameId:'0'})).status,503);
    assert.equal(JSON.parse(messages[1]).code,'Unavailable');
    logSpinFailure('slot.spin_submission_failed',testAccount.address,'paid','0',new Error('sensitive signing material'),'uncertain');
    assert.equal(JSON.parse(messages[2]).stage,'uncertain');
    assert.equal(messages.some(message=>message.includes('sensitive')),false);
  }finally{console.warn=warn;s.close();}
});


test('approval snapshot requires the paired phone and does not renew inactivity',async()=>{
  const s=setup();try{
    await s.connect();
    assert.equal((await s.tablet.call('/phone/approval')).status,401);
    const response=await s.phone.call('/phone/approval');
    assert.equal(response.status,200);assert.equal(response.body.player.allowance,'2000000');
    assert.equal('game' in response.body.player,false);
    s.advance();assert.equal((await s.phone.call('/phone/approval')).status,401);
  }finally{s.close();}
});

test('new sessions reuse the remaining onchain allowance and still revoke their signer at logout',async()=>{
 const s=setup('usdc');try{
  for(const budget of ['2750000','1750000']){
   await s.connect();s.setAllowance(BigInt(budget));
   assert.equal((await s.tablet.call('/tablet/spin',{mode:'paid',afterGameId:'0'})).status,403);
   const prepared=await s.phone.call('/phone/play/prepare',{budget,reuseAllowance:true,gasConsent:'usdc-then-eth-v1'});
   assert.equal(prepared.status,200);assert.equal(prepared.body.playGrant.budget,budget);
   assert.equal((await s.phone.call('/phone/play/activate',{})).status,200);
   assert.equal((await s.tablet.call('/tablet/spin',{mode:'paid',afterGameId:'0'})).status,202);
   assert.equal((await s.tablet.call('/tablet/logout',{})).status,200);
  }
  assert.deepEqual(s.playBudgets,['2750000','1750000']);assert.equal(s.fixture.calls.revoke,2);
 }finally{s.close();}
});

test('reuse rejects stale, revoked or unreadable limits without creating a signer',async()=>{
 const s=setup();try{
  await s.connect();s.setAllowance(2500000n);
  assert.equal((await s.phone.call('/phone/play/prepare',{budget:'5000000',reuseAllowance:true})).status,409);
  s.setAllowance(0n);
  assert.equal((await s.phone.call('/phone/play/prepare',{budget:'2500000',reuseAllowance:true})).status,409);
  s.setWalletError(new Error('RPC unavailable'));
  assert.equal((await s.phone.call('/phone/play/prepare',{budget:'2500000',reuseAllowance:true})).status,503);
  assert.deepEqual(s.playBudgets,[]);
 }finally{s.close();}
});

test('reuse recovers an unfinished grant and activation rechecks the allowance without broadening consent',async()=>{
 const s=setup();try{
  await s.connect();await s.phone.call('/phone/play/prepare',{budget:'5000000'});
  s.setAllowance(2500000n);
  const reused=await s.phone.call('/phone/play/prepare',{budget:'2500000',reuseAllowance:true});
  assert.equal(reused.status,200);assert.equal(reused.body.playGrant.budget,'2500000');assert.equal(s.playBudgets.length,1);
  s.setAllowance(3000000n);assert.equal((await s.phone.call('/phone/play/activate',{})).status,409);
  s.setAllowance(0n);assert.equal((await s.phone.call('/phone/play/activate',{})).status,409);
  s.setAllowance(2500000n);assert.equal((await s.phone.call('/phone/play/activate',{})).status,200);
  assert.equal((await s.phone.call('/phone/play/prepare',{budget:'2500000',reuseAllowance:true})).status,409);
 }finally{s.close();}
});

test('any positive existing allowance can enable a session, including one base unit and uint256 maximum',async()=>{
 for(const allowance of [1n,2n**256n-1n]){
  const s=setup();try{
   await s.connect();s.setAllowance(allowance);
   const prepared=await s.phone.call('/phone/play/prepare',{budget:String(allowance),reuseAllowance:true});
   assert.equal(prepared.status,200);assert.equal(prepared.body.playGrant.budget,String(allowance));
   assert.equal((await s.phone.call('/phone/play/activate',{})).status,200);
  }finally{s.close();}
 }
});
