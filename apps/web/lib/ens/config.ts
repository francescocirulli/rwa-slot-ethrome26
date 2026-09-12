import {getAddress, isAddress, type Address} from 'viem';
import upstream from './upstream.json';
import {SlotError} from '../slot/errors';
export const ENS_PARENT = 'wallstreetslot.eth';
export const ENS_CHAIN_ID = 11155111;
export const ENS_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
export const ENS_BACKEND = getAddress('0x8e251547f0fD650e0573711EF733F13eBA1505aD');
export type EnsConfig = {rpcUrl:string; registrar:Address; registry:Address; deploymentBlock:bigint; sourceBlock:bigint};
export function ensConfig(env:Record<string,string|undefined>=process.env):EnsConfig|null {
  if (!env.ENS_REGISTRAR_ADDRESS) return null;
  for(const key of ['ENS_REGISTRAR_ADDRESS','ENS_SUBREGISTRY_ADDRESS']) {
    if(!isAddress(env[key]||'') || /^0x0{40}$/i.test(env[key]!))throw new Error('Invalid ENS configuration: '+key);
  }
  for(const key of ['ENS_DEPLOYMENT_BLOCK','ENS_BASE_FROM_BLOCK'])if(!/^\d+$/.test(env[key]||''))throw new Error('Invalid ENS configuration: '+key);
  return {rpcUrl:env.SEPOLIA_RPC_URL||ENS_RPC,registrar:getAddress(env.ENS_REGISTRAR_ADDRESS!),registry:getAddress(env.ENS_SUBREGISTRY_ADDRESS!),
    deploymentBlock:BigInt(env.ENS_DEPLOYMENT_BLOCK!),sourceBlock:BigInt(env.ENS_BASE_FROM_BLOCK!)};
}
export const ensContracts=Object.fromEntries(Object.entries(upstream.contracts).map(([key,value])=>[key,{...value,address:getAddress(value.address)}])) as {
  [K in keyof typeof upstream.contracts]:{address:Address;abi:typeof upstream.contracts[K]['abi']}
};
export function normalizeLabel(input:unknown):string {
  if(typeof input!=='string')throw new SlotError('EnsLabel','Enter a name.',400);
  const label=input.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(label))throw new SlotError('EnsLabel','Use 3–32 letters, numbers or hyphens, with a letter or number at each end.',400);
  return label;
}
