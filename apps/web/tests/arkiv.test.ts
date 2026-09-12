import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {privateKeyToAccount} from 'viem/accounts';
import {parse} from 'acorn';
import {resolveExpiry} from '@arkiv-network/sdk';
import {seasonAt,rank,pointsFor,seasonCountdown} from '../lib/arkiv/model';
import {loadArkivConfig,type ArkivConfig} from '../lib/arkiv/config';
import {createArkivStore,entitiesFor,type ConfirmedGame,type ArkivStore} from '../lib/arkiv/store';
import {createSeasonService} from '../lib/arkiv/service';
import type {SlotReader} from '../lib/slot/reader';
const player='0x0000000000000000000000000000000000000011';
const config:ArkivConfig={project:'test',httpUrl:'http://localhost',wsUrl:'ws://localhost',writer:player,anchor:100n,seasonBlocks:60n,baseFromBlock:1n,historyDays:30};
const game={id:1n,player,won:true,matchCount:5,winningSymbol:2,hasResult:true,confirmed:true,resultBlock:20n,transactionHash:'0x'+'1'.repeat(64),symbols:[2,2,2,2,2],payout:{kind:1,amount:100n}} as unknown as ConfirmedGame;

test('five-block Base pages catch up before the next normal ingestion interval',async()=>{
  const pages:bigint[][]=[];
  let complete!:()=>void;
  const caughtUp=new Promise<void>(resolve=>{complete=resolve;});
  const getBlock=async()=>({number:159n,timestamp:1000n});
  const store={canWrite:true,history:async()=>[],publicClient:{getBlock},liveClient:{getBlock,
    transport:{type:'webSocket',subscribe:async()=>({unsubscribe(){}})},watchEntityEvents:()=>()=>{}},
    contributions:async()=>[]} as unknown as ArkivStore;
  const reader={config:{confirmations:2,logPageBlocks:5n},contract:{},validate:async()=>{},
    client:{getBlockNumber:async()=>101n,getContractEvents:async(options:{fromBlock:bigint;toBlock:bigint})=>{
      pages.push([options.fromBlock,options.toBlock]);
      if(options.toBlock===100n)complete();
      return [];
    }}} as unknown as SlotReader;
  const service=createSeasonService({...config,baseFromBlock:90n},store,reader);
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try {
    await Promise.race([caughtUp,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Capped ingestion did not catch up')),3000);})]);
    assert.deepEqual(pages,[[90n,94n],[95n,99n],[100n,100n]]);
  } finally {clearTimeout(timeout);service.stop();}
});

test('all season contributions share an absolute expiry, including late arrivals',()=>{
  const season=seasonAt(100n,100n,60n)!;
  assert.equal(seasonAt(99n,100n,60n),null);
  assert.equal(seasonAt(159n,100n,60n)!.id,'1');
  assert.equal(seasonAt(160n,100n,60n)!.id,'2');
  const first=entitiesFor(config,{chainId:8453,address:player},game,1000n,season,1000n);
  const last=entitiesFor(config,{chainId:8453,address:player},game,1118n,season,1000n);
  for(const entity of first) {
    assert.ok(Object.keys(entity.attributes!).every(name=>/^[a-z][a-z0-9_.-]*$/.test(name)),'Tiramisu rejects uppercase attribute names at gas estimation');
    assert.deepEqual(entity.attributes!.game_id,{type:'u256',value:1n});
  }
  assert.equal(first.length,2);assert.equal(last.length,2);
  assert.equal(resolveExpiry(first[1].expires,{currentBlock:101n}).target,160n);
  assert.equal(resolveExpiry(last[1].expires,{currentBlock:159n}).target,160n);
  assert.throws(()=>resolveExpiry(last[1].expires,{currentBlock:160n}));
  assert.ok(resolveExpiry(first[0].expires,{currentBlock:101n}).target>160n);
  assert.equal(entitiesFor(config,{chainId:8453,address:player},game,999n,season,1000n).length,1,'replayed old spins remain history only');
});
test('ranking deduplicates replay, aggregates all players and expires at the boundary',()=>{
  const entries=Array.from({length:205},(_,i)=>({gameId:String(i+1),player,points:30,won:true,expiresAt:160n}));
  const other='0x0000000000000000000000000000000000000022';
  entries.push({...entries[0]},{gameId:'206',player:other,points:100,won:true,expiresAt:160n});
  const rows=rank(entries,159n);
  assert.equal(rows[0].spins,205);assert.equal(rows[0].points,6150);assert.equal(rows.length,2);
  assert.deepEqual(rank(entries,160n),[]);
  assert.equal(pointsFor(false,5),0);assert.equal(pointsFor(true,3),30);assert.equal(pointsFor(true,5),100);
  assert.equal(seasonCountdown(2591990),'29d 23h 59m');
  assert.equal(seasonCountdown(3661),'1h 1m 1s');
  assert.equal(seasonCountdown(61),'1:01');
});
test('configuration requires a stable anchor and a separate signer',()=>{
  assert.equal(loadArkivConfig({}),null);
  const env={ARKIV_ENABLED:'true',ARKIV_WRITER_ADDRESS:player,ARKIV_SEASON_ANCHOR_BLOCK:'100',ARKIV_BASE_FROM_BLOCK:'1'};
  assert.equal(loadArkivConfig(env)!.seasonBlocks,1296000n);
  assert.throws(()=>loadArkivConfig({...env,ARKIV_SEASON_ANCHOR_BLOCK:''}));
  assert.throws(()=>loadArkivConfig({...env,ARKIV_WS_URL:'https://example.com'}));
  assert.throws(()=>loadArkivConfig({...env,ARKIV_PRIVATE_KEY:'0x'+'1'.repeat(64),SLOT_BACKEND_PRIVATE_KEY:'0x'+'1'.repeat(64)}));
});
test('terminal leaderboard parses as ES5',()=>{parse(readFileSync('public/terminal/leaderboard.js','utf8'),{ecmaVersion:5});});
test('socket-driven season rollover waits for query success and reconnect reconciles missed data',async()=>{
  let block=159n,fail=false,queries=0;
  let head:((data:{result:{number:string}})=>Promise<void>)|undefined;
  let socketError:((error:Error)=>void)|undefined;
  let entityEvents:Parameters<ArkivStore['liveClient']['watchEntityEvents']>[0]|undefined;
  const getBlock=async()=>({number:block,timestamp:1000n});
  const store={canWrite:false,history:async()=>[],publicClient:{getBlock},liveClient:{
    getBlock,transport:{type:'webSocket',subscribe:async(options:{params:string[];onData:typeof head;onError:typeof socketError})=>{
      assert.deepEqual(options.params,['newHeads']);head=options.onData;socketError=options.onError;return {unsubscribe(){}};
    }},watchEntityEvents(options:typeof entityEvents){assert.equal(options?.fromBlock,undefined);entityEvents=options;return ()=>{};}
  },contributions:async()=>{queries++;if(fail) throw new Error('RPC down');return block<160n?[{gameId:'1',player,points:100,won:true,expiresAt:160n}]:[];}} as unknown as ArkivStore;
  const service=createSeasonService(config,store,{} as SlotReader);
  async function settle(){await new Promise(resolve=>setTimeout(resolve,10));}
  try {
    await settle();await head!({result:{number:'0x9f'}});await settle();
    assert.equal(service.snapshot().season?.id,'1');assert.equal(service.snapshot().rows[0].points,100);
    const before=queries;
    block=159n;await head!({result:{number:'0x9f'}});await settle();
    socketError!(new Error('drop'));assert.equal(service.snapshot().status,'unavailable');
    block=160n;fail=true;await head!({result:{number:'0xa0'}});await settle();
    assert.equal(service.snapshot().status,'unavailable');assert.equal(service.snapshot().season?.id,'1','failed query must not present a fabricated reset');
    fail=false;block=161n;await head!({result:{number:'0xa1'}});await settle();
    assert.equal(service.snapshot().season?.id,'2');assert.deepEqual(service.snapshot().rows,[]);assert.ok(queries>before);
  } finally {service.stop();}
});

test('real SDK query follows every page, keeps the block snapshot and ranks the last-page winner',async()=>{
  let calls=0;
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString());calls++;
    const [query,options]=body.params;
    if(body.method!=='arkiv_query'||!query.includes('$creator')||!query.includes('played_at >= u64(1000)')||options.atBlock!=='0x9f') {
      res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:-32000,message:'Unexpected query'}}));return;
    }
    const ids=options.cursor?[201]:Array.from({length:200},(_,i)=>i+1);
    const data=ids.map(id=>({key:'0x'+String(id).padStart(64,'0'),expiresAt:'0xa0',attributes:[
      {name:'game_id',type:'u256',value:String(id)},
      {name:'player',type:'addr',value:'0x'+String(id).padStart(40,'0')},
      {name:'points',type:'i32',value:id===201?100:30},
      {name:'won',type:'bool',value:true}
    ]}));
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{data,blockNumber:'0x9f',...(!options.cursor?{cursor:'second-page'}:{})}}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const address=server.address() as {port:number};
    const store=createArkivStore({...config,httpUrl:`http://127.0.0.1:${address.port}`},{config:{chainId:8453,address:player}} as unknown as SlotReader);
    const entries=await store.contributions(seasonAt(159n,100n,60n)!,159n,1000n);
    assert.equal(calls,2);assert.equal(entries.length,201);
    assert.equal(rank(entries,159n)[0].player,'0x'+String(201).padStart(40,'0'));
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('Base ingestion uses bounded confirmed logs and refuses an unconfirmed result',async()=>{
  for(const confirmed of [false,true]) {
    let published=0;
    const now=BigInt(Math.floor(Date.now()/1000));
    const sourceHash='0x'+'a'.repeat(64);
    const getBlock=async()=>({number:159n,timestamp:now-30n});
    const store={canWrite:true,history:async()=>[],publicClient:{getBlock},liveClient:{getBlock,transport:{type:'webSocket',subscribe:async()=>({unsubscribe(){}})},watchEntityEvents:()=>()=>{}},
      contributions:async()=>[],publish:async(result:ConfirmedGame,time:bigint,season:{endBlock:bigint})=>{
        assert.equal(result.id,1n);assert.equal(time,now);assert.equal(season.endBlock,160n);published++;
      }} as unknown as ArkivStore;
    const reader={config:{confirmations:2,logPageBlocks:20n},contract:{},validate:async()=>{},
      client:{getBlockNumber:async()=>101n,getBlock:async()=>({hash:sourceHash,timestamp:now}),getContractEvents:async(options:{fromBlock:bigint;toBlock:bigint})=>{
        assert.equal(options.fromBlock,90n);assert.equal(options.toBlock,100n);
        return [{args:{gameId:1n},blockNumber:100n,blockHash:sourceHash,transactionHash:game.transactionHash}];
      }},game:async()=>({...game,confirmed})} as unknown as SlotReader;
    const service=createSeasonService({...config,baseFromBlock:90n},store,reader);
    try {await new Promise(resolve=>setTimeout(resolve,20));assert.equal(published,confirmed?1:0);}
    finally {service.stop();}
  }
});

