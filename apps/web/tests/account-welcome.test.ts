import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountWelcomeHandler} from '../lib/account-welcome';
import {walletFixture} from './fixtures';
import type {WelcomeService} from '../lib/welcome';
const origin='http://app';
test('welcome claim needs no pairing, verifies identity and ignores a supplied recipient',async()=>{
  const f=walletFixture(),user=await f.service.authenticate('player-a');let calls=0;
  const bonus={request:async(u,w)=>{calls++;assert.equal(u.userId,user.userId);assert.equal(w.address,user.wallets[0].address);return {status:'pending',amount:'2'};}} as WelcomeService;
  const handler=createAccountWelcomeHandler(f.service,bonus,origin);
  const request=(headers:Record<string,string>={},method='POST')=>new Request(origin+'/api/account/welcome?address=attacker',{method,headers:{Origin:origin,Authorization:'Bearer player-a',...headers}});
  assert.equal((await handler(request({},'GET'))).status,405);
  assert.equal((await handler(request({Origin:'https://attacker.example'}))).status,403);
  assert.equal((await handler(request({Authorization:'Bearer invalid'}))).status,401);
  assert.equal(calls,0);
  const response=await handler(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'pending',amount:'2'});assert.equal(calls,1);
});
test('missing wallet metadata stays retryable until the verified account exposes its wallet',async()=>{
  const f=walletFixture();let ready=false,calls=0;
  const wallets={...f.service,authenticate:async(token:string)=>ready?f.service.authenticate(token):{userId:'did:privy:new',wallets:[]}};
  const handler=createAccountWelcomeHandler(wallets,{request:async()=>{calls++;return {status:'granted',amount:'2'};}} as WelcomeService,origin);
  const req=()=>new Request(origin+'/api/account/welcome',{method:'POST',headers:{Origin:origin,Authorization:'Bearer player-a'}});
  assert.equal((await (await handler(req())).json()).status,'checking');assert.equal(calls,0);
  ready=true;assert.equal((await (await handler(req())).json()).status,'granted');assert.equal(calls,1);
});
