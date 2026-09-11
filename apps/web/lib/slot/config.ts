import {getAddress, isAddress, type Address} from 'viem';
import {USDC} from '../types';
import type {GasMode} from './gas';
export type SlotConfig = {address: Address; deploymentBlock: bigint; chainId: number; rpcUrl: string; paymentToken: Address; gasMode: GasMode; confirmations: number};
export function loadSlotConfig(env = process.env): SlotConfig | null {
  if (!env.SLOT_CONTRACT_ADDRESS) return null;
  if (!isAddress(env.SLOT_CONTRACT_ADDRESS) || !/^\d+$/.test(env.SLOT_DEPLOYMENT_BLOCK || '')) throw new Error('Configure SLOT_CONTRACT_ADDRESS and SLOT_DEPLOYMENT_BLOCK');
  if (env.PRIVY_GAS_MODE && !['usdc','eth'].includes(env.PRIVY_GAS_MODE)) throw new Error('PRIVY_GAS_MODE must be usdc or eth');
  return {address: getAddress(env.SLOT_CONTRACT_ADDRESS), deploymentBlock: BigInt(env.SLOT_DEPLOYMENT_BLOCK!),
    chainId: 8453, rpcUrl: env.BASE_RPC_URL || 'https://mainnet.base.org', paymentToken: USDC,
    gasMode: env.PRIVY_GAS_MODE === 'eth' ? 'eth' : 'usdc', confirmations: 2};
}
export const GAME_STATES = ['waiting', 'revealable', 'expired', 'won', 'lost', 'invalidated'] as const;
export {PRIZE_LABELS as SYMBOLS} from '../assets';
export const PAYLINES = [[5,6,7,8,9], [0,1,7,13,14], [10,11,7,3,4]] as const;
export type Json<T> = T extends bigint ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? {[K in keyof T]: Json<T[K]>} : T;
export function serializable<T>(value: T): Json<T> {return JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));}
