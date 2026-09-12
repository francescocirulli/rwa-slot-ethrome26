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
  if(stage==='ready'){stage='registered';claim.stage=stage;claim.completed=true;completions++;}
  return route.fulfill({json:{configured:true,claims:stage==='empty'?[]:[claim],names:stage==='registered'?[{name:claim.name,owner:address,resolvedAddress:address,expiry:'1900000000'}]:[]}});
 });
 await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await page.getByLabel('Choose your name').fill('frank');await page.getByRole('button',{name:'Continue',exact:true}).click();
 const review=page.getByRole('dialog',{name:'Confirm ENS voucher redemption'});
 await expect(review).toContainText('1 ENS Registration voucher');await expect(review).toContainText('We cover all Sepolia fees.');
 await expect(review.getByText('ETH',{exact:true})).toHaveCount(0);expect(sends).toBe(0);
 await page.getByRole('button',{name:'Confirm redemption',exact:true}).click();
 await expect(page.getByText('Your voucher is confirmed.',{exact:false})).toBeVisible();expect(sends).toBe(1);
 await page.reload();await page.getByRole('button',{name:'Wallet',exact:true}).click();await expect(page.getByText('Your voucher is confirmed.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Continue',exact:true})).toHaveCount(0);
 stage='ready';
 await expect(page.getByRole('button',{name:'Copy name'})).toBeVisible({timeout:12000});expect(sends).toBe(1);expect(completions).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('RPC failure is not displayed as an empty ENS balance or success',async({page})=>{
 await page.route('**/api/account',route=>route.fulfill({json:{userId:'fixture-user',wallet:{address,depositQr:'',balance:{amount:'10',stale:false},portfolio:null}}}));
 await page.route('**/api/ens*',route=>route.fulfill({status:503,json:{error:'RPC unavailable'}}));
 await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();await expect(page.getByText('ENS is temporarily unavailable. Refresh to retry.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Copy name'})).toHaveCount(0);
});
