import {createAccountHandler} from '@/lib/account';
import {createWalletService} from '@/lib/privy';
import {createBalanceReader} from '@/lib/balance';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
let handler: ReturnType<typeof createAccountHandler> | undefined;
export async function GET(request: Request) {
  if (!handler) {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID, secret = process.env.PRIVY_APP_SECRET;
    handler = createAccountHandler(appId && secret ? createWalletService(appId, secret) : undefined, createBalanceReader(process.env.BASE_RPC_URL));
  }
  return handler(request);
}
