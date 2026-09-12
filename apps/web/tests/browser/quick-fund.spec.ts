import {test,expect} from '@playwright/test';
test('quick fund buys the missing RWA shortfall with USDC and deposits every prize',async({page})=>{
  page.on('dialog',dialog=>dialog.accept());
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1280,height:900});await page.goto('/quick-fund-fixture');
  await expect(page.locator('.quick-fund-table')).toContainText('NVDAc');
  const button=page.getByRole('button',{name:/Rifornisci 1 turno/});
  await expect(button).toBeEnabled();await button.click();
  await expect(page.getByTestId('submitted')).toContainText('"fundERC20"',{timeout:20000});
  await expect(page.getByTestId('submitted')).toContainText('"10000000000"');
  await expect(page.getByTestId('submitted')).toContainText('"5000000000"');
  await expect(page.locator('.quick-fund-table')).toContainText('Completato',{timeout:20000});
  expect(errors).toEqual([]);
  await page.screenshot({path:'artifacts/admin-quick-fund.png',fullPage:true});
});

test('quick funding cancelled at the price confirmation submits no swap or deposit',async({page})=>{
  let sends=0;page.on('request',request=>{if(request.url().endsWith('/execute'))sends++;});
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto('/quick-fund-fixture');
  await page.getByRole('button',{name:/Rifornisci 1 turno/}).click();
  await expect(page.getByRole('alert')).toContainText('Operation cancelled.');
  expect(sends).toBe(0);await expect(page.getByTestId('submitted')).toBeEmpty();
});
