import {test,expect} from '@playwright/test';
const address='0x0000000000000000000000000000000000000011';
const claimId='0x'+'1'.repeat(64);
test.use({viewport:{width:390,height:844}});
test('iPhone redeems one voucher with review and resumes Sepolia registration after finality',async({page})=>{
 let stage='empty',sends=0,completions=0;
 await page.route('**/api/account',route=>route.fulfill({json:{userId:'fixture-user',wallet:{address,depositQr:'',balance:{amount:'10',stale:false},portfolio:{address,chainId:8453,contract:address,eth:'0',allowance:'0',freeSpins:'0',ticketPrice:'50000',gasMode:'usdc',gameId:null,busy:false,canTransact:true,assets:[],nfts:[]}}}}));
 await page.route('**/api/ens*',async route=>{
  const request=route.request();const body=request.method()==='POST'?request.postDataJSON():{};
  const claim={id:claimId,label:'frank',name:'frank.wallstreetslot.eth',owner:address,resolver:address,completed:stage==='registered',stage};
  if(request.url().includes('?label='))return route.fulfill({json:{name:'frank.wallstreetslot.eth',available:true}});
  if(body.action==='reserve'){stage='voucher';return route.fulfill({json:{...claim,stage}});}
  if(body.action==='prepare')return route.fulfill({json:{id:'review-1',claimId,name:claim.name,address,quantity:1,registrationPayer:'backend',gasMode:'usdc',expires:Date.now()+90000}});
  if(body.action==='send'){expect(body.confirm).toBe(true);expect(request.headers()['x-fixture-privy']).toBe('1');sends++;stage='finalizing-base';return route.fulfill({json:{stage:'submitted'}});}
  if(body.action==='status')return route.fulfill({json:{stage:'submitted',claim}});
  if(body.action==='complete'){completions++;stage='registered';return route.fulfill({json:{...claim,completed:true,stage}});}

  return route.fulfill({json:{configured:true,claims:stage==='empty'?[]:[claim],names:stage==='registered'?[{name:claim.name,owner:address,resolvedAddress:address,expiry:'1900000000'}]:[]}});
 });
 await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await page.getByLabel('Choose your name').fill('frank');await page.getByRole('button',{name:'Continue',exact:true}).click();
 const review=page.getByRole('dialog',{name:'Confirm ENS voucher redemption'});
 await expect(review).toContainText('1 ENS Registration voucher');await expect(review).toContainText('We cover all Sepolia fees.');
 await expect(review.getByText('ETH',{exact:true})).toHaveCount(0);expect(sends).toBe(0);
 await page.getByRole('button',{name:'Confirm redemption',exact:true}).click();
 await expect(page.getByText('Base: voucher transferred to the dead address.',{exact:false})).toBeVisible();expect(sends).toBe(1);
 await expect(page.getByText('Sepolia: waiting for Base finality. Registration has not started.')).toBeVisible();
 await expect(page.getByText('Checking your voucher transfer on Base.',{exact:false})).toHaveCount(0);
 await page.reload();await page.getByRole('button',{name:'Wallet',exact:true}).click();await expect(page.getByText('Base: voucher transferred to the dead address.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Continue',exact:true})).toHaveCount(0);
 stage='ready';
 await expect(page.getByText('Sepolia: Base transfer finalized. Registration is pending.',{exact:true})).toBeVisible({timeout:12000});
 await expect(page.getByRole('button',{name:'Copy name'})).toHaveCount(0);
 stage='registered';completions++;
 await expect(page.getByRole('button',{name:'Copy name'})).toBeVisible({timeout:12000});expect(sends).toBe(1);expect(completions).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('RPC failure is not displayed as an empty ENS balance or success',async({page})=>{
 await page.route('**/api/account',route=>route.fulfill({json:{userId:'fixture-user',wallet:{address,depositQr:'',balance:{amount:'10',stale:false},portfolio:null}}}));
 await page.route('**/api/ens*',route=>route.fulfill({status:503,json:{error:'RPC unavailable'}}));
 await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();await expect(page.getByText('Sepolia names could not be refreshed. Any names shown are from the last successful read.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Copy name'})).toHaveCount(0);
});

