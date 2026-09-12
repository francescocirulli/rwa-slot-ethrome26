import {createPublicClient, createWalletClient, ExpirationTime, jsonToPayload, type CreateEntityParameters} from '@arkiv-network/sdk';
import {tiramisu} from '@arkiv-network/sdk/chains';
import {addr, bool, i32, str, u64, u256} from '@arkiv-network/sdk/attr';
import {eq, gte, type Expression} from '@arkiv-network/sdk/query';
import {http, webSocket, keccak256, type Hash} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import type {ArkivConfig} from './config';
import {pointsFor, seasonAt, type Contribution, type Season} from './model';
import {collectResults, explorerPlan, summarize, ExplorerError, type ExplorerFilters} from './explorer';
import type {SlotReader} from '../slot/reader';
import {serializable} from '../slot/config';

export type ConfirmedGame = Awaited<ReturnType<SlotReader['game']>>;
export function entitiesFor(config:ArkivConfig, source:{chainId:number;address:`0x${string}`}, game:ConfirmedGame, timestamp:bigint, season:Season|null, seasonStartTime:bigint):CreateEntityParameters[] {
  const schedule = `${config.anchor}:${config.seasonBlocks}`;
  const baseAttributes = {project:str(config.project),schema:i32(1),source_chain:u64(source.chainId),slot:addr(source.address),game_id:u256(game.id),player:addr(game.player),played_at:u64(timestamp),won:bool(game.won),points:i32(pointsFor(game.won,game.matchCount)),matches:i32(game.matchCount),symbol:i32(game.winningSymbol),prize_kind:i32(game.payout?.kind || 0)};
  const history:CreateEntityParameters = {attributes:{...baseAttributes,kind:str('spin')},payload:jsonToPayload(serializable({gameId:game.id,player:game.player,won:game.won,matchCount:game.matchCount,symbols:game.symbols,transactionHash:game.transactionHash,resultBlock:game.resultBlock,payout:game.payout})),contentType:'application/json',expires:ExpirationTime.fromDays(config.historyDays),flags:{readonly:true}};
  const creates = [history];
  // Recovery never places results from an older season into the current competition.
  // Exact expiry has no minimum lifetime: a batch mined too late must revert.
  if (season && timestamp >= seasonStartTime) creates.push({...history,attributes:{...baseAttributes,kind:str('season-spin'),schedule:str(schedule),season:u64(BigInt(season.id)),season_end:u64(season.endBlock)},payload:jsonToPayload({transactionHash:game.transactionHash}),expires:ExpirationTime.atBlock(season.endBlock)});
  return creates;
}
export function createArkivStore(config: ArkivConfig, reader: SlotReader) {
  const publicClient = createPublicClient({chain:tiramisu,transport:http(config.httpUrl,{retryCount:0,timeout:12000})});
  // A real socket and no fromBlock on either live subscription. Backfill is a separate query.
  const liveClient = createPublicClient({chain:tiramisu,transport:webSocket(config.wsUrl,{retryCount:0,keepAlive:true,reconnect:true})});
  const schedule = `${config.anchor}:${config.seasonBlocks}`;
  const scope = [eq('project',str(config.project)),eq('schema',i32(1)),eq('source_chain',u64(reader.config.chainId)),eq('slot',addr(reader.config.address))];
  let pendingHash: Hash | undefined;
  const originalAccount = config.privateKey ? privateKeyToAccount(config.privateKey) : undefined;
  if (originalAccount && originalAccount.address.toLowerCase() !== config.writer.toLowerCase()) throw new Error('Arkiv writer address mismatch');
  // Capture the hash before broadcast; after an ambiguous send we only check this receipt.
  const account = originalAccount ? {...originalAccount, signTransaction: (async (...args: Parameters<typeof originalAccount.signTransaction>) => {
    const raw = await originalAccount.signTransaction(...args);
    pendingHash = keccak256(raw); return raw;
  }) as typeof originalAccount.signTransaction} : undefined;
  const wallet = account ? createWalletClient({account,chain:tiramisu,transport:http(config.httpUrl,{retryCount:0,timeout:12000})}) : undefined;
  function query(kind:string, filters:Expression[] = [], block?:bigint) {
    const q = publicClient.select({key:true,attributes:true,payload:true,expiresAt:true}).where(...scope,eq('kind',str(kind)),...filters).createdBy(config.writer).limit(200);
    return block === undefined ? q : q.atBlock(block);
  }
  async function contributions(season:Season, block:bigint, startTime:bigint) {
    const entries:Contribution[] = [];
    // Both numeric range and season are meaningful: reject contributions from a different schedule.
    const q = query('season-spin',[eq('schedule',str(schedule)),eq('season',u64(BigInt(season.id))),gte('played_at',u64(startTime)),eq('season_end',u64(season.endBlock))],block);
    for await (const entity of q) {
      const a = entity.attributes;
      if(a.player?.type !== 'addr' || a.game_id?.type !== 'u256' || a.points?.type !== 'i32' || a.won?.type !== 'bool' || entity.expiresAt !== season.endBlock) throw new Error('Invalid season entity');
      entries.push({gameId:String(a.game_id.value),player:a.player.value,points:a.points.value,won:a.won.value,expiresAt:entity.expiresAt});
    }
    return entries;
  }
  async function hasGame(id:bigint) {return (await query('spin',[eq('game_id',u256(id))]).fetch()).entities.length > 0;}
  async function publish(game:ConfirmedGame, timestamp:bigint, season:Season|null, seasonStartTime:bigint) {
    if (!wallet || !game.confirmed || !game.hasResult || !game.transactionHash || game.resultBlock === null || (game.won && !game.payout)) throw new Error('Only complete confirmed results may be published');
    if (pendingHash) {
      // A missing receipt remains uncertain, including after a dropped RPC response.
      await publicClient.getTransactionReceipt({hash:pendingHash});
      pendingHash = undefined;
    }
    if (await hasGame(game.id)) return;
    const [latest,pending] = await Promise.all([publicClient.getTransactionCount({address:config.writer,blockTag:'latest'}),publicClient.getTransactionCount({address:config.writer,blockTag:'pending'})]);
    if(latest !== pending) throw new Error('Arkiv writer has an outstanding transaction');
    const creates = entitiesFor(config,reader.config,game,timestamp,season,seasonStartTime);
    await wallet.executeBatch({creates},{nonce:latest});
    pendingHash = undefined;
  }
  async function history(player:`0x${string}`) {
    // This endpoint is deliberately a recent-history page, not a top-N ranking.
    const page = await query('spin',[eq('player',addr(player))]).limit(50).fetch();
    return page.entities.map(entity=>({key:entity.key,...entity.toJson() as Record<string,unknown>}));
  }
  // Bound concurrent scans and cache snapshots, never partial totals. No additional signer.
  const cache=new Map<string,{until:number;promise:Promise<{rows:Awaited<ReturnType<typeof collectResults>>;season:string|null;from:number;timestamp:number}>}>();
  let scans=0;
  async function explore(f:ExplorerFilters) {
    const latest=await publicClient.getBlock({blockTag:'latest'});
    const block=f.snapshot===undefined?latest:await publicClient.getBlock({blockNumber:f.snapshot});
    if(block.number>latest.number||latest.timestamp-block.timestamp>900n)throw new ExplorerError('This snapshot expired. Refresh the results.',409);
    const key=JSON.stringify({...f,page:0,snapshot:String(block.number)});
    for(const [k,v] of cache)if(v.until<Date.now())cache.delete(k);
    let entry=cache.get(key);
    if(!entry){
      if(scans>=4)throw new ExplorerError('Explorer is busy. Please retry shortly.',429);
      scans++;
      const promise=(async()=>{
        const season=seasonAt(block.number,config.anchor,config.seasonBlocks);
        const start=season?(await publicClient.getBlock({blockNumber:season.startBlock})).timestamp:0n;
        const plan=explorerPlan(config,f,block,start);
        const rows=plan.empty?[]:await collectResults(query(plan.kind,plan.filters,block.number),block.number,plan.kind==='season-spin'?season?.endBlock:undefined);
        return {rows,season:season?.id||null,from:Number(plan.from),timestamp:Number(block.timestamp)};
      })().finally(()=>{scans--;});
      entry={until:Date.now()+60000,promise};cache.set(key,entry);
      if(cache.size>24)cache.delete(cache.keys().next().value!);
      promise.catch(()=>{cache.delete(key);});
    }
    const result=await entry.promise;
    return {snapshot:String(block.number),season:result.season,from:result.from,timestamp:result.timestamp,historyDays:config.historyDays,
      summary:summarize(result.rows),total:result.rows.length,page:f.page,pageSize:25,rows:result.rows.slice(f.page*25,(f.page+1)*25)};
  }
  return {publicClient,liveClient,contributions,publish,history,explore,canWrite:!!wallet};
}
export type ArkivStore = ReturnType<typeof createArkivStore>;
