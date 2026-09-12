import {afterEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {verifyMessage} from 'viem';
import {createRelay} from '../lib/relay';
import {proofPolicy} from '../lib/privy';
import {IDLE_MS} from '../lib/types';
import type {WelcomeService} from '../lib/welcome';
import {pairingSecret, testAccount, walletFixture} from './fixtures';

const origin = 'https://slot.example';
const cleanups: Array<() => void> = [];
afterEach(() => {while (cleanups.length) cleanups.pop()!();});
function setup(welcome?: WelcomeService) {
  let time = 1_800_000_000_000;
  const fixture = walletFixture();
  const relay = createRelay({origin, walletService: fixture.service, now: () => time, welcome,
    readBalance: async () => ({amount: '12.345678', updatedAt: time, stale: false})});
  cleanups.push(() => relay.close());
  function browser(token?: string) {
    let cookie = '';
    return {
      cookie: () => cookie,
      async call(path: string, data?: unknown, options: {origin?: string; noHeader?: boolean; cookie?: string} = {}) {
        const headers: Record<string, string> = {cookie: options.cookie ?? cookie};
        if (token) headers.Authorization = `Bearer ${token}`;
        if (data !== undefined) {headers.Origin = options.origin ?? origin; headers['Content-Type'] = 'application/json'; if (!options.noHeader) headers['X-Slot-Request'] = '1';}
        const response = await relay.handle(new Request(origin + '/api/relay' + path, {
          method: data === undefined ? 'GET' : 'POST', headers, body: data === undefined ? undefined : JSON.stringify(data),
        }));
        const set = response.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0];
        return {status: response.status, body: await response.json(), headers: response.headers};
      },
    };
  }
  const tablet = browser(), phone = browser('player-a');
  async function pair() {
    const result = await tablet.call('/pair', {});
    assert.equal(result.status, 201);
    return {...result.body, secret: pairingSecret(result.body.qr)};
  }
  async function connect() {
    const pending = await pair();
    assert.equal((await phone.call('/approve', {secret: pending.secret, code: pending.code})).status, 200);
    const result = await tablet.call('/tablet/claim', {});
    assert.equal(result.status, 200); return result.body;
  }
  async function authorize() {
    await connect(); await phone.call('/phone/prepare', {}); await phone.call('/phone/activate', {});
  }
  return {tablet, phone, browser, pair, connect, authorize, fixture, advance: (ms: number) => {time += ms;}};
}

test('tablet bundle parses as ES5 and never includes wallet SDK or credential storage', () => {
  const js = readFileSync('public/terminal/client.js', 'utf8');
  parse(js, {ecmaVersion: 5});
  const game = readFileSync('public/terminal/game.js', 'utf8');
  parse(game, {ecmaVersion: 5});
  assert.doesNotMatch(game, /localStorage|sessionStorage|Bearer /);
  const html = readFileSync('public/terminal/index.html', 'utf8');
  assert.equal((html.match(/class="reel"/g) || []).length, 5);
  assert.equal((html.match(/class="cell(?: middle)?"/g) || []).length, 15);
  assert.doesNotMatch(html, /type="module"|_next\/|react-auth/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|Bearer /);
});

test('pairing automatically requests the welcome bonus and recovery stays authenticated without extending inactivity', async () => {
  const calls: string[] = [];
  const s = setup({request: async (user, wallet) => {assert.equal(user.userId, 'did:privy:player-a'); calls.push(wallet.address); return {status: 'pending', amount: '2'};}});
  const connected = await s.connect();
  assert.deepEqual(calls, [testAccount.address]);
  const initialExpiry = connected.expiresAt;
  s.advance(60000);
  const response = await s.phone.call('/phone/welcome', {player: '0x0000000000000000000000000000000000000099', amount: '999'});
  assert.equal(response.status, 200); assert.equal(response.body.expiresAt, initialExpiry);
  assert.deepEqual(response.body.welcome, {status: 'pending', amount: '2'});
  assert.deepEqual(calls, [testAccount.address, testAccount.address]);
  await s.phone.call('/phone'); await s.tablet.call('/tablet');
  assert.equal(calls.length, 2);
  assert.equal((await s.tablet.call('/phone/welcome', {})).status, 401);
  assert.equal((await s.phone.call('/phone/welcome', {}, {origin: 'https://other.example'})).status, 403);
  const stolenCookie = s.phone.cookie();
  assert.equal((await s.browser('player-b').call('/phone/welcome', {}, {cookie: stolenCookie})).status, 403);
  s.advance(120001);
  assert.equal((await s.phone.call('/phone/welcome', {})).status, 401); assert.equal(calls.length, 2);
});

test('pair QR decodes, approval verifies ownership, tablet cookie rotates and no credentials leak', async () => {
  const s = setup(); const pending = await s.pair(); const oldCookie = s.tablet.cookie();
  const lookup = await s.browser().call('/lookup', {secret: pending.secret});
  assert.equal(lookup.body.code, pending.code);
  assert.equal((await s.phone.call('/approve', {secret: pending.secret, code: pending.code})).status, 200);
  const claimed = await s.tablet.call('/tablet/claim', {});
  assert.notEqual(s.tablet.cookie(), oldCookie);
  assert.match(claimed.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax; Secure/);
  assert.equal((await s.tablet.call('/tablet', undefined, {cookie: oldCookie})).status, 401);
  assert.equal(claimed.body.address, testAccount.address);
  assert.doesNotMatch(JSON.stringify(claimed.body), /player-a|privateKey|authorization|secret|wallet-player/);
  assert.equal(claimed.body.qr, undefined);
  assert.equal((await s.phone.call('/approve', {secret: pending.secret, code: pending.code})).status, 410);
});

