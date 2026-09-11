import QRCode from 'qrcode';
import type {Balance, WalletService} from './types';

export type AccountView = {
  userId: string;
  wallet: {address: string; depositQr: string; balance: Balance} | null;
};

// This is self-service wallet access, not an admin authorization endpoint.
// No machine data, privileged commands, or arbitrary address lookups are exposed.
export function createAccountHandler(walletService: WalletService | undefined, readBalance: (address: string) => Promise<Balance>) {
  const reply = (body: unknown, status = 200) => Response.json(body, {status,
    headers: {'Cache-Control': 'no-store', 'Vary': 'Authorization', 'Referrer-Policy': 'no-referrer'}});
  return async (request: Request) => {
    if (request.method !== 'GET') return reply({error: 'Metodo non consentito.'}, 405);
    if (!walletService) return reply({error: 'Accesso wallet non ancora configurato.'}, 503);
    const token = request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1];
    if (!token || token.length > 16_000) return reply({error: 'Accedi per vedere il tuo wallet.'}, 401);
    let user;
    try {user = await walletService.authenticate(token);}
    catch {return reply({error: 'Accesso non verificato. Accedi di nuovo.'}, 401);}
    const wallet = user.wallets[0];
    if (!wallet) return reply({userId: user.userId, wallet: null} satisfies AccountView);
    try {
      const [balance, depositQr] = await Promise.all([
        readBalance(wallet.address), QRCode.toDataURL(wallet.address, {width: 280, margin: 2, errorCorrectionLevel: 'M'}),
      ]);
      return reply({userId: user.userId, wallet: {address: wallet.address, depositQr, balance}} satisfies AccountView);
    } catch {return reply({error: 'Wallet temporaneamente non disponibile. Riprova.'}, 503);}
  };
}
