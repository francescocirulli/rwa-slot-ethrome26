import type {Address} from 'viem';
import {createInventoryReader} from './admin/inventory';
import type {SlotEngine} from './slot/engine';

export function createPortfolioReader(readInventory:ReturnType<typeof createInventoryReader>,getSlot:()=>SlotEngine|null) {
  const cache=new Map<string,{until:number;value:Promise<Portfolio>}>();
  async function fresh(address:Address) {
    const slot=getSlot();
    const [inventory,player,settings]=await Promise.all([
      readInventory(address,slot?.reader.config.address||null),
      slot?slot.playerView(address).catch(()=>null):null,
      slot?slot.reader.settings().catch(()=>null):null,
    ]);
    const busy=!!player?.game?.pending||!!player?.game?.hasResult&&!player.game.confirmed||!!player?.operation&&['submitting','confirming','uncertain'].includes(player.operation.stage);
    return {address,chainId:8453,contract:inventory.contract,updatedAt:inventory.updatedAt,eth:inventory.eth,
      assets:inventory.assets.map(({reserve,canDeposit,...asset})=>asset),
      nfts:inventory.nfts.map(({reserve,canMint,canDeposit,...nft})=>nft),
      allowance:player?.allowance??null,freeSpins:inventory.freeSpins,ticketPrice:settings?.ticketPrice.toString()??null,
      busy,canTransact:!!slot&&!!player?.historyReady&&!busy,gameId:player?.game?.id??null,
      gasMode:slot?.reader.config.gasMode||'usdc'};
  }
  type Portfolio=Awaited<ReturnType<typeof fresh>>;
  return function read(address:Address):Promise<Portfolio> {
    const key=address.toLowerCase(),saved=cache.get(key);
    if(saved&&saved.until>Date.now())return saved.value;
    if(cache.size>=256)cache.delete(cache.keys().next().value!);
    const value=fresh(address);cache.set(key,{until:Date.now()+5000,value});
    void value.catch(()=>{if(cache.get(key)?.value===value)cache.delete(key);});
    return value;
  };
}
export type Portfolio=Awaited<ReturnType<ReturnType<typeof createPortfolioReader>>>;