async function recoveryFixture(page:import('@playwright/test').Page, failure:'prepare'|'failed'|'uncertain'){
 let attempts=0,prepares=0;
 const claim={id:claimId,label:'frank',name:'frank.wallstreetslot.eth',owner:address,resolver:address,completed:false,stage:'voucher'};
 await page.route('**/api/account',route=>route.fulfill({json:{userId:'fixture-user',wallet:{address,depositQr:'',balance:{amount:'10',stale:false},portfolio:null}}}));
 await page.route('**/api/relay/**',route=>route.fulfill({status:401,json:{error:'No iPad linked'}}));
 await page.route('**/api/ens*',route=>{
  const body=route.request().method()==='POST'?route.request().postDataJSON():{};
  if(body.action==='prepare'){
   prepares++;
   if(failure==='prepare'&&prepares===1)return route.fulfill({status:503,json:{error:'Voucher checks are temporarily unavailable. This request did not submit a transfer. Refresh ENS, then Continue.',code:'EnsPrepareUnavailable'}});
   return route.fulfill({json:{id:'review-'+prepares,claimId,name:claim.name,address,quantity:1,registrationPayer:'backend',gasMode:'usdc',expires:Date.now()+90000}});
  }
  if(body.action==='send'){attempts++;return route.fulfill({status:503,json:{error:failure==='failed'?'Voucher checks failed before sending.':'Send cannot be verified.',code:'EnsSendUnavailable',stage:failure}});}
  if(body.action==='status')return route.fulfill({json:{stage:failure,claim}});
  return route.fulfill({json:{configured:true,claims:[claim],names:[]}});
 });
 await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
 return ()=>({attempts,prepares});
}

test('Continue can recover a failed preflight without reserving again or submitting a voucher',async({page})=>{
 const counts=await recoveryFixture(page,'prepare');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'did not submit a transfer'})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'Confirm ENS voucher redemption'})).toBeHidden();
 expect(counts().attempts).toBe(0);
 await page.getByRole('button',{name:'Refresh ENS'}).click();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Confirm ENS voucher redemption'})).toBeVisible();
 expect(counts()).toEqual({attempts:0,prepares:2});
});

for(const failure of ['failed','uncertain'] as const)test(`ENS ${failure} submission preserves the correct retry behavior after reload`,async({page})=>{
 const counts=await recoveryFixture(page,failure);
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Confirm redemption',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:failure==='failed'?'before sending':'cannot be verified'})).toBeVisible();
 expect(counts().attempts).toBe(1);
 await page.reload();await page.getByRole('button',{name:'Wallet',exact:true}).click();
 if(failure==='failed'){
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeVisible();
  await expect(page.getByText('Checking your voucher transfer on Base.',{exact:false})).toBeHidden();
 }else{
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeHidden();
  await expect(page.getByText('Checking your voucher transfer on Base.',{exact:false})).toBeVisible();
 }
 expect(counts().attempts).toBe(1);
});

test('ENS preserves a verified retry after a balance rejection and page reload',async({page})=>{
 const counts=await recoveryFixture(page,'failed');let prepares=0,sends=0;
 const retryToken='2.'+'R'.repeat(43);
 await page.route('**/api/ens*',async(route)=>{
  const body=route.request().method()==='POST'?route.request().postDataJSON():{};
  if(body.action==='prepare'){
   prepares++;if(prepares===2)expect(body.retryToken).toBe(retryToken);
   return route.fulfill({json:{id:'funded-review-'+prepares,claimId,name:'frank.wallstreetslot.eth',address,quantity:1,registrationPayer:'backend',gasMode:'usdc',expires:Date.now()+90000}});
  }
  if(body.action==='send'){
   sends++;
   return route.fulfill(sends===1?{status:503,json:{error:'Insufficient USDC balance.',stage:'failed',retryToken}}:{json:{stage:'submitted'}});
  }
  return route.fallback();
 });
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Confirm redemption',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'Insufficient USDC'})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Confirm redemption',exact:true}).click();
 await expect(page.getByText('Checking your voucher transfer on Base.',{exact:false})).toBeVisible();
 expect(prepares).toBe(2);expect(sends).toBe(2);expect(counts().attempts).toBe(0);
});

for(const failure of ['slow','unavailable'] as const)test(`Sepolia names remain visible when claim checks are ${failure}`,async({page})=>{
 await page.route('**/api/account',route=>route.fulfill({json:{userId:'fixture-user',wallet:{address,depositQr:'',balance:{amount:'10',stale:false},portfolio:null}}}));
 let release:()=>void=()=>{};
 const waiting=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/ens*',async route=>{
  if(new URL(route.request().url()).searchParams.get('view')==='names')return route.fulfill({json:{configured:true,names:[{name:'frank.wallstreetslot.eth',owner:address,resolvedAddress:address,expiry:'1900000000'}]}});
  if(failure==='slow')await waiting;
  return route.fulfill({status:503,json:{error:'Claim checks unavailable'}});
 });
 try{
  await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByRole('button',{name:'Copy name'})).toBeVisible();
  await expect(page.getByText('Registered on Sepolia · Owned by your wallet',{exact:false})).toBeVisible();
  await expect(page.getByLabel('Choose your name')).toHaveCount(0);
  if(failure==='unavailable')await expect(page.getByRole('alert').filter({hasText:'Claim progress could not be refreshed'})).toBeVisible();
 }finally{release();}
});

