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
  if(body.action==='prepare')return route.fulfill({json:{id:'review-1',claimId,name:claim.name,address,quantity:1,gasMode:'usdc',expires:Date.now()+90000}});
  if(body.action==='send'){expect(body.confirm).toBe(true);expect(request.headers()['x-fixture-privy']).toBe('1');sends++;stage='finalizing-base';return route.fulfill({json:{stage:'submitted'}});}
  if(body.action==='status')return route.fulfill({json:{stage:'submitted',claim}});
  if(body.action==='complete'){completions++;stage='registered';return route.fulfill({json:{...claim,completed:true,stage}});}
  return route.fulfill({json:{configured:true,claims:stage==='empty'?[]:[claim],names:stage==='registered'?[{name:claim.name,owner:address,resolvedAddress:address,expiry:'1900000000'}]:[]}});
 });
 await page.goto('/phone-fixture');
 await page.getByLabel('Choose your name').fill('frank');await page.getByRole('button',{name:'Check availability'}).click();
 await page.getByRole('button',{name:'Confirm name and reserve'}).click();
 await page.getByRole('button',{name:'Review voucher redemption'}).click();
 await expect(page.getByRole('dialog',{name:'Confirm ENS voucher redemption'})).toContainText('permanently locks');expect(sends).toBe(0);
 await page.getByRole('button',{name:'Confirm and authorize voucher'}).click();
 await expect(page.getByText('Voucher received.',{exact:false})).toBeVisible();expect(sends).toBe(1);
 await page.reload();await expect(page.getByText('Voucher received.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Review voucher redemption'})).toHaveCount(0);
 stage='ready';await page.getByRole('button',{name:'Refresh ENS'}).click();
 await page.getByRole('button',{name:'Register name · Free'}).click();
 await expect(page.getByRole('button',{name:'Copy name'})).toBeVisible();expect(sends).toBe(1);expect(completions).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('RPC failure is not displayed as an empty ENS balance or success',async({page})=>{
 await page.route('**/api/account',route=>route.fulfill({json:{userId:'fixture-user',wallet:{address,depositQr:'',balance:{amount:'10',stale:false},portfolio:null}}}));
 await page.route('**/api/ens*',route=>route.fulfill({status:503,json:{error:'RPC unavailable'}}));
 await page.goto('/phone-fixture');await expect(page.getByText('ENS is temporarily unavailable. Refresh to retry.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Copy name'})).toHaveCount(0);
});
