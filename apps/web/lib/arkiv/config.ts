import {getAddress, isAddress, type Address, type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {loadBackendPrivateKey} from '../slot/backend-key';
export type ArkivConfig = {project:string; httpUrl:string; wsUrl:string; writer:Address; privateKey?:Hex; anchor:bigint; seasonBlocks:bigint; baseFromBlock:bigint; historyDays:number};
export function arkivEndpoints(env:Readonly<Record<string,string|undefined>> = process.env) {
  function endpoint(value:string, protocols:string[]) {
    try {
      const url = new URL(value);
      if (!protocols.includes(url.protocol)) throw new Error();
      const apiKey = env.ARKIV_API_KEY?.trim();
      if (apiKey) url.pathname = url.pathname.replace(/\/$/,'') + '/' + encodeURIComponent(apiKey);
      return url.toString();
    } catch {throw new Error('Invalid Arkiv transport configuration');}
  }
  const httpUrl = endpoint(env.ARKIV_RPC_URL || 'https://rpc.tiramisu.db-chain.testnet.arkiv.network',['http:','https:']);
  const wsUrl = endpoint(env.ARKIV_WS_URL || 'wss://rpc.tiramisu.db-chain.testnet.arkiv.network',['ws:','wss:']);
  return {httpUrl,wsUrl};
}
export function loadArkivConfig(env:Readonly<Record<string,string|undefined>> = process.env): ArkivConfig | null {
  if (env.ARKIV_ENABLED !== 'true') return null;
  function integer(name:string, fallback?:string) {
    const value = env[name] || fallback;
    if (!value || !/^\d+$/.test(value)) throw new Error(`Invalid ${name}`);
    return BigInt(value);
  }
  const reuse = env.ARKIV_USE_SLOT_BACKEND_KEY === 'true';
  if (reuse && env.ARKIV_PRIVATE_KEY?.trim()) throw new Error('Choose one Arkiv signing key source');
  let privateKey:Hex|undefined;
  try {privateKey = loadBackendPrivateKey((reuse ? env.SLOT_BACKEND_PRIVATE_KEY : env.ARKIV_PRIVATE_KEY) || '');}
  catch {throw new Error('Invalid Arkiv signing key');}
  if (reuse && !privateKey) throw new Error('Configure the backend key before enabling Arkiv key reuse');
  if (!reuse && privateKey && privateKey.toLowerCase() === env.SLOT_BACKEND_PRIVATE_KEY?.trim().toLowerCase()) throw new Error('Enable ARKIV_USE_SLOT_BACKEND_KEY to reuse the backend key');
  const derived = privateKey ? privateKeyToAccount(privateKey).address : undefined;
  const writer = env.ARKIV_WRITER_ADDRESS?.trim() || derived || '';
  if (!isAddress(writer)) throw new Error('Invalid ARKIV_WRITER_ADDRESS');
  if (derived && derived.toLowerCase() !== writer.toLowerCase()) throw new Error('Arkiv writer address mismatch');
  const project = env.ARKIV_PROJECT || 'wall-street-slot-ethrome26';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(project)) throw new Error('Invalid ARKIV_PROJECT');
  const {httpUrl,wsUrl} = arkivEndpoints(env);
  const seasonBlocks = integer('ARKIV_SEASON_BLOCKS','1296000'), historyDays = Number(integer('ARKIV_HISTORY_DAYS','30'));
  if (seasonBlocks < 10n || seasonBlocks > 15768000n || historyDays < 1 || historyDays > 365) throw new Error('Invalid Arkiv retention');
  return {project,httpUrl,wsUrl,writer:getAddress(writer),privateKey:privateKey as Hex|undefined,anchor:integer('ARKIV_SEASON_ANCHOR_BLOCK'),seasonBlocks,baseFromBlock:integer('ARKIV_BASE_FROM_BLOCK'),historyDays};
}
