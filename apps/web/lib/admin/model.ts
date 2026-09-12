import type {AccountView} from '../account';
export const ADMIN_WALLET_EXTERNAL_ID = 'lucky_signal_shared_admin_v1';
export type AdminRole = 'owner' | 'operator';
export type AdminMember = {userId:string; enabled:boolean};
export type AdminAccountView = AccountView & {
  state:'unconfigured'|'create'|'waiting'|'ready'; role:AdminRole|null;
  members:AdminMember[]; operationsEnabled:boolean; swapEnabled?:boolean; mintEnabled?:boolean;
};
export function adminProofMessage(address:string) {
  return `Lucky Signal — verifica accesso al wallet admin condiviso.\nWallet: ${address}\nQuesta firma dimostra soltanto l’accesso. Non autorizza acquisti, trasferimenti, login su altri servizi o modifiche ai permessi.`;
}
