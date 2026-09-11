import {privateKeyToAccount} from 'viem/accounts';
import type {Hex} from 'viem';

/** A deployment can be configured before a real keeper wallet is provisioned. */
export function loadBackendPrivateKey(value = process.env.SLOT_BACKEND_PRIVATE_KEY): Hex | undefined {
  const key = value?.trim();
  if (!key || key === 'REPLACE_ME') return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Invalid backend wallet configuration');
  try {
    privateKeyToAccount(key as Hex);
  } catch {
    // Never include the supplied key (or the library's error) in logs.
    throw new Error('Invalid backend wallet configuration');
  }
  return key as Hex;
}
