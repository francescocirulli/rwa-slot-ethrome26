import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {decodeFunctionData,encodeFunctionResult,encodeAbiParameters,multicall3Abi} from 'viem';
import {createBaseReadClient,baseChainCheck} from '../lib/base-read-client';
import {createSwapChain} from '../lib/admin/swaps';

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
