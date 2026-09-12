import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createPublicClient,decodeFunctionData,encodeFunctionResult,encodeAbiParameters,multicall3Abi} from 'viem';
import {createBaseReadClient,baseChainCheck} from '../lib/base-read-client';
import {createSwapChain} from '../lib/admin/swaps';
import {rpcTransport} from '../lib/rpc-transport';

test('admin RPC batches concurrent reads and immediately falls back on 429',async()=>{
  let primaryCalls=0,fallbackCalls=0,batchSize=0;
  const primary=createServer((_req,res)=>{primaryCalls++;res.writeHead(429,{'Content-Type':'application/json'});res.end('{"error":"rate limit"}');});
  const secondary=createServer(async(req,res)=>{fallbackCalls++;const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const payload=JSON.parse(Buffer.concat(chunks).toString());batchSize=Array.isArray(payload)?payload.length:1;const reply=(x:{id:number;params:[{data:`0x${string}`}]})=>{const decoded=decodeFunctionData({abi:multicall3Abi,data:x.params[0].data});assert.equal(decoded.functionName,'aggregate3');const calls=decoded.args[0] as readonly unknown[];batchSize=calls.length;return {id:x.id,jsonrpc:'2.0',result:encodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',result:calls.map(()=>({success:true,returnData:encodeAbiParameters([{type:'uint256'}],[16n])}))})};};res.setHeader('Content-Type','application/json');res.end(JSON.stringify(Array.isArray(payload)?payload.map(reply):reply(payload)));});
  await Promise.all([new Promise<void>(r=>primary.listen(0,'127.0.0.1',r)),new Promise<void>(r=>secondary.listen(0,'127.0.0.1',r))]);
  const url=(server:typeof primary)=>'http://127.0.0.1:'+(server.address() as {port:number}).port;
  const saved=process.env.BASE_RPC_FALLBACK_URLS;process.env.BASE_RPC_FALLBACK_URLS=url(secondary);
  try{
    const client=createBaseReadClient(url(primary));
    const result=await Promise.all([1,2,3].map(n=>client.getBalance({address:('0x'+String(n).padStart(40,'0')) as `0x${string}`})));
    assert.deepEqual(result,[16n,16n,16n]);assert.equal(primaryCalls,1);assert.equal(fallbackCalls,1);assert.equal(batchSize,3);
  }finally{if(saved===undefined)delete process.env.BASE_RPC_FALLBACK_URLS;else process.env.BASE_RPC_FALLBACK_URLS=saved;primary.closeAllConnections();secondary.closeAllConnections();await Promise.all([new Promise(r=>primary.close(r)),new Promise(r=>secondary.close(r))]);}
});
test('chain validation shares concurrent checks and retries failures without caching them',async()=>{
  let calls=0,wrong=true;
  const check=baseChainCheck({getChainId:async()=>{calls++;return wrong?1:8453;}});
  await assert.rejects(check(),/not on Base/);wrong=false;
  await Promise.all([check(),check(),check()]);await check();assert.equal(calls,2);
});
test('swap user-operation recovery respects capped RPC ranges and advances a five-block cursor',async()=>{
  const saved=process.env.SLOT_LOG_PAGE_BLOCKS;process.env.SLOT_LOG_PAGE_BLOCKS='5';
  const ranges:[bigint,bigint][]=[];
  const client={getChainId:async()=>8453,getBlockNumber:async()=>30n,getLogs:async({fromBlock,toBlock}:{fromBlock:bigint;toBlock:bigint})=>{ranges.push([fromBlock,toBlock]);return [];}} as unknown as Parameters<typeof createSwapChain>[1];
  try{
    const chain=createSwapChain(undefined,client),hash=('0x'+'1'.repeat(64)) as `0x${string}`,wallet=('0x'+'2'.repeat(40)) as `0x${string}`;
    const first=await chain.userOperation(hash,wallet,1n);assert.equal(first.nextBlock,6n);
    await chain.userOperation(hash,wallet,first.nextBlock);assert.deepEqual(ranges,[[1n,5n],[6n,10n]]);
  }finally{if(saved===undefined)delete process.env.SLOT_LOG_PAGE_BLOCKS;else process.env.SLOT_LOG_PAGE_BLOCKS=saved;}
});

test('daily quota errors fall back for shared and slot reads; real transaction rejections remain terminal',async()=>{
  const {createSlotReader}=await import('../lib/slot/reader');
  let message='transaction rejected',secondaryCalls=0;
  const primary=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const payload=JSON.parse(Buffer.concat(chunks).toString());const reply=(x:{id:number})=>({id:x.id,jsonrpc:'2.0',error:{code:-32003,message}});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(Array.isArray(payload)?payload.map(reply):reply(payload)));});
  const secondary=createServer(async(req,res)=>{secondaryCalls++;const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const payload=JSON.parse(Buffer.concat(chunks).toString());const reply=(x:{id:number})=>({id:x.id,jsonrpc:'2.0',result:'0x64'});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(Array.isArray(payload)?payload.map(reply):reply(payload)));});
  await Promise.all([new Promise<void>(r=>primary.listen(0,'127.0.0.1',r)),new Promise<void>(r=>secondary.listen(0,'127.0.0.1',r))]);
  const url=(s:typeof primary)=>'http://127.0.0.1:'+(s.address() as {port:number}).port;
  const saved=process.env.BASE_RPC_FALLBACK_URLS;process.env.BASE_RPC_FALLBACK_URLS=url(secondary);
  try{
    const slot=createSlotReader({address:'0x0000000000000000000000000000000000000011',paymentToken:'0x0000000000000000000000000000000000000022',deploymentBlock:1n,chainId:8453,rpcUrl:url(primary),rpcUrls:[url(primary),url(secondary)],confirmations:2,gasMode:'eth'});
    const clients=[createBaseReadClient(url(primary)),slot.client];
    for(const client of clients)await assert.rejects(client.getBlockNumber({cacheTime:0}));
    assert.equal(secondaryCalls,0);message='daily request limit reached - upgrade your account';
    for(const client of clients)assert.equal(await client.getBlockNumber({cacheTime:0}),100n);
    assert.equal(secondaryCalls,2);
  }finally{if(saved===undefined)delete process.env.BASE_RPC_FALLBACK_URLS;else process.env.BASE_RPC_FALLBACK_URLS=saved;primary.closeAllConnections();secondary.closeAllConnections();await Promise.all([new Promise(r=>primary.close(r)),new Promise(r=>secondary.close(r))]);}
});

