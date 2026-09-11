import {ADMIN_WALLET_EXTERNAL_ID} from './model';

/** Stable wallet selection. Changing the configured owner never selects a new wallet. */
export function loadAdminWalletExternalId(value: string | undefined): string {
  if (value === undefined || value === '') return ADMIN_WALLET_EXTERNAL_ID;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error('Invalid ADMIN_WALLET_EXTERNAL_ID');
  }
  return value;
}
