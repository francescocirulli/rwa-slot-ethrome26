import {getAddress, isAddress, type Address, type Hex} from 'viem';
export type ArkivConfig = {project:string; httpUrl:string; wsUrl:string; writer:Address; privateKey?:Hex; anchor:bigint; seasonBlocks:bigint; baseFromBlock:bigint; historyDays:number};
export function loadArkivConfig(env:Readonly<Record<string,string|undefined>> = process.env): ArkivConfig | null {
  if (env.ARKIV_ENABLED !== 'true') return null;
  function integer(name:string, fallback?:string) {
    const value = env[name] || fallback;
    if (!value || !/^\d+$/.test(value)) throw new Error(`Invalid ${name}`);
    return BigInt(value);
  }
  const writer = env.ARKIV_WRITER_ADDRESS || '';
  if (!isAddress(writer)) throw new Error('Invalid ARKIV_WRITER_ADDRESS');
  const privateKey = env.ARKIV_PRIVATE_KEY || undefined;
  if (privateKey && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('Invalid ARKIV_PRIVATE_KEY');
  if (privateKey && privateKey === env.SLOT_BACKEND_PRIVATE_KEY) throw new Error('Arkiv requires a separate writer wallet');
  const project = env.ARKIV_PROJECT || 'wall-street-slot-ethrome26';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(project)) throw new Error('Invalid ARKIV_PROJECT');
  const httpUrl = env.ARKIV_RPC_URL || 'https://rpc.tiramisu.db-chain.testnet.arkiv.network';
  const wsUrl = env.ARKIV_WS_URL || 'wss://rpc.tiramisu.db-chain.testnet.arkiv.network';
  if (!['http:','https:'].includes(new URL(httpUrl).protocol) || !['ws:','wss:'].includes(new URL(wsUrl).protocol)) throw new Error('Invalid Arkiv transports');
  const seasonBlocks = integer('ARKIV_SEASON_BLOCKS','60'), historyDays = Number(integer('ARKIV_HISTORY_DAYS','30'));
  if (seasonBlocks < 10n || seasonBlocks > 15768000n || historyDays < 1 || historyDays > 365) throw new Error('Invalid Arkiv retention');
  return {project,httpUrl,wsUrl,writer:getAddress(writer),privateKey:privateKey as Hex|undefined,anchor:integer('ARKIV_SEASON_ANCHOR_BLOCK'),seasonBlocks,baseFromBlock:integer('ARKIV_BASE_FROM_BLOCK'),historyDays};
}
