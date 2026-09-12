import type {Address} from 'viem';
import type {SlotReader} from './reader';

type Prize = {kind:number;token:Address;tokenId:bigint;fiveMatchAmount:bigint;threeMatchWeight:number;fiveMatchWeight:number};
// Match _reserveAllPrizes, including multiple symbols sharing the same asset.
export function prizeRequirements(prizes: readonly Prize[]) {
  const assets = new Map<string, {kind:1|2;token:Address;tokenId:bigint;required:bigint}>();
  for (const prize of prizes) {
    if (prize.kind !== 1 && prize.kind !== 2) continue;
    const tokenId = prize.kind === 1 ? 0n : prize.tokenId;
    const key = `${prize.kind}:${prize.token.toLowerCase()}:${tokenId}`;
    const maximum = prize.fiveMatchWeight ? prize.fiveMatchAmount : prize.kind === 1 ? prize.fiveMatchAmount / 2n : prize.fiveMatchAmount;
    const previous = assets.get(key);
    assets.set(key, {kind:prize.kind,token:prize.token,tokenId,required:(previous?.required || 0n) + maximum});
  }
  return [...assets.values()];
}
export async function readFunding(reader: Pick<SlotReader,'client'|'contract'>, prizes: readonly Prize[], blockNumber:bigint) {
  const assets = await Promise.all(prizeRequirements(prizes).map(async asset => {
    const [balance,reserved,available] = asset.kind === 1
      ? await reader.client.readContract({...reader.contract,functionName:'getERC20Inventory',args:[asset.token],blockNumber})
      : await reader.client.readContract({...reader.contract,functionName:'getERC1155Inventory',args:[asset.token,asset.tokenId],blockNumber});
    return {...asset,balance,reserved,available,missing:asset.required > available ? asset.required - available : 0n};
  }));
  return {ready:assets.every(asset=>asset.missing===0n),assets};
}
