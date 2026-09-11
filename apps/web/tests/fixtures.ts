import {privateKeyToAccount} from 'viem/accounts';
import {PNG} from 'pngjs';
import jsQR from 'jsqr';
import type {Grant, WalletService} from '../lib/types';

// Test-only identity and key. Never imported by the application.
export const testAccount = privateKeyToAccount('0x1111111111111111111111111111111111111111111111111111111111111111');
export function pairingSecret(qr: string) {
  const png = PNG.sync.read(Buffer.from(qr.split(',')[1], 'base64'));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!result) throw new Error('QR not decodable');
  return new URLSearchParams(new URL(result.data).hash.slice(1)).get('pair')!;
}
export function walletFixture() {
  const calls = {sign: 0, revoke: 0, prepare: 0};
  let prepareGate: Promise<void> | undefined, authGate: Promise<void> | undefined, signGate: Promise<void> | undefined;
  const service: WalletService = {
    async authenticate(token) {
      await authGate;
      if (!['player-a', 'player-b', 'no-wallet'].includes(token)) throw new Error('Invalid token');
      return {userId: `did:privy:${token}`, wallets: token === 'no-wallet' ? [] : [{id: `wallet-${token}`, address: testAccount.address}]};
    },
    async prepare(wallet, userId, sessionId) {
      calls.prepare++; await prepareGate;
      return {id: sessionId, signerId: `signer-${sessionId}`, policyId: `policy-${sessionId}`, walletId: wallet.id,
        address: wallet.address, active: false, message: `Lucky Signal — prova di collegamento ${sessionId}. Nessun trasferimento.`};
    },
    async activate(grant) {grant.active = true;},
    async sign(grant) {calls.sign++; await signGate; return testAccount.signMessage({message: grant.message});},
    revoke(grant: Grant) {calls.revoke++; grant.active = false;},
  };
  return {service, calls, setPrepareGate(value: Promise<void>) {prepareGate = value;},
    setAuthGate(value: Promise<void>) {authGate = value;}, setSignGate(value: Promise<void>) {signGate = value;}};
}