test('wrong origin, missing CSRF header, invalid JWT and absent embedded wallet are rejected', async () => {
  const s = setup();
  assert.equal((await s.tablet.call('/pair', {}, {origin: 'https://evil.example'})).status, 403);
  assert.equal((await s.tablet.call('/pair', {}, {noHeader: true})).status, 403);
  const p = await s.pair();
  assert.equal((await s.browser('invalid').call('/approve', {secret: p.secret, code: p.code})).status, 401);
  assert.equal((await s.phone.call('/approve', {secret: p.secret, code: '000000'})).status, 400);
  assert.equal((await s.browser('no-wallet').call('/approve', {secret: p.secret, code: p.code})).status, 409);
});

test('two racing approvals cannot both consume the QR', async () => {
  const s = setup(), p = await s.pair();
  let release!: () => void; s.fixture.setAuthGate(new Promise((resolve) => {release = resolve;}));
  const a = s.phone.call('/approve', {secret: p.secret, code: p.code});
  const b = s.browser('player-b').call('/approve', {secret: p.secret, code: p.code});
  release(); const results = await Promise.all([a, b]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});

test('QR expires and polling does not renew it', async () => {
  const s = setup(), p = await s.pair(); s.advance(299000);
  assert.equal((await s.tablet.call('/tablet')).status, 200);
  s.advance(1001);
  assert.equal((await s.phone.call('/approve', {secret: p.secret, code: p.code})).status, 410);
});

test('global phone/tablet activity renews exactly three minutes; polling does not renew', async () => {
  const s = setup(); const original = await s.connect();
  s.advance(170000); const polled = await s.tablet.call('/tablet');
  assert.equal(polled.body.expiresAt, original.expiresAt);
  const touched = await s.phone.call('/phone/activity', {});
  assert.equal(touched.body.expiresAt - touched.body.serverTime, IDLE_MS);
  s.advance(170000); assert.equal((await s.tablet.call('/tablet')).status, 200);
  await s.tablet.call('/tablet/activity', {});
  s.advance(179999); assert.equal((await s.phone.call('/phone')).status, 200);
  s.advance(1); assert.equal((await s.tablet.call('/tablet')).status, 401);
  assert.equal((await s.phone.call('/phone/activity', {})).status, 401);
});

test('active session has no fixed 15-minute cap', async () => {
  const s = setup(); await s.authorize();
  for (let i = 0; i < 15; i++) {s.advance(120000); assert.equal((await s.tablet.call('/tablet/activity', {})).status, 200);}
  assert.equal((await s.tablet.call('/tablet/sign', {})).body.proof.status, 'verified');
});

test('signer works with phone offline, signs once and verifies the wallet signature', async () => {
  const s = setup(); await s.authorize();
  const result = await s.tablet.call('/tablet/sign', {});
  assert.equal(result.body.proof.status, 'verified');
  assert.equal(await verifyMessage({address: testAccount.address, message: result.body.proof.message, signature: result.body.proof.signature}), true);
  await s.tablet.call('/tablet/sign', {}); assert.equal(s.fixture.calls.sign, 1);
  assert.equal((await s.tablet.call('/tablet/transaction', {})).status, 404);
});

test('policy allows only exact-message personal_sign, never transfers or typed data', () => {
  const rules = proofPolicy('exact session proof');
  assert.equal(rules.length, 1); assert.equal(rules[0].method, 'personal_sign');
  assert.deepEqual(rules[0].conditions, [{field_source: 'message', field: 'content', operator: 'eq', value: 'exact session proof'}]);
});

test('logout revokes signer and isolates the next user', async () => {
  const s = setup(); await s.authorize(); const previousCookie = s.tablet.cookie();
  assert.equal((await s.phone.call('/phone/logout', {})).status, 200);
  assert.equal(s.fixture.calls.revoke, 1);
  assert.equal((await s.tablet.call('/tablet/sign', {})).status, 401);
  const next = await s.tablet.call('/pair', {});
  assert.equal(next.body.address, undefined); assert.equal(next.body.proof, undefined);
  assert.equal((await s.tablet.call('/tablet', undefined, {cookie: previousCookie})).status, 401);
});

test('a signer prepared after a concurrent logout is destroyed and never attached', async () => {
  const s = setup(); await s.connect();
  let release!: () => void; s.fixture.setPrepareGate(new Promise((resolve) => {release = resolve;}));
  const preparing = s.phone.call('/phone/prepare', {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  await s.tablet.call('/tablet/logout', {}); release();
  assert.equal((await preparing).status, 401); assert.equal(s.fixture.calls.revoke, 1);
});

test('in-flight signature cannot restore an expired session', async () => {
  const s = setup(); await s.authorize();
  let release!: () => void; s.fixture.setSignGate(new Promise((resolve) => {release = resolve;}));
  const signing = s.tablet.call('/tablet/sign', {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  s.advance(IDLE_MS); release();
  assert.equal((await signing).status, 401);
});

test('phone cookie cannot be used with another account and balances retain precision', async () => {
  const s = setup(); await s.connect();
  assert.equal((await s.browser('player-b').call('/phone', undefined, {cookie: s.phone.cookie()})).status, 403);
  const balance = await s.tablet.call('/tablet/balance');
  assert.equal(balance.body.balance.amount, '12.345678');
});
