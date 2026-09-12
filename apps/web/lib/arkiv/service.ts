import {watchBlocks} from 'viem/actions';
import type {SlotReader} from '../slot/reader';
import type {ArkivConfig} from './config';
import type {ArkivStore} from './store';
import {emptyView, rank, seasonAt, type LeaderboardView, type Season} from './model';

export function createSeasonService(config:ArkivConfig, store:ArkivStore, reader:SlotReader) {
  let view = {...emptyView(),status:'connecting' as LeaderboardView['status'],message:'Connecting to the season leaderboard…'};
  const listeners = new Set<(view:LeaderboardView)=>void>();
  let stopped = false, connectedAt = 0, dirty = 1, applied = 0, refreshing = false;
  let lastBlock = -1n, currentSeason:Season|null = null, startTime = 0n, indexingError = false, catchingUp = store.canWrite;
  let cursor = config.baseFromBlock;
  let scanTimer:ReturnType<typeof setTimeout>|undefined;
  const unwatch: (()=>void)[] = [];
  function emit() {for(const listener of listeners) listener({...view});}
  function unavailable() {dirty++;view = {...view,status:'unavailable',message:'Connection interrupted. Standings may be out of date.'};emit();}
  async function refresh() {
    if(refreshing || stopped) return;
    refreshing = true;
    const version = dirty;
    try {
      const block = await store.publicClient.getBlock({blockTag:'latest'});
      const season = seasonAt(block.number,config.anchor,config.seasonBlocks);
      const changed = season?.id !== currentSeason?.id;
      if(changed || !currentSeason) {
        startTime = season ? (await store.publicClient.getBlock({blockNumber:season.startBlock})).timestamp : 0n;
      }
      let rows = view.rows, players = view.players;
      if(changed || version !== applied || !view.updatedAt) {
        const ranked = season ? rank(await store.contributions(season,block.number,startTime),block.number) : [];
        rows = ranked.slice(0,20); players = ranked.length;
      }
      currentSeason = season; lastBlock = block.number; applied = version;
      const end = season?.endBlock || config.anchor;
      view = {status:connectedAt && Date.now()-connectedAt < 15000 ? 'live' : 'connecting',season:season ? {id:season.id,startBlock:String(season.startBlock),endBlock:String(season.endBlock)} : null,
        block:String(block.number),remainingSeconds:Number(end-block.number)*2,updatedAt:Date.now(),rows,players,
        indexing:indexingError||catchingUp,message:indexingError||catchingUp?'Some confirmed spins are still syncing.':season?'':'The first season starts soon.'};
      emit();
    } catch {unavailable();}
    finally {refreshing = false;}
  }
  async function scan() {
    if(stopped || !store.canWrite) return;
    try {
      await reader.validate();
      const head = await reader.client.getBlockNumber({cacheTime:0});
      const confirmed = head - BigInt(reader.config.confirmations-1);
      if(cursor <= confirmed) {
        const size = reader.config.logPageBlocks || 2000n;
        const end = cursor+size-1n < confirmed ? cursor+size-1n : confirmed;
        const events = await reader.client.getContractEvents({...reader.contract,eventName:'RoundRevealed',fromBlock:cursor,toBlock:end,strict:true});
        for(const event of events) {
          const source = await reader.client.getBlock({blockNumber:event.blockNumber});
          if(source.hash !== event.blockHash) throw new Error('Base source block changed');
          if(source.timestamp < BigInt(Math.floor(Date.now()/1000)-config.historyDays*86400)) continue;
          const game = await reader.game(event.args.gameId,head);
          if(game.transactionHash !== event.transactionHash || !game.confirmed) throw new Error('Result is not confirmed');
          // Refresh the deadline immediately before each publication, not from a stale scan snapshot.
          const arkivBlock = await store.publicClient.getBlock({blockTag:'latest'});
          const season = seasonAt(arkivBlock.number,config.anchor,config.seasonBlocks);
          const seasonTime = season ? (currentSeason?.id === season.id ? startTime : (await store.publicClient.getBlock({blockNumber:season.startBlock})).timestamp) : 0n;
          await store.publish(game,source.timestamp,season,seasonTime);
        }
        cursor = end+1n;
      }
      catchingUp = cursor <= confirmed;
      indexingError = false;
    } catch {indexingError = true;}
    finally {
      if(!stopped) {scanTimer = setTimeout(()=>void scan(),8000);scanTimer.unref();}
    }
  }
  // Arkiv reads update only on socket events, initial load or an explicit client reconnect.
  // The Base scanner above is ingestion, not a leaderboard refresh loop.
  function start() {
    unwatch.push(watchBlocks(store.liveClient,{poll:false,onBlock(block) {
      if(!block) {unavailable();return;}
      connectedAt = Date.now();
      if(block.number !== null && (view.status !== 'live' || (lastBlock >= 0n && block.number > lastBlock+1n) || block.number <= lastBlock)) dirty++;
      void refresh();
    },onError:unavailable}));
    unwatch.push(store.liveClient.watchEntityEvents({onEntityCreated(event) {
      if(event.owner.toLowerCase() === config.writer.toLowerCase()) {dirty++;void refresh();}
    },onEntityDeleted:()=>{dirty++;void refresh();},onError:unavailable}));
    void refresh();void scan();
  }
  const watchdog = setInterval(()=>{
    if(view.status === 'live' && Date.now()-connectedAt > 15000) unavailable();
  },5000);watchdog.unref();
  start();
  return {
    snapshot:()=>({...view}),
    subscribe(listener:(view:LeaderboardView)=>void) {
      if(listeners.size >= 100) throw new Error('Stream capacity reached');
      listeners.add(listener);listener({...view});
      // Reconcile on browser reconnect, including changes missed while the socket was down.
      dirty++;void refresh();
      return ()=>{listeners.delete(listener);};
    },
    history:store.history,
    stop() {stopped=true;for(const stop of unwatch) stop();if(scanTimer) clearTimeout(scanTimer);clearInterval(watchdog);listeners.clear();},
  };
}
