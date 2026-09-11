import {createPublicClient, erc20Abi, formatUnits, http} from 'viem';
import {base} from 'viem/chains';
import {USDC, type Balance} from './types';

export function createBalanceReader(url = 'https://mainnet.base.org') {
  const client = createPublicClient({chain: base, transport: http(url, {timeout: 8_000, retryCount: 0})});
  const cache = new Map<string, Balance & {checkedAt: number}>();
  const pending = new Map<string, Promise<Balance>>();
  return async (address: string): Promise<Balance> => {
    const key = address.toLowerCase();
    const previous = cache.get(key);
    if (previous && Date.now() - previous.checkedAt < 10_000) return previous;
    const running = pending.get(key);
    if (running) return running;
    const request = (async () => {
      let value: Balance;
      try {
        const amount = await client.readContract({address: USDC, abi: erc20Abi,
          functionName: 'balanceOf', args: [address as `0x${string}`]});
        value = {amount: formatUnits(amount, 6), updatedAt: Date.now(), stale: false};
      } catch {
        value = {amount: previous?.amount ?? null, updatedAt: previous?.updatedAt ?? null, stale: true};
      }
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(key, {...value, checkedAt: Date.now()});
      return value;
    })().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
