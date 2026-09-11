import {APIError} from '@privy-io/node';
import {createHash} from 'node:crypto';
import {SlotError} from './errors';

export type GasMode = 'usdc' | 'eth';
export type GasToken = 'USDC' | 'ETH';
export const GAS_CONSENT = 'usdc-then-eth-v1';
export type GasOptions = {sponsor: boolean; sponsor_options?: {asset: 'usdc'}; idempotency_key: string};

function payload(error: APIError) {
  return JSON.stringify(error.error || {}).slice(0, 8000);
}
function hasSubmission(error: APIError) {
  return payload(error).length >= 8000 || /"(?:transaction_id|transaction_hash|user_operation_hash|hash)"\s*:\s*"[^"\s]+"/i.test(payload(error));
}
// Only Privy's explicit pre-submission HTTP 400 balance rejection qualifies.
// Never switch fee currency after a timeout, 5xx, policy failure or submitted tx.
export function insufficientTokenGas(error: unknown): boolean {
  if (!(error instanceof APIError) || error.status !== 400 || hasSubmission(error)) return false;
  const body = payload(error);
  if (/\b(?:revert(?:ed)?|nonce|allowance|AA\d\d|ETH|native)\b/i.test(body)) return false;
  return /\binsufficient_(?:token_|usdc_)?(?:balance|funds)\b/i.test(body) ||
    /\binsufficient (?:USDC |token |stablecoin )?(?:balance|funds)\b/i.test(body) ||
    /\b(?:USDC|token|stablecoin) balance (?:is )?insufficient\b/i.test(body);
}
export function definiteSendFailure(error: unknown): boolean {
  return error instanceof SlotError && ['SessionClosed', 'TransactionFailed', 'GasBalance', 'Cancelled','AdminAccess','AdminAction','AdminOwnerChanged','AdminNotReady','SwapAccess'].includes(error.code) ||
    error instanceof APIError && [400,401,403,404,422].includes(error.status || 0) && !hasSubmission(error);
}
export function transactionError(error: unknown): string {
  if (error instanceof SlotError) return error.message;
  if (error instanceof APIError) {
    const body = payload(error);
    if (error.status === 400 && /insufficient|not enough/i.test(body)) return 'Saldo insufficiente per operazione e commissioni. Ricarica USDC oppure ETH su Base.';
    if (error.status === 400 && /sponsor_options|asset.*config|unsupported|user.pays/i.test(body)) return 'Configura User pays e USDC su Base nel dashboard Privy.';
    if (error.status === 401 || error.status === 403) return 'Privy non ha autorizzato questa operazione. Verifica accesso e permessi del wallet.';
    if ([400,422].includes(error.status || 0)) return 'Privy ha rifiutato la transazione prima dell’invio. Verifica parametri, saldo e configurazione.';
  }
  return 'Invio non verificabile. Controlliamo la richiesta senza inviarne una seconda.';
}
export async function sendWithGas<T>(options: {
  mode: GasMode; key: string; send: (gas: GasOptions) => Promise<T>;
  assertValid?: () => void|Promise<void>; onGasToken?: (token: GasToken) => void;
}): Promise<T & {gasToken: GasToken}> {
  async function attempt(token: GasToken) {
    await options.assertValid?.(); options.onGasToken?.(token);
    const idempotency_key = createHash('sha256').update(options.key + ':' + token).digest('hex');
    const result = await options.send(token === 'USDC' ? {sponsor:true,sponsor_options:{asset:'usdc'},idempotency_key} : {sponsor:false,idempotency_key});
    return {...result, gasToken:token};
  }
  if (options.mode === 'eth') return attempt('ETH');
  try {return await attempt('USDC');}
  catch (error) {if (!insufficientTokenGas(error)) throw error;}
  return attempt('ETH');
}
