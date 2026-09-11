import type {Address, Hash} from 'viem';
import type {SubmittedSpin} from './slot/engine';
import type {GasMode, GasToken} from './slot/gas';
export const IDLE_MS = 180_000;
export const PAIR_MS = 300_000;
export const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
export const CHAIN_ID = 8453;

export type Wallet = {id: string; address: string};
export type Identity = {userId: string; wallets: Wallet[]};
export type Grant = {
  id: string; signerId: string; policyId: string; walletId: string;
  address: string; message: string; active: boolean;
};
export type PlayGrant = Grant & {contract: Address; chainId: number; budget: string; gasMode?: GasMode};
export type SignatureProof = {status: 'pending' | 'verified' | 'error'; signature?: string; message: string};
export type Session = {
  id: string; code: string; secretHash: string; tabletHash: string; phoneHash?: string;
  state: 'pending' | 'approved' | 'active'; createdAt: number; expiresAt: number;
  userId?: string; wallet?: Wallet; grant?: Grant; proof?: SignatureProof;
  busy?: boolean; qr?: string; playGrant?: PlayGrant;
};
export type Balance = {amount: string | null; updatedAt: number | null; stale: boolean};
export type SessionView = {
  id: string; state: 'pending' | 'approved' | 'active'; code: string; expiresAt: number; serverTime: number;
  qr?: string; address?: string; depositQr?: string; balance?: Balance;
  grant?: {active: boolean; signerId: string; policyId: string; message: string};
  proof?: SignatureProof;
  playGrant?: {active: boolean; signerId: string; policyId: string; contract: Address; chainId: number; budget: string; gasMode?: GasMode};
};
export interface WalletService {
  authenticate(token: string): Promise<Identity>;
  verifyIdentityToken?(token:string,userId:string):Promise<void>;
  prepare(wallet: Wallet, userId: string, sessionId: string, code: string): Promise<Grant>;
  activate(grant: Grant): Promise<void>;
  sign(grant: Grant): Promise<string>;
  revoke(grant: Grant): void;
  preparePlay?(wallet: Wallet, userId: string, sessionId: string, code: string, contract: Address, chainId: number, budget: string): Promise<PlayGrant>;
  sendSpin?(grant: PlayGrant, idempotencyKey: string, mode: GasMode, assertValid: () => void): Promise<SubmittedSpin>;
  sendOwned?(wallet: Wallet, token: string, transaction: {to: Address; data: `0x${string}`; chainId: number; value?: `0x${string}`}, idempotencyKey: string, mode: GasMode, onGasToken: (token: GasToken) => void, assertValid?:()=>void|Promise<void>): Promise<SubmittedSpin>;
  resolveSpin?(submission: SubmittedSpin): Promise<Hash | undefined>;
}
