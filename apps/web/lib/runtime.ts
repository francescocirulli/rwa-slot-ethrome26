import {getSlotEngine} from './slot/runtime';
import {createRelay} from './relay';
import {createWalletService} from './privy';
import {createBalanceReader} from './balance';
import {createWelcomeService} from './welcome';

const state = globalThis as typeof globalThis & {slotRelay?: ReturnType<typeof createRelay>};
export function getRelay() {
  if (!state.slotRelay) {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const secret = process.env.PRIVY_APP_SECRET;
    const origin = process.env.APP_ORIGIN || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
    if (!origin && process.env.NODE_ENV === 'production') throw new Error('APP_ORIGIN is required');
    const walletService = appId && secret ? createWalletService(appId, secret) : undefined;
    const slot = getSlotEngine();
    state.slotRelay = createRelay({origin: origin || 'http://localhost:3000', walletService, slot,
      welcome: walletService && slot ? createWelcomeService(walletService, slot) : undefined,
      readBalance: createBalanceReader(process.env.BASE_RPC_URL)});
  }
  return state.slotRelay;
}
