import {addr, bool, i32, str, u64, u256} from '@arkiv-network/sdk/attr';
import {eq, gte, lte, type Expression} from '@arkiv-network/sdk/query';
import type {Entity} from '@arkiv-network/sdk';
import {pointsFor, seasonAt} from './model';
import type {ArkivConfig} from './config';

export class ExplorerError extends Error {constructor(message:string,public status=400){super(message);}}
export type ExplorerFilters={mode:'explore'|'summary';period:'season'|'day'|'week'|'month';player?:`0x${string}`;won?:boolean;matches?:number;symbol?:number;prize?:number;game?:string;page:number;snapshot?:bigint};
export function parseExplorer(params:URLSearchParams):ExplorerFilters {
  const allowed=['mode','period','player','won','matches','symbol','prize','game','page','snapshot'];
  for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)throw new ExplorerError('Invalid filter.');
  const mode=params.get('mode')||'explore',period=params.get('period')||'season';
  if(!['explore','summary'].includes(mode)||!['season','day','week','month'].includes(period))throw new ExplorerError('Invalid view or time window.');
  const f:ExplorerFilters={mode:mode as ExplorerFilters['mode'],period:period as ExplorerFilters['period'],page:0};
  const player=params.get('player');if(player){if(!/^0x[0-9a-fA-F]{40}$/.test(player))throw new ExplorerError('Enter a complete wallet address.');f.player=player.toLowerCase() as `0x${string}`;}
  if(mode==='summary'&&!f.player)throw new ExplorerError('Connect a wallet to see your summary.');
  for(const [key,max] of [['matches',5],['symbol',15],['prize',3],['page',199]] as const){const value=params.get(key);if(value!==null){if(!/^\d{1,3}$/.test(value)||Number(value)>max||(key==='matches'&&![3,5].includes(Number(value))))throw new ExplorerError('Invalid numeric filter.');f[key]=Number(value);}}
  const won=params.get('won');if(won!==null){if(!['true','false'].includes(won))throw new ExplorerError('Invalid result filter.');f.won=won==='true';}
  for(const key of ['game','snapshot'] as const){const value=params.get(key);if(value!==null){if(!/^(0|[1-9]\d{0,77})$/.test(value)||BigInt(value)>=2n**256n)throw new ExplorerError('Invalid record or snapshot.');if(key==='game')f.game=value;else f.snapshot=BigInt(value);}}
  if(mode==='summary'&&(f.won!==undefined||f.matches!==undefined||f.symbol!==undefined||f.prize!==undefined||f.game))throw new ExplorerError('Summary includes every result in the selected window.');
  return f;
}
export function explorerPlan(config:ArkivConfig,f:ExplorerFilters,block:{number:bigint;timestamp:bigint},seasonStart:bigint) {
  const season=seasonAt(block.number,config.anchor,config.seasonBlocks);
  const seasonal=f.period==='season'&&!f.game;
  const from=seasonal?seasonStart:block.timestamp-BigInt(({day:1,week:7,month:30,season:30}[f.period])*86400);
  const filters:Expression[]=f.game?[]:[gte('played_at',u64(from<0n?0n:from)),lte('played_at',u64(block.timestamp))];
  if(seasonal&&season)filters.push(eq('schedule',str(`${config.anchor}:${config.seasonBlocks}`)),eq('season',u64(BigInt(season.id))),eq('season_end',u64(season.endBlock)));
  if(f.player)filters.push(eq('player',addr(f.player)));
  if(f.won!==undefined)filters.push(eq('won',bool(f.won)));
  if(f.matches!==undefined)filters.push(eq('matches',i32(f.matches)));
  if(f.symbol!==undefined)filters.push(eq('symbol',i32(f.symbol)),eq('won',bool(true)));
  if(f.prize!==undefined)filters.push(eq('prize_kind',i32(f.prize)));
  if(f.game)filters.push(eq('game_id',u256(BigInt(f.game))));
  return {kind:seasonal?'season-spin':'spin',filters,from,season,empty:seasonal&&!season};
}
export type ExplorerRow={gameId:string;player:string;playedAt:number;won:boolean;points:number;matches:number;symbol:number;prize:number;transactionHash:string;symbols:number[]|null};
type IndexedEntity=Pick<Entity,'attributes'|'expiresAt'|'toJson'>;
export function explorerRow(entity:IndexedEntity):ExplorerRow {
  const a=entity.attributes||{};
  function value(name:string,type:string){const item=a[name];if(!item||item.type!==type)throw new Error('Invalid indexed result');return item.value;}
  const gameId=String(value('game_id','u256')),player=String(value('player','addr')),playedAt=Number(value('played_at','u64'));
  const won=value('won','bool') as boolean,points=value('points','i32') as number,matches=value('matches','i32') as number,symbol=value('symbol','i32') as number,prize=value('prize_kind','i32') as number;
  if(!/^0x[\da-f]{40}$/i.test(player)||!Number.isSafeInteger(playedAt)||playedAt<0||points!==pointsFor(won,matches)||!Number.isInteger(symbol)||!Number.isInteger(prize)||prize<0||prize>3||(won?(![3,5].includes(matches)||symbol<0||symbol>15):(matches!==0||symbol!==255||prize!==0)))throw new Error('Invalid indexed result');
  const payload=entity.toJson();
  if(!payload||!/^0x[\da-f]{64}$/i.test(payload.transactionHash))throw new Error('Invalid result receipt');
  const symbols=Array.isArray(payload.symbols)&&payload.symbols.length===15&&payload.symbols.every((v:unknown)=>Number.isInteger(v)&&Number(v)>=0&&Number(v)<16)?payload.symbols as number[]:null;
  return {gameId,player:player.toLowerCase(),playedAt,won,points,matches,symbol,prize,transactionHash:payload.transactionHash,symbols};
}
export function summarize(rows:ExplorerRow[]) {
  const wins=rows.filter(r=>r.won),symbols=Array.from({length:16},(_,symbol)=>({symbol,wins:wins.filter(r=>r.symbol===symbol).length})).filter(r=>r.wins>0).sort((a,b)=>b.wins-a.wins||a.symbol-b.symbol);
  return {spins:rows.length,wins:wins.length,points:rows.reduce((n,r)=>n+r.points,0),winRate:rows.length?Math.round(wins.length/rows.length*1000)/10:0,three:wins.filter(r=>r.matches===3).length,five:wins.filter(r=>r.matches===5).length,losses:rows.length-wins.length,symbols};
}
export async function collectResults(entities:AsyncIterable<IndexedEntity>,block:bigint,expectedExpiry?:bigint) {
  const byGame=new Map<string,ExplorerRow>();let count=0;
  for await(const entity of entities){
    if(++count>5000)throw new ExplorerError('Too many results. Choose a shorter window or a wallet.',422);
    if(entity.expiresAt===undefined||entity.expiresAt<=block||(expectedExpiry!==undefined&&entity.expiresAt!==expectedExpiry))throw new Error('Invalid result expiry');
    const row=explorerRow(entity),previous=byGame.get(row.gameId);
    if(previous&&JSON.stringify(previous)!==JSON.stringify(row))throw new Error('Conflicting indexed results');
    byGame.set(row.gameId,row);
  }
  return [...byGame.values()].sort((a,b)=>b.playedAt-a.playedAt||(BigInt(a.gameId)>BigInt(b.gameId)?-1:1));
}
