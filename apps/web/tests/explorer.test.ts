import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {Entity,jsonToPayload} from '@arkiv-network/sdk';
import {addr,bool,i32,u64,u256} from '@arkiv-network/sdk/attr';
import {collectResults,parseExplorer,summarize,ExplorerError,explorerPlan} from '../lib/arkiv/explorer';
import {createArkivStore} from '../lib/arkiv/store';
import type {ArkivConfig} from '../lib/arkiv/config';
import type {SlotReader} from '../lib/slot/reader';
const player='0x0000000000000000000000000000000000000011';
const config:ArkivConfig={project:'test',httpUrl:'http://localhost',wsUrl:'ws://localhost',writer:player,anchor:100n,seasonBlocks:60n,baseFromBlock:1n,historyDays:30};
function entity(id:number,won=true){return new Entity({expiresAt:160n,attributes:{game_id:u256(BigInt(id)),player:addr(player),played_at:u64(1000n+BigInt(id)),won:bool(won),points:i32(won?100:0),matches:i32(won?5:0),symbol:i32(won?2:255),prize_kind:i32(won?1:0)},payload:jsonToPayload({transactionHash:'0x'+'1'.repeat(64),symbols:Array(15).fill(2)})});}
async function* source(items:Entity[]){yield* items;}
test('filters reject query injection, duplicate parameters, invalid wallet and incomplete personal scope',()=>{
  for(const query of ['player=anything','mode=summary','won=yes','symbol=16','matches=4','page=-1','page=200','period=forever','where=1','period=day&period=week','snapshot=-2',`game=${2n**256n}`,`mode=summary&player=${player}&won=true`])assert.throws(()=>parseExplorer(new URLSearchParams(query)),ExplorerError);
  const filters=parseExplorer(new URLSearchParams(`player=${player}&won=false&matches=3&symbol=2&prize=1&period=week`));assert.equal(filters.won,false);assert.equal(filters.matches,3);
});
test('whole-query summary deduplicates every page and counts losses without invented wins',async()=>{
  const rows=await collectResults(source([...Array.from({length:201},(_,i)=>entity(i)),entity(0),entity(202,false)]),159n,160n);
  const summary=summarize(rows);assert.equal(rows.length,202);assert.equal(summary.points,20100);assert.equal(summary.spins,202);assert.equal(summary.wins,201);assert.equal(summary.losses,1);assert.equal(summary.five,201);assert.equal(summary.symbols[0].symbol,2);assert.equal(rows[0].gameId,'202');assert.equal(rows[0].symbol,255,'contract NO_WIN sentinel stays valid and never enters the winning-symbol distribution');
});
test('expiry, malformed data, conflicting replay and oversized queries fail instead of partial totals',async()=>{
  await assert.rejects(collectResults(source([entity(0)]),160n),/expiry/);
  await assert.rejects(collectResults(source([entity(0)]),159n,170n),/expiry/);
  await assert.rejects(collectResults(source([entity(0),entity(0,false)]),159n),/Conflicting/);
  const invalid=entity(0);invalid.attributes={...invalid.attributes,points:i32(99)};await assert.rejects(collectResults(source([invalid]),159n),/Invalid/);
  await assert.rejects(collectResults(source(Array.from({length:5001},()=>entity(0))),159n),/Too many/);
  assert.deepEqual(summarize([]),{spins:0,wins:0,points:0,winRate:0,three:0,five:0,losses:0,symbols:[]});
});
test('season summaries use expiring contributions; history is independent and pre-season is empty',()=>{
  const f=parseExplorer(new URLSearchParams(`mode=summary&player=${player}`));
  assert.equal(explorerPlan(config,f,{number:159n,timestamp:1118n},1000n).kind,'season-spin');
  assert.equal(explorerPlan(config,{...f,period:'week'},{number:159n,timestamp:1118n},1000n).kind,'spin');
  assert.equal(explorerPlan(config,f,{number:99n,timestamp:998n},0n).empty,true);
});
test('SDK sends typed compound filters, pins all pages, and computes totals before slicing',async()=>{
  const queries:string[]=[],snapshots:string[]=[];
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());let result:unknown;
    if(body.method==='eth_getBlockByNumber')result={number:body.params[0]==='0x64'?'0x64':'0x9f',timestamp:body.params[0]==='0x64'?'0x3e8':'0x4b0',hash:'0x'+'0'.repeat(64),transactions:[]};
    else if(body.method==='arkiv_query'){
      const [query,options]=body.params;queries.push(query);snapshots.push(options.atBlock);
      const ids=options.cursor?[201]:Array.from({length:200},(_,i)=>i);
      result={blockNumber:'0x9f',data:ids.map(id=>({key:'0x'+String(id).padStart(64,'0'),expiresAt:'0xa0',payload:'0x'+Buffer.from(jsonToPayload({transactionHash:'0x'+'1'.repeat(64)})).toString('hex'),attributes:[{name:'game_id',type:'u256',value:String(id)},{name:'player',type:'addr',value:player},{name:'played_at',type:'u64',value:'1000'},{name:'won',type:'bool',value:true},{name:'points',type:'i32',value:100},{name:'matches',type:'i32',value:5},{name:'symbol',type:'i32',value:2},{name:'prize_kind',type:'i32',value:1}]})),...(!options.cursor?{cursor:'second'}:{})};
    }else throw new Error('Unexpected method '+body.method);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{
    const store=createArkivStore({...config,httpUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`},{config:{chainId:8453,address:player}} as unknown as SlotReader);
    const filters=parseExplorer(new URLSearchParams(`player=${player}&won=true&matches=5&symbol=2&prize=1`));
    const result=await store.explore(filters);assert.equal(result.total,201);assert.equal(result.rows.length,25);assert.equal(result.summary.points,20100);
    assert.equal(queries.length,2);assert.deepEqual(snapshots,['0x9f','0x9f']);
    for(const token of ['$creator','project','source_chain','slot',"kind = str('season-spin')",'schedule','season_end','played_at >= u64(1000)','played_at <= u64(1200)','player','won = true','matches = i32(5)','symbol = i32(2)','prize_kind = i32(1)'])assert.ok(queries[0].includes(token),token+' missing from '+queries[0]);
    const second=await store.explore({...filters,page:1,snapshot:159n});assert.equal(second.rows.length,25);assert.equal(queries.length,2,'cached complete snapshot reused for next page');
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
test('shared explorer and terminal host parse as ES5 for Safari 12',()=>{
  for(const file of ['explorer.js','explorer-host.js'])parse(readFileSync('public/terminal/'+file,'utf8'),{ecmaVersion:5});
});
