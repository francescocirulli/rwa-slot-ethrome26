import {getAddress, isAddress, type Address} from 'viem';
import {USDC} from '../types';
import type {GasMode} from './gas';
import {prizeCollectionAddress} from '../prize-collection';
export type SlotConfig = {address: Address; deploymentBlock: bigint; historyFromBlock?: bigint; logPageBlocks?: bigint; chainId: number; rpcUrl: string; rpcUrls?: string[]; paymentToken: Address; gasMode: GasMode; confirmations: number; prizeCollection?:Address};
function positiveBlocks(value: string | undefined, fallback: bigint, name: string) {
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer block number`);
  return BigInt(value);
}
export function loadSlotConfig(env = process.env): SlotConfig | null {
  if (!env.SLOT_CONTRACT_ADDRESS) return null;
  if (!isAddress(env.SLOT_CONTRACT_ADDRESS) || !/^\d+$/.test(env.SLOT_DEPLOYMENT_BLOCK || '')) throw new Error('Configure SLOT_CONTRACT_ADDRESS and SLOT_DEPLOYMENT_BLOCK');
  if (env.PRIVY_GAS_MODE && !['usdc','eth'].includes(env.PRIVY_GAS_MODE)) throw new Error('PRIVY_GAS_MODE must be usdc or eth');
  const deploymentBlock = BigInt(env.SLOT_DEPLOYMENT_BLOCK!);
  // A capped RPC limits the eth_getLogs range; pages must match that limit. The history
  // floor lets a deployment ignore pre-existing rounds when full history is not required.
  const logPageBlocks = positiveBlocks(env.SLOT_LOG_PAGE_BLOCKS, 2000n, 'SLOT_LOG_PAGE_BLOCKS');
  const historyFromBlock = positiveBlocks(env.SLOT_HISTORY_FROM_BLOCK, deploymentBlock, 'SLOT_HISTORY_FROM_BLOCK');
  if (historyFromBlock < deploymentBlock) throw new Error('SLOT_HISTORY_FROM_BLOCK must not precede SLOT_DEPLOYMENT_BLOCK');
  const rpcUrl = env.BASE_RPC_URL || 'https://mainnet.base.org';
  // Reads fall back to public nodes only when the dedicated endpoint fails or rate-limits.
  const rpcUrls = [rpcUrl, ...(env.BASE_RPC_FALLBACK_URLS || '').split(',').map(value => value.trim()).filter(Boolean)]
    .filter((value, index, all) => all.indexOf(value) === index);
  return {address: getAddress(env.SLOT_CONTRACT_ADDRESS), deploymentBlock, historyFromBlock, logPageBlocks,
    chainId: 8453, rpcUrl, rpcUrls, paymentToken: USDC,
    gasMode: env.PRIVY_GAS_MODE === 'eth' ? 'eth' : 'usdc', confirmations: 2, prizeCollection:prizeCollectionAddress(env.SLOT_PRIZE1155_ADDRESS)};
}
export const GAME_STATES = ['waiting', 'revealable', 'expired', 'won', 'lost', 'invalidated'] as const;
export {PRIZE_LABELS as SYMBOLS} from '../assets';
export const PAYLINES = [[5,6,7,8,9], [0,1,7,13,14], [10,11,7,3,4]] as const;
export type Json<T> = T extends bigint ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? {[K in keyof T]: Json<T[K]>} : T;
export function serializable<T>(value: T): Json<T> {return JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));}
