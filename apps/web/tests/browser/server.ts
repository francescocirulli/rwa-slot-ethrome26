import {buildSync} from 'esbuild';
import {createServer,type ServerResponse} from 'node:http';
import {emptyView,type LeaderboardView} from '../../lib/arkiv/model';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseUnits} from 'viem';
import {PAYMENT_ASSET,RWA_ASSETS} from '../../lib/assets';
import {createHardware} from '../../lib/hardware';
import {createRelay} from '../../lib/relay';
import {walletFixture} from '../fixtures';
import nextConfig from '../../next.config';
import {terminalCsp} from '../../lib/terminal-security';
// FIXTURE_ORIGIN / FIXTURE_HOST let the same fixture server be opened from another device on the LAN (for example an iPad).
const origin = process.env.FIXTURE_ORIGIN || 'http://localhost:3101', host = process.env.FIXTURE_HOST || '127.0.0.1';
const relay = createRelay({origin, walletService: walletFixture().service,
  readBalance: async () => ({amount: '128.50', updatedAt: Date.now(), stale: false})});
const hardware = createHardware({origin, token: 'browser-hardware-test-token-32-characters'});
const bundle=buildSync({entryPoints:['tests/browser/inventory-fixture.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
const phoneBundle=buildSync({entryPoints:['tests/browser/phone-fixture.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',outfile:'phone.js',alias:{'@privy-io/react-auth':'./tests/browser/phone-privy-fixture.tsx','@/lib/slot/use-transaction':'./tests/browser/phone-transaction-fixture.ts','@/lib/wallet-authorization-client':'./tests/browser/ownership-wallet-fixture.ts'},define:{'process.env.NODE_ENV':'"test"'}});
// Exercise the production transaction hook, replacing only the external wallet SDK.
const phoneTransactionBundle=buildSync({entryPoints:['tests/browser/phone-fixture.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',outfile:'phone-transactions.js',alias:{'@privy-io/react-auth':'./tests/browser/phone-privy-fixture.tsx','@/lib/wallet-authorization-client':'./tests/browser/ownership-wallet-fixture.ts'},define:{'process.env.NODE_ENV':'"test"'}});
const quickBundle=buildSync({entryPoints:['tests/browser/quick-fund-fixture.tsx'],outfile:'quick.js',bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@privy-io/react-auth':'./tests/browser/quick-fund-privy-fixture.ts','@/lib/wallet-authorization-client':'./tests/browser/quick-fund-wallet-fixture.ts'},define:{'process.env.NODE_ENV':'"test"'}});
const ownershipBundle=buildSync({entryPoints:['tests/browser/ownership-fixture.tsx'],outfile:'ownership.js',bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@privy-io/react-auth':'./tests/browser/quick-fund-privy-fixture.ts','@/lib/wallet-authorization-client':'./tests/browser/ownership-wallet-fixture.ts'},define:{'process.env.NODE_ENV':'"test"'}});
const wallet='0x0000000000000000000000000000000000000011';
const quickBalances:Record<string,bigint>={nvidia:0n,spacex:5000000000n};
const quickOps=new Map<string,{id:string;assetId:string;input:bigint;estimated:bigint;minimum:bigint;sent:boolean;credited:boolean;step:'approval'|'swap'}>();
let quickSeq=0,quickApproved=false,quickLag=0,quickScenario='',quickInventoryCalls=0;
const quickReserves:Record<string,bigint>={nvidia:0n,spacex:0n};
const quickRequired=()=>({nvidia:quickScenario==='tiny'?1000n:10000000000n,spacex:5000000000n});
function quickInventory(){
  quickInventoryCalls++;
  const lagging=quickLag>0;if(lagging)quickLag--;
  return {address:wallet,contract:null,block:String(100+quickInventoryCalls),updatedAt:Date.now(),eth:'0.1',contractEth:null,catalogAvailable:true,scope:'funding',funding:{assets:Object.entries(quickRequired()).map(([id,required])=>({kind:1,token:RWA_ASSETS.find(a=>a.id===id)!.address,required:String(required),available:String(quickReserves[id])}))},freeSpins:'0',mintEnabled:false,swapEnabled:true,canManageOwnership:false,collection:{address:'0x0000000000000000000000000000000000000000',owner:null,pendingOwner:null,canMint:false,canAcceptOwnership:false},assets:[PAYMENT_ASSET,...RWA_ASSETS].map(asset=>{const value=asset.id==='nvidia'?(lagging?0n:quickBalances.nvidia):asset.id==='spacex'?quickBalances.spacex:100000000000n;return {...asset,balance:String(value),formatted:null,verified:true,canDeposit:asset.id!=='usdc',reserve:{balance:String(quickReserves[asset.id]||0n),reserved:'0',available:String(quickReserves[asset.id]||0n)}};}),nfts:[]};
}
function quickView(op:{id:string;assetId:string;input:bigint;estimated:bigint;minimum:bigint;sent:boolean;step:'approval'|'swap'},stage:string){return {id:op.id,address:wallet,assetId:op.assetId,inputAssetId:'usdc',expiresAt:Date.now()+30000,stage,step:op.step,input:String(op.input),estimated:String(op.estimated),minimum:String(op.minimum),gasEstimate:'100000',feeAmount:'0',route:'mock',gasToken:'USDC',actionId:'transaction_'+op.id.slice(0,8),userOperationHash:null,fromBlock:null,output:stage==='succeeded'?String(op.estimated):null,hashes:[],error:null};}
let seasonView:LeaderboardView=emptyView();
const seasonClients=new Set<ServerResponse>();
const securityHeaders=nextConfig.headers!();
const sendSeason=(res:ServerResponse)=>res.write('event: standings\ndata: '+JSON.stringify(seasonView)+'\n\n');
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost:3101');
  // Exercise the real production policies, not a permissive HTML-only fixture.
  for(const rule of await securityHeaders) {
    if(rule.source==='/:path*'||rule.source===url.pathname)for(const header of rule.headers)res.setHeader(header.key,header.value);
  }
  if(url.pathname==='/'||url.pathname==='/terminal/index.html')res.setHeader('Content-Security-Policy',terminalCsp);
  if(url.pathname==='/api/ens'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({configured:false,names:[],claims:[]}));return;}
  if(url.pathname==='/api/leaderboard/stream') {
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});sendSeason(res);seasonClients.add(res);req.on('close',()=>seasonClients.delete(res));return;
  }
  if(url.pathname==='/fixture/season'&&req.method==='POST') {
    const chunks:Buffer[]=[];for await(const chunk of req) chunks.push(Buffer.from(chunk));seasonView=JSON.parse(Buffer.concat(chunks).toString());for(const client of seasonClients) sendSeason(client);res.end('{}');return;
  }
  if(url.pathname==='/ownership-fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><link rel="stylesheet" href="/admin-fixture.css"></head><body><div id="root"></div><script src="/ownership-fixture.js"></script></body></html>');return;}
  if(url.pathname==='/ownership-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(ownershipBundle.outputFiles.find(file=>file.path.endsWith('.js'))!.text);return;}
  if(url.pathname==='/phone-transactions-fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/phone-fixture.css"></head><body><div id="root"></div><script src="/phone-transactions-fixture.js"></script></body></html>');return;}
  if(url.pathname==='/phone-transactions-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(phoneTransactionBundle.outputFiles.find(file=>file.path.endsWith('.js'))!.text);return;}
  if(url.pathname==='/phone-fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/phone-fixture.css"></head><body><div id="root"></div><script src="/phone-fixture.js"></script></body></html>');return;}
  if(url.pathname==='/phone-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(phoneBundle.outputFiles.find(file=>file.path.endsWith('.js'))!.text);return;}
  if(url.pathname==='/phone-fixture.css'){res.setHeader('Content-Type','text/css');res.end((await readFile(join(process.cwd(),'app/phone/style.css'),'utf8'))+'\n'+(await readFile(join(process.cwd(),'lib/slot/transaction-review.css'),'utf8')));return;}
  if(url.pathname==='/inventory-fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><link rel="stylesheet" href="/admin-fixture.css"></head><body><div id="root"></div><script src="/inventory-fixture.js"></script></body></html>');return;}
  if(url.pathname==='/inventory-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(url.pathname==='/quick-fund-fixture'){if(!url.searchParams.has('resume')){quickScenario=url.searchParams.get('scenario')||'';quickInventoryCalls=0;quickLag=0;quickReserves.nvidia=0n;quickReserves.spacex=0n;quickBalances.nvidia=0n;quickBalances.spacex=5000000000n;quickOps.clear();quickSeq=0;quickApproved=false;if(quickScenario==='stocked'){quickReserves.nvidia=10000000000n;quickReserves.spacex=5000000000n;quickBalances.nvidia=50000000000n;quickBalances.spacex=25000000000n;}}res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><link rel="stylesheet" href="/admin-fixture.css"></head><body><div id="root"></div><script src="/quick-fund-fixture.js"></script></body></html>');return;}
  if(url.pathname==='/quick-fund-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(quickBundle.outputFiles.find(file=>file.path.endsWith('.js'))!.text);return;}
  if(url.pathname==='/admin-fixture.css'){res.setHeader('Content-Type','text/css');res.end((await readFile(join(process.cwd(),'app/admin/style.css'),'utf8'))+'\n'+(await readFile(join(process.cwd(),'lib/slot/transaction-review.css'),'utf8')));return;}
  if(url.pathname.startsWith('/brands/')&&/^\/brands\/[a-z-]+\.(svg|png)$/.test(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.svg')?'image/svg+xml':'image/png');res.end(await readFile(join(process.cwd(),'public',url.pathname)));return;}
  if (url.pathname === '/api/health') {res.end('ok'); return;}
  if (url.pathname.startsWith('/api/relay/') || url.pathname.startsWith('/api/hardware/')) {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const result = await (url.pathname.startsWith('/api/hardware/') ? hardware : relay).handle(new Request(url, {method: req.method, headers: req.headers as Record<string, string>,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined}));
    res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(await result.text()); return;
  }
  if(url.pathname==='/fixture/deposit'){
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const {args}=JSON.parse(Buffer.concat(chunks).toString());
    const asset=RWA_ASSETS.find(a=>a.address.toLowerCase()===args[0].toLowerCase())!;const amount=BigInt(args[1]);
    if(quickBalances[asset.id]<amount){res.writeHead(409);res.end('Insufficient balance');return;}
    quickBalances[asset.id]-=amount;quickReserves[asset.id]+=amount;res.end('{}');return;
  }
  if (url.pathname.startsWith('/api/admin/assets/')) {
    res.setHeader('Content-Type','application/json');
    const action=url.pathname.split('/').pop();
    if(action==='inventory'){res.end(JSON.stringify(quickInventory()));return;}
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body:Record<string,unknown>=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
    if(action==='quote'){
      const input=parseUnits(String(body.amount),6),estimated=input*100n,minimum=estimated*995n/1000n;
      const id=(++quickSeq).toString(16).padStart(64,'0');
      const op={id,assetId:String(body.assetId),input,estimated,minimum,sent:false,credited:false,step:(quickApproved?'swap':'approval') as 'approval'|'swap'};
      quickOps.set(id,op);res.end(JSON.stringify(quickView(op,'quoted')));return;
    }
    const op=quickOps.get(String(body.id||url.searchParams.get('id')||''));
    if(!op){res.statusCode=404;res.end(JSON.stringify({error:'Operazione non trovata.'}));return;}
    if(action==='execute'){op.sent=true;res.end(JSON.stringify(quickView(op,'pending')));return;}
    if(action==='status'){
      if(op.sent&&op.step==='approval'){quickApproved=true;res.end(JSON.stringify(quickView(op,'approved')));return;}
      if(op.sent&&!op.credited){if(quickScenario==='lag')quickLag=2;quickBalances[op.assetId]=(quickBalances[op.assetId]||0n)+op.estimated;op.credited=true;}
      res.end(JSON.stringify(quickView(op,op.sent?'succeeded':'pending')));return;
    }
  }
  const path = url.pathname === '/' ? '/terminal/index.html' : url.pathname;
  if (!/^\/(terminal|symbols|decor)\/[a-z0-9-]+\.(html|js|css|svg)$/.test(path)) {res.writeHead(404); res.end(); return;}
  const types: Record<string, string> = {html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml'};
  res.setHeader('Content-Type', types[path.split('.').pop()!]); res.end(await readFile(join(process.cwd(), 'public', path)));
});
server.listen(Number(process.env.FIXTURE_PORT||3101), host);
process.on('SIGTERM', () => {relay.close(); server.close();});