type RpcCall = {id:number;method:string;params?:unknown[]};
async function rpcFixture(reply:(call:RpcCall)=>object, status=()=>200, delay=0) {
  const calls:RpcCall[]=[], batches:number[]=[];
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const payload=JSON.parse(Buffer.concat(chunks).toString()),items:RpcCall[]=Array.isArray(payload)?payload:[payload];
    calls.push(...items);batches.push(items.length);
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    res.writeHead(status(),{'Content-Type':'application/json'});
    const results=items.map(call=>({id:call.id,jsonrpc:'2.0',...reply(call)}));
    res.end(JSON.stringify(Array.isArray(payload)?results:results[0]));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:'http://127.0.0.1:'+(server.address() as {port:number}).port,calls,batches,
    close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}

test('a throttled provider is skipped across clients and recovers after cooldown without stale data',async()=>{
  let now=1000,throttled=true,block='0x64';
  const first=await rpcFixture(()=>({result:block}),()=>throttled?429:200);
  const second=await rpcFixture(()=>({result:block}));
  const urls=[first.url,second.url];
  const a=createPublicClient({transport:rpcTransport(urls,{now:()=>now})});
  const b=createPublicClient({transport:rpcTransport(urls,{now:()=>now})});
  try {
    assert.equal(await a.getBlockNumber({cacheTime:0}),100n);
    block='0x65';assert.equal(await b.getBlockNumber({cacheTime:0}),101n);
    assert.equal(first.calls.length,1);assert.equal(second.calls.length,2);
    throttled=false;now+=30001;
    assert.equal(await b.getBlockNumber({cacheTime:0}),101n);
    assert.equal(first.calls.length,2);assert.equal(second.calls.length,2);
  } finally {await first.close();await second.close();}
});

