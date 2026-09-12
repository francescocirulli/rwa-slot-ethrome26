import type {Address} from 'viem';
import type {Identity, Wallet, WalletService} from './types';
import {welcomeStartBlock} from './slot/welcome-start';
import type {SlotEngine} from './slot/engine';

export type WelcomeView = {status: 'unavailable' | 'checking' | 'ineligible' | 'pending' | 'granted'; amount: '2'; error?: string};
export function createWelcomeService(wallets: WalletService, slot: SlotEngine) {
  const starts=new Map<string,bigint>();
  const pending = new Map<string, Promise<WelcomeView>>();
  async function request(user: Identity, wallet: Wallet): Promise<WelcomeView> {
    const key = `${user.userId}:${wallet.id}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const task = (async (): Promise<WelcomeView> => {
      if (!wallets.welcomeWallet) return {status: 'unavailable', amount: '2'};
      const registration = await wallets.welcomeWallet(user);
      if(!registration)return {status:'checking',amount:'2'};
      if (registration.wallet.id !== wallet.id || registration.wallet.address.toLowerCase() !== wallet.address.toLowerCase()) {
        return {status: 'ineligible', amount: '2'};
      }
      // The deployment block is a durable launch cutoff. Privy timestamps are server-verified milliseconds.
      const launch = await slot.reader.client.getBlock({blockNumber: slot.reader.config.deploymentBlock});
      if (registration.createdAt < Number(launch.timestamp) * 1000) return {status: 'ineligible', amount: '2'};
      const registrationKey=`${key}:${wallet.address.toLowerCase()}:${registration.createdAt}`;
      let fromBlock=starts.get(registrationKey);
      if(fromBlock===undefined){
        fromBlock=await welcomeStartBlock(slot.reader,registration.createdAt);
        if(starts.size>=512)starts.delete(starts.keys().next().value!);
        starts.set(registrationKey,fromBlock);
      }
      return slot.queueWelcome(wallet.address as Address,fromBlock);
    })().catch((): WelcomeView => ({status: 'unavailable', amount: '2', error: 'The welcome bonus is pending. We retry automatically.'}));
    pending.set(key, task);
    try {return await task;} finally {if (pending.get(key) === task) pending.delete(key);}
  }
  return {request};
}
export type WelcomeService = ReturnType<typeof createWelcomeService>;