test('backend key reuse is explicit, derives the writer and attaches the API key to both transports',()=>{
  // Public Anvil fixture key. Never fund or use outside tests.
  const key='0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const env={ARKIV_ENABLED:'true',ARKIV_USE_SLOT_BACKEND_KEY:'true',SLOT_BACKEND_PRIVATE_KEY:key,ARKIV_API_KEY:'test/key',ARKIV_SEASON_ANCHOR_BLOCK:'100',ARKIV_BASE_FROM_BLOCK:'1'};
  const result=loadArkivConfig(env)!;
  assert.equal(result.writer,privateKeyToAccount(key).address);assert.equal(result.privateKey,key);
  assert.equal(new URL(result.httpUrl).pathname,'/test%2Fkey');assert.equal(new URL(result.wsUrl).pathname,'/test%2Fkey');
  assert.throws(()=>loadArkivConfig({...env,ARKIV_WRITER_ADDRESS:player}),/mismatch/);
  assert.throws(()=>loadArkivConfig({...env,ARKIV_PRIVATE_KEY:key}),/one Arkiv signing key source/);
  assert.throws(()=>loadArkivConfig({...env,SLOT_BACKEND_PRIVATE_KEY:'REPLACE_ME'}));
  assert.throws(()=>loadArkivConfig({...env,SLOT_BACKEND_PRIVATE_KEY:''}));
  assert.throws(()=>loadArkivConfig({...env,ARKIV_USE_SLOT_BACKEND_KEY:'false'}),/WRITER_ADDRESS/);
  assert.throws(()=>loadArkivConfig({...env,ARKIV_RPC_URL:'not-a-url'}),/^Error: Invalid Arkiv transport configuration$/);
});
