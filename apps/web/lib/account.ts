import QRCode from 'qrcode';
import type {Address} from 'viem';
import type {Portfolio} from './portfolio';
import type {Balance, WalletService} from './types';

export type AccountView = {
  userId: string;
  wallet: {address: string; depositQr: string; balance: Balance; portfolio?:Portfolio|null} | null;
};

// This is self-service wallet access, not an admin authorization endpoint.
// No machine data, privileged commands, or arbitrary address lookups are exposed.
export function createAccountHandler(walletService: WalletService | undefined, readBalance: (address: string) => Promise<Balance>, readPortfolio?: (address:Address)=>Promise<Portfolio>) {
  const reply = (body: unknown, status = 200) => Response.json(body, {status,
    headers: {'Cache-Control': 'no-store', 'Vary': 'Authorization', 'Referrer-Policy': 'no-referrer'}});
  return async (request: Request) => {
    if (request.method !== 'GET') return reply({error: 'Method not allowed.'}, 405);
    if (!walletService) return reply({error: 'Wallet access not configured yet.'}, 503);
    const token = request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1];
    if (!token || token.length > 16_000) return reply({error: 'Accedi per vedere il tuo wallet.'}, 401);
    let user;
    try {user = await walletService.authenticate(token);}
    catch {return reply({error: 'Access not verified. Sign in again.'}, 401);}
    const wallet = user.wallets.find(item=>item.index===0)||user.wallets[0];
    if (!wallet) return reply({userId: user.userId, wallet: null} satisfies AccountView);
    try {
      const [balance, depositQr, portfolio] = await Promise.all([
        readBalance(wallet.address), QRCode.toDataURL(wallet.address, {width: 280, margin: 2, errorCorrectionLevel: 'M'}),
        readPortfolio?.(wallet.address as Address).catch(()=>null),
      ]);
      return reply({userId: user.userId, wallet: {address: wallet.address, depositQr, balance, ...(readPortfolio?{portfolio}: {})}} satisfies AccountView);
    } catch {return reply({error: 'Wallet temporarily unavailable. Try again.'}, 503);}
  };
}
