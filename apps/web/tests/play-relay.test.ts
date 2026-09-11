import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelay} from '../lib/relay';
import {walletFixture, pairingSecret, testAccount} from './fixtures';
import type {SlotEngine} from '../lib/slot/engine';
import type {PlayGrant} from '../lib/types';
const origin='https://slot.example';
const contract='0x0000000000000000000000000000000000000099' as const;
function setup(gasMode:'usdc'|'eth'='eth') {
  let now=1000000, allowance=0n, gate:Promise<void>|undefined;
  const fixture=walletFixture(), calls:{player:string;mode:string}[]=[];
  fixture.service.preparePlay=async(wallet,userId,id,code,address,chainId,budget)=>({id:id+'-play',walletId:wallet.id,address:wallet.address,signerId:'signer-play',policyId:'policy-play',message:'',active:false,contract:address,chainId,budget});
  fixture.service.sendSpin=async()=>({hash:('0x'+'a'.repeat(64)) as `0x${string}`});
  const slot={reader:{config:{address:contract,chainId:8453,gasMode},settings:async()=>({ticketPrice:1000000n}),player:async()=>({allowance}),snapshot:async()=>({configured:true})},health:()=>({configured:true}),playerView:async()=>({}),
    start:async(player:string,after:bigint,mode:string,options:{assertSession:()=>void;sendPaid?:()=>unknown})=>{await gate;options.assertSession();calls.push({player,mode});if(mode==='paid')await options.sendPaid?.();return{stage:'confirming',gameId:'1'};}} as unknown as SlotEngine;
  const relay=createRelay({origin,slot,walletService:fixture.service,now:()=>now,readBalance:async()=>({amount:'5',stale:false,updatedAt:now})});
  function browser(token?:string){let cookie='';return{async call(path:string,body?:unknown){const headers:Record<string,string>={cookie};if(token)headers.Authorization='Bearer '+token;if(body!==undefined){headers.Origin=origin;headers['Content-Type']='application/json';headers['X-Slot-Request']='1';}const r=await relay.handle(new Request(origin+'/api/relay'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)}));if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie')!.split(';')[0];return{status:r.status,body:await r.json()};}};}
  const phone=browser('player-a'),tablet=browser();
  async function connect(){const pair=await tablet.call('/pair',{});await phone.call('/approve',{secret:pairingSecret(pair.body.qr),code:pair.body.code});await tablet.call('/tablet/claim',{});}
  return{connect,phone,tablet,calls,fixture,close:()=>relay.close(),setAllowance:(value:bigint)=>{allowance=value;},advance:()=>{now+=180001;},setGate:(value:Promise<void>)=>{gate=value;}};
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
