import {test,expect,type Page} from '@playwright/test';
async function signSequence(page:Page){
  const sign=page.getByRole('button',{name:'Firma con Privy'});
  await expect(page.getByRole('dialog')).toContainText('Autorizza USDC');await sign.click();
  await expect(page.getByRole('dialog')).toContainText('Acquista NVDAc',{timeout:15000});await sign.click();
}
test('one start sequences approval, purchase and deposits; refreshes confirmed reserves and enables another top-up',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const sends:string[]=[];page.on('request',request=>{if(request.url().endsWith('/execute'))sends.push(request.postData()!);});
  await page.goto('/quick-fund-fixture');
  const button=page.getByRole('button',{name:/Aggiungi 1 turno/});await button.click();
  await signSequence(page);
  await expect(page.getByTestId('submitted')).toContainText('"10000000000"',{timeout:20000});
  await expect(page.getByTestId('submitted')).toContainText('"5000000000"');
  await expect(page.locator('.quick-fund-card [role=status]')).toContainText('Rifornimento completato');
  await expect(button).toBeEnabled();expect(sends).toHaveLength(2);expect(errors).toEqual([]);await expect(page.locator('.swap-status')).toHaveCount(0);
  await page.screenshot({path:'artifacts/admin-quick-fund.png',fullPage:true});
});
test('cancelling a funding signature submits no swap or deposit',async({page})=>{
  let sends=0;page.on('request',request=>{if(request.url().endsWith('/execute'))sends++;});
  await page.goto('/quick-fund-fixture');await page.getByRole('button',{name:/Aggiungi 1 turno/}).click();
  await page.getByRole('button',{name:'Interrompi',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Operation cancelled.');expect(sends).toBe(0);await expect(page.getByTestId('submitted')).toBeEmpty();
});
test('delayed balances and a transient inventory failure recover without refresh or another purchase',async({page})=>{
  let sends=0,failed=false,reads=0;
  page.on('request',r=>{if(r.url().endsWith('/execute'))sends++;});
  await page.route('**/api/admin/assets/inventory*',async route=>{reads++;if(sends===2&&!failed){failed=true;await route.fulfill({status:503,json:{error:'RPC unavailable'}});}else await route.continue();});
  await page.goto('/quick-fund-fixture?scenario=lag');await page.getByRole('button',{name:/Aggiungi 1 turno/}).click();await signSequence(page);
  await expect(page.locator('.quick-fund-card [role=status]')).toContainText('Rifornimento completato',{timeout:25000});
  expect(failed).toBe(true);expect(sends).toBe(2);expect(reads).toBeLessThanOrEqual(8);
});
test('small prize sizes reduce the one-USDC probe before requesting a signature',async({page})=>{
  await page.goto('/quick-fund-fixture?scenario=tiny');await page.getByRole('button',{name:/Aggiungi 1 turno/}).click();
  await expect(page.getByRole('dialog')).toContainText('0.000012 USDC');
  await page.getByRole('button',{name:'Interrompi',exact:true}).click();
});
test('an ambiguous send is never automatically repeated',async({page})=>{
  let sends=0;
  await page.route('**/api/admin/assets/execute',async route=>{sends++;await route.fulfill({status:503,json:{error:'Response lost'}});});
  await page.goto('/quick-fund-fixture');await page.getByRole('button',{name:/Aggiungi 1 turno/}).click();await page.getByRole('button',{name:'Firma con Privy'}).click();
  await expect(page.getByRole('alert')).toContainText('Response lost');
  await expect(page.getByRole('button',{name:/Riprendi rifornimento/})).toBeDisabled();expect(sends).toBe(1);await expect(page.getByTestId('submitted')).toBeEmpty();
});

test('an expired quote refreshes inside the signature sequence without submitting the old quote',async({page})=>{
  let quotes=0,sends=0;
  page.on('request',r=>{if(r.url().endsWith('/execute'))sends++;});
  await page.route('**/api/admin/assets/quote',async route=>{quotes++;const response=await route.fetch();const value=await response.json();if(quotes<=2)value.expiresAt=Date.now()-1;await route.fulfill({response,json:value});});
  await page.goto('/quick-fund-fixture');await page.getByRole('button',{name:/Aggiungi 1 turno/}).click();
  await page.getByRole('button',{name:'Firma con Privy'}).click();
  await expect(page.getByRole('dialog')).toContainText('Autorizza USDC');expect(sends).toBe(0);expect(quotes).toBe(3);
  await page.getByRole('button',{name:'Interrompi',exact:true}).click();
});
test('restarting an interrupted sequence skips the deposit already confirmed',async({page})=>{
  let reject=true,swaps=0;
  page.on('request',r=>{if(r.url().endsWith('/execute'))swaps++;});
  await page.route('**/fixture/deposit',async route=>{const body=route.request().postDataJSON();if(reject&&body.args[1]==='5000000000'){reject=false;await route.fulfill({status:409,body:'Deposit rejected'});}else await route.continue();});
  await page.goto('/quick-fund-fixture');await page.getByRole('button',{name:/Aggiungi 1 turno/}).click();await signSequence(page);
  await expect(page.getByRole('alert')).toContainText('Deposit failed',{timeout:15000});
  await page.getByRole('button',{name:/Riprendi rifornimento/}).click();
  await expect(page.locator('.quick-fund-card [role=status]')).toContainText('Rifornimento completato');
  expect(swaps).toBe(2);expect((await page.getByTestId('submitted').textContent())?.match(/fundERC20/g)).toHaveLength(2);
});

test('an editable count adds multiple rounds to stocked reserves and can be used repeatedly',async({page})=>{
  let writes=0;page.on('request',request=>{if(request.url().endsWith('/fixture/deposit'))writes++;});
  await page.goto('/quick-fund-fixture?scenario=stocked');
  const input=page.getByRole('spinbutton',{name:'Turni da aggiungere'});
  await input.fill('');await expect(input).toHaveValue('');await expect(page.getByRole('button',{name:/Aggiungi/})).toBeDisabled();
  for(const invalid of ['0','100','1.5']){await input.fill(invalid);await expect(input).toHaveAttribute('aria-invalid','true');await expect(page.getByRole('button',{name:/Aggiungi/})).toBeDisabled();}
  await input.fill('2');await page.getByRole('button',{name:/Aggiungi 2 turni/}).click();
  await expect(page.locator('.quick-fund-card [role=status]')).toContainText('2 turni aggiunti');
  await expect(page.getByTestId('submitted')).toContainText('"20000000000"');
  await expect(page.getByTestId('submitted')).toContainText('"10000000000"');expect(writes).toBe(2);
  await input.fill('1');await page.getByRole('button',{name:/Aggiungi 1 turno/}).click();
  await expect(page.locator('.quick-fund-card [role=status]')).toContainText('1 turno aggiunto');expect(writes).toBe(4);
  await expect(page.getByRole('button',{name:/Aggiungi 1 turno/})).toBeEnabled();
  await page.screenshot({path:'artifacts/admin-repeat-funding.png',fullPage:true});
});
test('reload resumes a partial top-up without increasing its frozen target',async({page})=>{
  let reject=true;const deposits:string[]=[];
  await page.route('**/fixture/deposit',async route=>{const {args}=route.request().postDataJSON();if(reject&&args[1]==='5000000000'){reject=false;return route.fulfill({status:409,body:'Deposit rejected'});}deposits.push(args[0]);await route.continue();});
  await page.goto('/quick-fund-fixture?scenario=stocked');await page.getByRole('button',{name:/Aggiungi 1 turno/}).click();
  await expect(page.getByRole('alert')).toContainText('Deposit failed');expect(deposits).toHaveLength(1);
  await page.goto('/quick-fund-fixture?resume=1');
  await expect(page.getByRole('spinbutton',{name:'Turni da aggiungere'})).toBeDisabled();
  await page.getByRole('button',{name:/Riprendi rifornimento/}).click();
  await expect(page.locator('.quick-fund-card [role=status]')).toContainText('Rifornimento completato');
  expect(deposits).toHaveLength(2);expect(new Set(deposits).size).toBe(2);
});
