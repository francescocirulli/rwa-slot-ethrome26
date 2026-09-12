import test from 'node:test';
import assert from 'node:assert/strict';
import {createWelcomeService} from '../lib/welcome';
import type {SlotEngine} from '../lib/slot/engine';
import {walletFixture, testAccount} from './fixtures';

test('welcome eligibility uses verified first-wallet creation time and never a supplied destination', async () => {
  const fixture = walletFixture(), user = await fixture.service.authenticate('player-a'), wallet = user.wallets[0];
  let createdAt = 1000000, calls = 0;
  fixture.service.welcomeWallet = async () => ({wallet, createdAt});
  const slot = {reader: {config: {deploymentBlock: 10n}, client: {getBlock: async () => ({number:10n,timestamp: 1000n})}},
    queueWelcome: async (address: string) => {assert.equal(address, testAccount.address); calls++; return {status: 'pending', amount: '2'};}} as unknown as SlotEngine;
  const service = createWelcomeService(fixture.service, slot);
  assert.equal((await service.request(user, wallet)).status, 'pending'); assert.equal(calls, 1);
  createdAt = 999999;
  assert.equal((await service.request(user, wallet)).status, 'ineligible'); assert.equal(calls, 1);
  createdAt = 1000000;
  assert.equal((await service.request(user, {...wallet, address: '0x0000000000000000000000000000000000000099'})).status, 'ineligible');
  assert.equal((await service.request(user, {...wallet, id: 'another-wallet'})).status, 'ineligible'); assert.equal(calls, 1);
  fixture.service.welcomeWallet = async () => null;
  assert.equal((await service.request(user, wallet)).status, 'checking'); assert.equal(calls, 1);
});

test('concurrent welcome requests share registration checks and a transient failure can recover', async () => {
  const fixture = walletFixture(), user = await fixture.service.authenticate('player-a'), wallet = user.wallets[0];
  let release!: () => void, checks = 0, writes = 0, fail = false;
  const gate = new Promise<void>(resolve => {release = resolve;});
  fixture.service.welcomeWallet = async () => {checks++; await gate; if (fail) throw new Error('private provider error'); return {wallet, createdAt: 2000000};};
  const slot = {reader: {config: {deploymentBlock: 10n}, client: {getBlock: async () => ({number:10n,timestamp: 1000n})}},
    queueWelcome: async () => {writes++; return {status: 'pending', amount: '2'};}} as unknown as SlotEngine;
  const service = createWelcomeService(fixture.service, slot);
  const a = service.request(user, wallet), b = service.request(user, wallet); release();
  assert.deepEqual(await a, await b); assert.equal(checks, 1); assert.equal(writes, 1);
  fail = true; const unavailable = await service.request(user, wallet);
  assert.equal(unavailable.status, 'unavailable'); assert.doesNotMatch(JSON.stringify(unavailable), /private provider/); assert.equal(writes, 1);
  fail = false; assert.equal((await service.request(user, wallet)).status, 'pending'); assert.equal(writes, 2);
});

test('wallet birth bounds start before creation and are independent of a raised player-history floor',async()=>{
  const {welcomeStartBlock}=await import('../lib/slot/welcome-start');
  const reads:bigint[]=[];
  const reader={config:{deploymentBlock:10n,historyFromBlock:999n},client:{getBlock:async({blockNumber}:{blockNumber?:bigint})=>{
    const number=blockNumber??1000n;reads.push(number);return {number,timestamp:1000n+number*2n};
  }}} as unknown as SlotEngine['reader'];
  assert.equal(await welcomeStartBlock(reader,2800000),749n);
  assert.ok(reads.length<15,'binary search avoids scanning unrelated lifetime history');
  assert.equal(await welcomeStartBlock(reader,1020000),10n);
});