test('a missing Base proof after finality waiting never prompts another voucher transfer',async({page})=>{
 const counts=await recoveryFixture(page,'uncertain');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Confirm redemption',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'cannot be verified'})).toBeVisible();
 let stage='finalizing-base';
 await page.route('**/api/ens?view=claims',route=>route.fulfill({json:{configured:true,claims:[{id:claimId,label:'frank',name:'frank.wallstreetslot.eth',owner:address,resolver:address,completed:false,stage}]}}));
 await page.getByRole('button',{name:'Refresh ENS'}).click();
 await expect(page.getByText('Sepolia: waiting for Base finality. Registration has not started.')).toBeVisible();
 stage='voucher';await page.getByRole('button',{name:'Refresh ENS'}).click();
 await expect(page.getByText('Checking your voucher transfer on Base.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Continue',exact:true})).toHaveCount(0);
 expect(counts().attempts).toBe(1);
});


test('a Sepolia completion refreshes ownership when the parallel name read preceded the mint',async({page})=>{
 await page.route('**/api/account',route=>route.fulfill({json:{userId:'fixture-user',wallet:{address,depositQr:'',balance:{amount:'10',stale:false},portfolio:null}}}));
 let names=0;
 await page.route('**/api/ens*',route=>{
  if(new URL(route.request().url()).searchParams.get('view')==='names'){
   names++;return route.fulfill({json:{configured:true,names:names===1?[]:[{name:'frank.wallstreetslot.eth',owner:address,resolvedAddress:address,expiry:'1900000000'}]}});
  }
  return route.fulfill({json:{configured:true,claims:[{id:claimId,label:'frank',name:'frank.wallstreetslot.eth',owner:address,resolver:address,completed:true,stage:'registered'}]}});
 });
 await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await expect(page.getByRole('button',{name:'Copy name'})).toBeVisible();expect(names).toBe(2);
});

test('registered ENS cards keep names, details and actions readable on narrow phones',async({page})=>{
 const names=['frank.wallstreetslot.eth','a'.repeat(32)+'.wallstreetslot.eth'];
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as any).copiedEnsName=text;}}});});
 await page.route('**/api/account',route=>route.fulfill({json:{userId:'fixture-user',wallet:{address,balance:{amount:'10',stale:false},portfolio:null}}}));
 await page.route('**/api/ens*',route=>route.fulfill({json:{configured:true,namesState:'ready',claims:[],names:names.map(name=>({name,owner:address,resolvedAddress:address,expiry:'1900000000'}))}}));
 await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
 const cards=page.getByRole('region',{name:'ENS names on Sepolia'}).locator('.ready-card');
 await expect(cards).toHaveCount(2);
 for(const width of [320,390,430]){
  await page.setViewportSize({width,height:844});
  for(let i=0;i<names.length;i++){
   const card=cards.nth(i),name=card.locator('b'),details=card.locator('p'),copy=card.getByRole('button',{name:'Copy name'}),explorer=card.getByRole('link',{name:'ENS Explorer'});
   await expect(name).toHaveText(names[i]);
   const titleBox=(await name.boundingBox())!,detailsBox=(await details.boundingBox())!,copyBox=(await copy.boundingBox())!,linkBox=(await explorer.boundingBox())!;
   expect(detailsBox.y).toBeGreaterThanOrEqual(titleBox.y+titleBox.height);
   expect(copyBox.y).toBeGreaterThanOrEqual(detailsBox.y+detailsBox.height);
   expect(linkBox.y).toBeGreaterThanOrEqual(detailsBox.y+detailsBox.height);
   for(const control of [copy,explorer]){
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const lines=await control.evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getClientRects().length;});
    expect(lines).toBe(1);
   }
   expect(await card.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
   await copy.click();expect(await page.evaluate(()=>(window as any).copiedEnsName)).toBe(names[i]);
   await expect(explorer).toHaveAttribute('href','https://explorer.ens.dev/'+names[i]);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:390,height:844});
 await cards.first().screenshot({path:'/private/tmp/ens-name-card-fixed.png'});
});
