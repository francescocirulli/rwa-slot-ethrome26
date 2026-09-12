import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountHandler} from '../lib/account';
import {walletFixture} from './fixtures';

test('account endpoint requires verified authentication and returns only the owner’s embedded wallet', async () => {
  const fixture = walletFixture();
  const reads: string[] = [];
  const handler = createAccountHandler(fixture.service, async address => {reads.push(address); return {amount: '0', stale: false, updatedAt: 1};});
  assert.equal((await handler(new Request('http://app/api/account'))).status, 401);
  assert.equal((await handler(new Request('http://app/api/account', {headers: {Authorization: 'Bearer invalid'}}))).status, 401);
  assert.deepEqual(reads, []);
  const user = await fixture.service.authenticate('player-a');
  const response = await handler(new Request('http://app/api/account?address=0x0000000000000000000000000000000000000000', {headers: {Authorization: 'Bearer player-a'}}));
  const value = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(value.userId, user.userId); assert.equal(value.wallet.address, user.wallets[0].address);
  assert.equal(value.wallet.balance.amount, '0'); assert.match(value.wallet.depositQr, /^data:image\/png;base64,/);
  assert.deepEqual(reads, [user.wallets[0].address]);
  assert.equal((await handler(new Request('http://app/api/account', {method: 'POST', headers: {Authorization: 'Bearer player-a'}}))).status, 405);
});
test('account endpoint distinguishes missing wallet from unavailable service', async () => {
  const fixture = walletFixture();
  const handler = createAccountHandler({...fixture.service, authenticate: async () => ({userId: 'did:privy:new', wallets: []})}, async () => {throw new Error('Must not read a missing wallet');});
  const response = await handler(new Request('http://app/api/account', {headers: {Authorization: 'Bearer new-user'}}));
  assert.deepEqual(await response.json(), {userId: 'did:privy:new', wallet: null});
  assert.equal((await createAccountHandler(undefined, async () => {throw new Error();})(new Request('http://app/api/account'))).status, 503);
});

test('wallet display selects the same first Privy wallet as the welcome claim regardless of list order',async()=>{
  const f=walletFixture(),user=await f.service.authenticate('player-a');
  const first={...user.wallets[0],index:0};
  const other={id:'second',address:'0x0000000000000000000000000000000000000099',index:1};
  const handler=createAccountHandler({...f.service,authenticate:async()=>({...user,wallets:[other,first]})},async address=>{assert.equal(address,first.address);return {amount:'0',stale:false,updatedAt:1};});
  const result=await handler(new Request('http://app/api/account',{headers:{Authorization:'Bearer player-a'}}));
  assert.equal((await result.json()).wallet.address,first.address);
});
