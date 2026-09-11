// Manual integration test: two disposable Privy identities and a separate empty
// test wallet. No transfers. JWTs stay inside the browser/request handler.
import {chromium,expect,type Page} from '@playwright/test';
import {PrivyClient} from '@privy-io/node';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createAdminService} from '../lib/admin/service';
import {createWalletAuthorizationHandler} from '../lib/wallet-authorization-api';
import {createAdminHandler} from '../lib/admin/api';
import {createWalletService} from '../lib/privy';
import {createBalanceReader} from '../lib/balance';
import {createAccountHandler} from '../lib/account';
import {adminChainFixture} from '../tests/browser/admin-chain-fixture.mjs';
const diagnosticLog=(value:object)=>{if(process.env.LIVE_CHECK_DIAGNOSTICS==='1')console.log(JSON.stringify(value));};
async function main(){
const origin=process.env.LIVE_CHECK_ORIGIN||'http://localhost:3000';
const appId=process.env.NEXT_PUBLIC_PRIVY_APP_ID!,appSecret=process.env.PRIVY_APP_SECRET!;
if(!appId||!appSecret)throw new Error('Load the app environment without printing it.');
const externalId='lucky_signal_test_'+randomUUID().replaceAll('-','');
const browser=await chromium.launch({channel:'chrome',headless:true});
const evidence:{steps:string[];passed:boolean;failedStage?:string;realPrivy:boolean;transfers:boolean;date:string}={steps:[],passed:false,realPrivy:true,transfers:false,date:new Date().toISOString()};
let stage='initialization';
function passed(){evidence.steps.push(stage);console.log('PASS: '+stage);}
try {
  await mkdir('artifacts',{recursive:true});
  const pages:Page[]=[],ids:string[]=[];
  for(let person=0;person<2;person++){
    const context=await browser.newContext({viewport:{width:person?390:1280,height:900}}),page=await context.newPage();pages.push(page);
    page.on('requestfailed',request=>diagnosticLog({requestFailed:new URL(request.url()).pathname}));
    page.on('response',response=>{if(response.url().includes('privy.io')&&response.status()>=400)diagnosticLog({privyPath:new URL(response.url()).pathname,status:response.status()});});
    const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
    await page.goto(origin+'/admin');
    stage='independent passkey signup '+(person+1);
    await page.getByRole('button',{name:'Prima volta? Crea una passkey'}).click();
    await expect(page.locator('.admin-account-code code')).toBeVisible({timeout:60000});
    ids.push((await page.locator('.admin-account-code code').textContent())!);passed();
  }
  expect(ids[0]).not.toBe(ids[1]);
  const client=new PrivyClient({appId,appSecret,maxRetries:0,timeout:20000});
  let service=createAdminService(client,ids[0],()=>null,externalId);
  const wallets=createWalletService(appId,appSecret,externalId),readBalance=createBalanceReader(process.env.BASE_RPC_URL);
  const diagnostic=(current:typeof service)=>({...current,setMember:async(...args:Parameters<typeof current.setMember>)=>{
    try{return await current.setMember(...args);}catch(error){
      const failure=error as {name?:string;status?:number;message?:string};
      console.log(JSON.stringify({providerError:failure.name,status:failure.status,message:failure.message?.replace(/[A-Za-z0-9+/_=-]{28,}/g,'[redacted]').slice(0,700)}));throw error;
    }
  }});
  let handle=createAdminHandler({service:diagnostic(service),walletService:wallets,origin,readBalance});
  const personal=createAccountHandler(wallets,readBalance);
  const authorization=createWalletAuthorizationHandler({walletService:wallets,origin});
  for(const page of pages)await page.route('**/api/wallet-authorization',async route=>{
    const request=route.request();diagnosticLog({authorizationAction:request.postDataJSON()?.action,event:'start'});const response=await authorization(new Request(request.url(),{method:request.method(),headers:request.headers(),body:request.postData()||undefined}));
    diagnosticLog({authorizationAction:request.postDataJSON()?.action,status:response.status,state:(await response.clone().json()).state});
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  for(const page of pages)await page.route('**/api/admin/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path.startsWith('/api/admin/contract/')){await route.abort('blockedbyclient');return;}
    const action=path.split('/').pop() as 'account'|'create'|'member'|'proof';
    diagnosticLog({adminAction:action,event:'start'});
    const response=await handle(new Request(request.url(),{method:request.method(),headers:request.headers(),body:request.postData()||undefined}),action);
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  const [owner,operator]=pages;
  stage='configured owner creates dedicated shared wallet; no personal wallet is required';
  await owner.getByRole('button',{name:'Verifica accesso',exact:false}).click();
  await owner.getByRole('button',{name:'Crea wallet condiviso',exact:false}).click();
  await expect(owner.locator('.admin-shell')).toBeVisible({timeout:90000});
  await owner.getByRole('button',{name:'Wallet admin',exact:false}).click();
  const address=(await owner.locator('.account-details code').textContent())!;
  await expect(owner.locator('.admin-wallet-balance')).toContainText('0,00',{timeout:30000});
  expect((await service.resolve({userId:ids[0],wallets:[]})).wallet.address).toBe(address);passed();
  stage='owner authorizes second Privy identity with native browser authorization';
  await owner.getByLabel('Codice account del collaboratore').fill(ids[1]);
  await owner.getByRole('button',{name:'Aggiungi collaboratore',exact:false}).click();
  await owner.getByRole('button',{name:'Conferma autorizzazione',exact:true}).click();
  await Promise.race([
    expect(owner.locator('.team-members')).toContainText(ids[1],{timeout:90000}),
    owner.locator('.admin-team [role="alert"]').waitFor({timeout:90000}).then(async()=>{throw new Error((await owner.locator('.admin-team [role="alert"]').textContent())||'Provider error');})
  ]);
  await expect(owner.locator('.team-members')).toContainText(ids[1]);
  await operator.getByRole('button',{name:'Verifica accesso',exact:false}).click();
  await expect(operator.locator('.admin-shell')).toBeVisible({timeout:60000});
  await operator.getByRole('button',{name:'Wallet admin',exact:false}).click();
  await expect(operator.locator('.account-details code')).toHaveText(address);
  await expect(operator.getByLabel('Codice account del collaboratore')).toHaveCount(0);
  const qr=await owner.getByRole('img',{name:'QR indirizzo del wallet admin su Base'}).getAttribute('src');
  await expect(operator.getByRole('img',{name:'QR indirizzo del wallet admin su Base'})).toHaveAttribute('src',qr!);passed();
  stage='both authenticated users produce real verified signatures from the same shared wallet';
  for(const [index,page]of pages.entries()){
    await page.getByRole('button',{name:'Verifica accesso con firma',exact:false}).click();
    await expect(page.locator('.admin-team [role="status"]')).toContainText('Firma verificata dal wallet condiviso',{timeout:60000});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`artifacts/shared-admin-${index?'operator':'owner'}.png`,fullPage:true});
  }
  passed();
  stage='shared admin transaction review and reload recovery (controlled reads and no broadcasts)';
  const requestId='d'.repeat(64);let sends=0,settled=false;
  await owner.route('**/api/contract?**',route=>route.fulfill({json:adminChainFixture(address,200,true).snapshot}));
  await owner.route('**/api/admin/contract/prepare',route=>route.fulfill({json:{id:requestId,address,action:'setTicketPrice',args:['1500000'],stage:'prepared',expiresAt:Date.now()+300000,
    transaction:{to:'0x0000000000000000000000000000000000000099',data:'0x12345678',chainId:8453,gasMode:'usdc'}}}));
  await owner.route('**/api/admin/contract/send',async route=>{sends++;expect(route.request().postDataJSON()).toEqual({id:requestId,confirm:true});await route.abort('failed');});
  await owner.route('**/api/admin/contract/status?**',route=>route.fulfill({json:{stage:settled?'confirmed':'confirming',gasToken:'ETH',hash:null}}));
  await owner.getByRole('button',{name:'Operazioni',exact:false}).click();
  await expect(owner.getByLabel('Cosa vuoi fare?')).toBeVisible({timeout:20000});
  await owner.getByLabel('Cosa vuoi fare?').selectOption('setTicketPrice');
  await owner.getByLabel('Prezzo in unità USDC (1 USDC = 1000000)').fill('1500000');
  await owner.getByRole('button',{name:'Simula e conferma con Privy',exact:false}).click();
  await expect(owner.getByRole('dialog')).toContainText('Commissioni in USDC, con fallback ETH.');
  await owner.getByRole('button',{name:'Conferma dal mio wallet',exact:false}).click();
  await expect(owner.getByRole('button',{name:'Verifica',exact:true})).toBeEnabled();expect(sends).toBe(1);
  await owner.reload();await expect(owner.locator('.admin-shell')).toBeVisible({timeout:60000});
  await owner.getByRole('button',{name:'Verifica',exact:true}).click();
  await expect(owner.locator('.admin-feedback').filter({hasText:'Richiesta in verifica'})).toContainText('ETH');settled=true;
  await expect(owner.getByRole('button',{name:'Verifica',exact:true})).toHaveCount(0,{timeout:10000});expect(sends).toBe(1);
  expect(await owner.evaluate(({id,address})=>sessionStorage.getItem('slot-contract-tx:admin:'+id+':'+address.toLowerCase()),{id:ids[0],address})).toBeNull();
  await owner.unroute('**/api/contract?**');await owner.getByRole('button',{name:'Wallet admin',exact:false}).click();passed();
  stage='wallet and collaborator survive service restart; shared treasury is excluded from player pairing';
  service=createAdminService(client,ids[0],()=>null,externalId);handle=createAdminHandler({service,walletService:wallets,origin,readBalance});
  await operator.reload();await expect(operator.locator('.admin-shell')).toBeVisible({timeout:60000});
  await operator.getByRole('button',{name:'Wallet admin',exact:false}).click();await expect(operator.locator('.account-details code')).toHaveText(address);
  for(const page of pages){
    await page.route('**/api/shared-test-personal',async route=>{
      const response=await personal(new Request(origin+'/api/account',{headers:route.request().headers()}));
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
    });
    // Reuse only the request authorization inside the test harness; never expose it.
    const request=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/admin/account');
    await page.getByRole('button',{name:'Aggiorna saldo',exact:false}).click();
    const authorized=await request;
    const personalResponse=await personal(new Request(origin+'/api/account',{headers:authorized.headers()}));
    expect((await personalResponse.json()).wallet?.address).not.toBe(address);
  }
  passed();
  stage='revocation removes shared wallet access for the collaborator';
  await owner.getByRole('button',{name:'Rimuovi accesso',exact:true}).click();
  await owner.getByRole('button',{name:'Conferma revoca',exact:true}).click();
  await expect(owner.locator('.team-members')).toHaveCount(0,{timeout:60000});
  await operator.reload();await expect(operator.locator('.admin-account-code code')).toHaveText(ids[1],{timeout:60000});
  await expect(operator.locator('.admin-shell')).toHaveCount(0);
  await expect(async()=>{await service.resolve({userId:ids[1],wallets:[]});}).rejects.toThrow();passed();
  for(const page of pages)await page.getByRole('button',{name:'Esci dall’account',exact:false}).click();
  evidence.passed=true;
}catch(error){
  evidence.failedStage=stage;console.log(JSON.stringify({failedStage:stage,errorType:error instanceof Error?error.name:'Unknown'}));
  // Assertion text has UI selectors and notices only; provider request payloads are never printed.
  if(error instanceof Error&&error.name==='Error')console.log(error.message.slice(0,1000).replace(/Bearer\s+[^\s]+/g,'Bearer [redacted]'));
  for(const [index,context]of browser.contexts().entries())await context.pages()[0]?.screenshot({path:`artifacts/shared-admin-failed-${index}.png`,fullPage:true}).catch(()=>{});
  process.exitCode=1;
}finally{await writeFile('artifacts/live-shared-admin-check.json',JSON.stringify(evidence,null,2));await browser.close();}

}
void main().catch(()=>{console.log('Shared admin check could not initialize.');process.exitCode=1;});
