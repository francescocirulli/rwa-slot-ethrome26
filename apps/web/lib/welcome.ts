import type {Address} from 'viem';
import type {Identity, Wallet, WalletService} from './types';
import type {SlotEngine} from './slot/engine';

export type WelcomeView = {status: 'unavailable' | 'checking' | 'ineligible' | 'pending' | 'granted'; amount: '2'; error?: string};
export function createWelcomeService(wallets: WalletService, slot: SlotEngine) {
  const pending = new Map<string, Promise<WelcomeView>>();
  async function request(user: Identity, wallet: Wallet): Promise<WelcomeView> {
    const key = `${user.userId}:${wallet.id}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const task = (async (): Promise<WelcomeView> => {
      if (!wallets.welcomeWallet) return {status: 'unavailable', amount: '2'};
      const registration = await wallets.welcomeWallet(user);
      if (!registration || registration.wallet.id !== wallet.id || registration.wallet.address.toLowerCase() !== wallet.address.toLowerCase()) {
        return {status: 'ineligible', amount: '2'};
      }
      // The deployment block is a durable launch cutoff. Privy timestamps are server-verified milliseconds.
      const launch = await slot.reader.client.getBlock({blockNumber: slot.reader.config.deploymentBlock});
      if (registration.createdAt < Number(launch.timestamp) * 1000) return {status: 'ineligible', amount: '2'};
      return slot.queueWelcome(wallet.address as Address);
    })().catch((): WelcomeView => ({status: 'unavailable', amount: '2', error: 'Il bonus di benvenuto è in attesa. Riproviamo automaticamente.'}));
    pending.set(key, task);
    try {return await task;} finally {if (pending.get(key) === task) pending.delete(key);}
  }
  return {request};
}
export type WelcomeService = ReturnType<typeof createWelcomeService>;
