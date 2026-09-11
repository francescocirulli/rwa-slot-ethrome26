// Isolated browser fixture: bundles the real admin components with mock Privy/network.
// Never imported by the app, never sends a wallet transaction.
import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const temp=await mkdtemp(join(tmpdir(),'slot-assets-ui-'));
await mkdir('artifacts',{recursive:true});
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AdminWorkspace}from'./app/admin/workspace';import './app/admin/style.css';createRoot(document.getElementById('root')).render(<AdminWorkspace account={window.fixture} identity="Test owner" error="" busy={false} onRefresh={()=>{}} onLogout={()=>{}}/>);`,resolveDir:process.cwd(),sourcefile:'fixture.tsx',loader:'tsx'},bundle:true,outfile:join(temp,'fixture.js'),jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'mock-privy',setup(b){b.onResolve({filter:/^@privy-io\/react-auth$/},()=>({path:'privy',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const usePrivy=()=>({getAccessToken:async()=>"test-access"});export const getIdentityToken=async()=>{await new Promise(r=>setTimeout(r,100));return "test-identity";};',loader:'js'}));}}],logLevel:'silent'});
const wallet='0x0000000000000000000000000000000000000099';
const fixture={userId:'did:privy:test',state:'ready',role:'owner',members:[],operationsEnabled:true,wallet:{address:wallet,balance:{amount:'100',stale:false},depositQr:'/symbols/symbol-1.svg'}};
const assets=[['usdc','USDC','USDC',6,null,'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],['nvidia','NVIDIA','NVDAc',8,2,'0xB20000000000000000000078EE7CE2FE4908108c'],['spacex','SpaceX','SPCXc',8,4,'0xb2000000000000000000007b9fcbd005511acbd5'],['apple','Apple','AAPLc',8,5,'0xb200000000000000000000c2e324d24d7eecd1fb'],['alphabet','Alphabet','GOOGLc',8,6,'0xb2000000000000000000002d0ba3164cc74f58b7'],['amazon','Amazon','AMZNc',8,7,'0xb200000000000000000000d9192b6b456483c2e8'],['gold','Gold','DGLD',18,11,'0xe908475f8beb7a138b0dc6eb5a05cb27068ffb9a']].map(([id,name,ticker,decimals,symbol,address])=>({id,name,ticker,decimals,symbol,address,logo:'/brands/'+id+(id==='alphabet'?'.png':'.svg'),balance:String(10n**BigInt(decimals)*100n),formatted:'100',verified:true,canDeposit:false}));
const inventory={address:wallet,contract:null,eth:'0.01',block:'123',updatedAt:Date.now(),swapEnabled:true,assets,nfts:[{symbol:0,name:'Magnete'},{symbol:3,name:'Gadget'},{symbol:8,name:'ENS Registration'},{symbol:9,name:'Urbe Hub Day Pass'},{symbol:10,name:'T-shirt'}].map(n=>({...n,token:null,tokenId:null,balance:null})),freeSpins:null};
let sends=0,statusCalls=0,depositSends=0,approved=false;const deposits=[],swapRequests=[];let currentQuote;
const quote={id:'a'.repeat(64),address:wallet,assetId:'nvidia',expiresAt:Date.now()+300000,stage:'quoted',step:'approval',inputAssetId:'usdc',feeAmount:'25000',route:'nordstern',gasToken:null,input:'10000000',estimated:'5000000',minimum:'4975000',gasEstimate:'100000000000',actionId:null,output:null,hashes:[],error:null};
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');
  if(path.startsWith('/api/')){res.setHeader('Content-Type','application/json');let result={configured:false};if(path.endsWith('/inventory'))result=inventory;if(path.endsWith('/quote')){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);swapRequests.push(body);currentQuote={...quote,id:String(swapRequests.length).repeat(64),assetId:body.assetId,inputAssetId:body.inputAssetId,input:body.inputAssetId==='eth'?'4000000000000000':'10000000',feeAmount:body.inputAssetId==='eth'?'10000000000000':'25000',step:body.inputAssetId==='usdc'&&!approved?'approval':'swap',expiresAt:Date.now()+30000};result=currentQuote;}if(path.endsWith('/execute')){sends++;statusCalls=0;currentQuote.sent=true;result={...currentQuote,stage:'pending',actionId:'transaction_'+sends,gasToken:currentQuote.inputAssetId==='eth'?'ETH':'USDC'};}if(path.endsWith('/status')&&!path.includes('/contract/')){if(!currentQuote.sent){res.end(JSON.stringify(currentQuote));return;}statusCalls++;const done=statusCalls>1;if(done&&currentQuote.step==='approval')approved=true;result={...currentQuote,stage:done?(currentQuote.step==='approval'?'approved':'succeeded'):'pending',output:done&&currentQuote.step==='swap'?'5000000':null,actionId:'transaction_'+sends,gasToken:currentQuote.inputAssetId==='eth'?'ETH':'USDC'};}if(path==='/api/admin/contract/prepare'){let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);deposits.push(input);result={id:'b'.repeat(64),address:wallet,action:input.action,args:input.args,expiresAt:Date.now()+300000,stage:'prepared',transaction:{to:input.args[0],data:'0xa9059cbb',chainId:8453,gasMode:'usdc'}};}
    if(path==='/api/admin/contract/send'){depositSends++;result={stage:'confirming'};}
    if(path==='/api/admin/contract/status')result={stage:'confirmed'};
    res.end(JSON.stringify(result));return;}
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>window.fixture='+JSON.stringify(fixture)+'</script><script src="/fixture.js"></script></body></html>');return;}
  if(!/^\/(fixture\.(js|css)|(brands|symbols)\/[a-z0-9-]+\.(svg|png))$/.test(path)){res.writeHead(404);res.end();return;}
  const types={css:'text/css',js:'text/javascript',svg:'image/svg+xml',png:'image/png'};res.setHeader('Content-Type',types[path.split('.').pop()]);res.end(await readFile(path.startsWith('/fixture')?join(temp,path):join(process.cwd(),'public',path)));
}catch{res.writeHead(500);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const baseURL='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1024,height:768}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseURL);await page.getByRole('button',{name:'Inventory',exact:false}).click();await page.getByText('NVDAc · BASE').waitFor();
  assert.equal(await page.locator('.asset-card').count(),8);assert.equal(await page.locator('.collectible-card').count(),6);assert.equal(await page.getByRole('button',{name:'Deposita nella slot'}).isEnabled().catch(()=>false),false);
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'artifacts/admin-inventory-ipad.png',fullPage:true});
  await page.getByRole('button',{name:'Swap',exact:false}).first().click();await page.getByLabel('Importo USDC da scambiare').fill('10');await page.getByRole('button',{name:'Richiedi quotazione'}).click();await page.getByRole('heading',{name:'Autorizza USDC per lo swap'}).waitFor();assert.equal(sends,0);assert.match(await page.getByLabel('Saldi del wallet condiviso').innerText(),/ETH\s*0\.01/);
  await page.screenshot({path:'artifacts/admin-swap-ipad.png',fullPage:true});
  await page.getByRole('button',{name:'Autorizza USDC con Privy'}).click();await page.getByRole('heading',{name:'USDC autorizzati.'}).waitFor({timeout:15000});assert.equal(sends,1);assert.equal(await page.getByRole('heading',{name:'Token arrivati.'}).count(),0);
  await page.getByRole('button',{name:'Richiedi quotazione'}).click();await page.getByRole('button',{name:'Conferma swap con Privy'}).click();await page.getByRole('heading',{name:'Token arrivati.'}).waitFor({timeout:15000});assert.equal(sends,2);assert.ok(statusCalls>=2);assert.deepEqual(errors,[]);
  // A separately logged-in collaborator sees the same balances and may swap native ETH.
  fixture.role='operator';fixture.userId='did:privy:collaborator';await page.reload();await page.getByRole('button',{name:'Swap',exact:false}).first().click();
  await page.getByLabel('Token da scambiare',{exact:true}).selectOption('eth');await page.getByLabel('Importo ETH da scambiare').fill('0.004');await page.getByRole('button',{name:'Richiedi quotazione'}).click();await page.getByRole('heading',{name:'Controlla lo swap'}).waitFor();assert.equal(swapRequests.at(-1).inputAssetId,'eth');assert.equal(swapRequests.at(-1).amount,'0.004');
  await page.screenshot({path:'artifacts/admin-swap-eth-collaborator-ipad.png',fullPage:true});await page.getByRole('button',{name:'Conferma swap con Privy'}).click();await page.getByRole('heading',{name:'Token arrivati.'}).waitFor({timeout:15000});assert.equal(sends,3);await page.getByText('Modalità gas: ETH dal wallet condiviso · fallback ETH.').waitFor();
  // Desktop composition and token selection invalidate a previous quote.
  await page.setViewportSize({width:1440,height:1000});await page.getByLabel('Token da acquistare').selectOption('gold');await page.screenshot({path:'artifacts/admin-swap-desktop.png',fullPage:true});
  inventory.contract='0x0000000000000000000000000000000000000088';inventory.assets.forEach(a=>{a.canDeposit=true;});
  await page.getByRole('button',{name:'Inventory',exact:false}).click();
  const nvidiaCard=page.locator('.asset-card').filter({has:page.getByRole('heading',{name:'NVIDIA',exact:true})});
  await nvidiaCard.getByRole('button',{name:'Deposita nella slot'}).click();
  await page.getByLabel('Importo NVDAc').fill('0.12345678');await page.getByRole('button',{name:'Simula e conferma deposito'}).click();
  await page.getByRole('dialog').waitFor();assert.equal(depositSends,0);assert.equal(deposits[0].action,'fundERC20');assert.equal(deposits[0].args[1],'12345678');
  await page.getByRole('button',{name:'Conferma dal mio wallet'}).click();await page.waitForFunction(()=>!document.querySelector('.inventory-deposit'));assert.equal(depositSends,1);assert.deepEqual(errors,[]);
  await writeFile('artifacts/assets-ui-check.json',JSON.stringify({passed:true,viewports:['1024x768','1440x1000'],assets:8,inputs:['USDC','ETH'],roles:['owner','operator'],collectibles:6,confirmations:sends,depositConfirmations:depositSends,errors},null,2));console.log('Asset browser checks passed: inventory, local logos, iPad overflow, explicit swap confirmation and multi-step status.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