test('timeouts fail over once and subsequent polls avoid the stalled endpoint',async()=>{
  const first=await rpcFixture(()=>({result:'0x64'}),()=>200,300);
  const second=await rpcFixture(()=>({result:'0x65'}));
  const client=createPublicClient({transport:rpcTransport([first.url,second.url],{timeout:100,isolated:true})});
  try {
    assert.equal(await client.getBlockNumber({cacheTime:0}),101n);
    assert.equal(await client.getBlockNumber({cacheTime:0}),101n);
    assert.equal(first.calls.length,1);assert.equal(second.calls.length,2);
  } finally {await first.close();await second.close();}
});

test('total outage fails closed without hammering providers and retries after cooldown',async()=>{
  let now=1000,down=true;
  const first=await rpcFixture(()=>({result:'0x64'}),()=>down?503:200);
  const second=await rpcFixture(()=>({result:'0x64'}),()=>503);
  const client=createPublicClient({transport:rpcTransport([first.url,second.url],{now:()=>now,isolated:true})});
  try {
    await assert.rejects(client.getBlockNumber({cacheTime:0}));
    await assert.rejects(client.getBlockNumber({cacheTime:0}));
    assert.equal(first.calls.length,1);assert.equal(second.calls.length,1);
    down=false;now+=30001;assert.equal(await client.getBlockNumber({cacheTime:0}),100n);
  } finally {await first.close();await second.close();}
});

test('identical in-flight reads share work; distinct requests are batched in bounded groups',async()=>{
  const node=await rpcFixture(()=>({result:'0x64'}));
  const a=createPublicClient({transport:rpcTransport([node.url])});
  const b=createPublicClient({transport:rpcTransport([node.url])});
  try {
    await Promise.all([a,b,a,b].map(client=>client.getBlockNumber({cacheTime:0})));
    assert.equal(node.calls.length,1);
    await Promise.all(Array.from({length:45},(_,index)=>a.getBalance({address:('0x'+index.toString(16).padStart(40,'0')) as `0x${string}`})));
    assert.equal(node.calls.length,46);assert.ok(node.batches.every(size=>size<=20));
  } finally {await node.close();}
});

test('contract reverts remain terminal and unknown wallet submissions are never retried',async()=>{
  let reject=true;
  const first=await rpcFixture(()=>({error:{code:3,message:'execution reverted'}}),()=>reject?200:503);
  const second=await rpcFixture(()=>({result:'0x64'}));
  const transport=rpcTransport([first.url,second.url],{isolated:true})({});
  try {
    await assert.rejects(transport.request({method:'eth_call',params:[{to:'0x0000000000000000000000000000000000000001'},'latest']}));
    assert.equal(second.calls.length,0);reject=false;
    await assert.rejects(transport.request({method:'eth_sendTransaction',params:[{to:'0x0000000000000000000000000000000000000001'}]}));
    assert.equal(second.calls.length,0);
  } finally {await first.close();await second.close();}
});

test('signed broadcasts may fail over only with the exact same bytes',async()=>{
  const first=await rpcFixture(()=>({result:null}),()=>503);
  const second=await rpcFixture(()=>({result:'0x'+'1'.repeat(64)}));
  const transport=rpcTransport([first.url,second.url],{isolated:true})({});
  try {
    await transport.request({method:'eth_sendRawTransaction',params:['0x1234']});
    assert.deepEqual(first.calls[0].params,['0x1234']);assert.deepEqual(second.calls[0].params,['0x1234']);
  } finally {await first.close();await second.close();}
});

test('provider request-limit code -32007 opens a cooldown and repeated failures increase the delay',async()=>{
  let now=1000;
  const first=await rpcFixture(()=>({error:{code:-32007,message:'request limit reached'}}));
  const second=await rpcFixture(()=>({result:'0x64'}));
  const client=createPublicClient({transport:rpcTransport([first.url,second.url],{now:()=>now,isolated:true})});
  try {
    assert.equal(await client.getBlockNumber({cacheTime:0}),100n);
    now+=30001;assert.equal(await client.getBlockNumber({cacheTime:0}),100n);
    assert.equal(first.calls.length,2);
    now+=30001;assert.equal(await client.getBlockNumber({cacheTime:0}),100n);
    assert.equal(first.calls.length,2);
    now+=30001;assert.equal(await client.getBlockNumber({cacheTime:0}),100n);
    assert.equal(first.calls.length,3);
  } finally {await first.close();await second.close();}
});
