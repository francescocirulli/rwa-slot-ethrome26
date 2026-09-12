import {test,expect} from '@playwright/test';
test('admin compares both balances, selects ERC1155 quantity and mint destination, and sees ownership limits',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1280,height:900});await page.goto('/inventory-fixture');
  const gadget=page.locator('.collectible-card').filter({has:page.getByRole('heading',{name:'Hopera',exact:true})});
  await expect(gadget).toContainText('Shared wallet');await expect(gadget).toContainText('7 NFT');await expect(gadget).toContainText('10 NFT');await expect(gadget).toContainText('Reserved for spins');
  await gadget.getByRole('button',{name:'Deposit NFT'}).click();
  const form=page.getByRole('region',{name:'Prepare deposit or mint'});
  await expect(form).toContainText('7 NFT');await expect(form).toContainText('10 NFT');
  await form.getByRole('textbox',{name:'NFT quantity'}).fill('8');await form.getByRole('button',{name:'Simulate and confirm deposit'}).click();
  await expect(page.getByRole('alert')).toContainText('NFT balance is not enough');await expect(page.getByTestId('submitted')).toBeEmpty();
  await form.getByRole('textbox',{name:'NFT quantity'}).fill('3');await form.getByRole('button',{name:'Simulate and confirm deposit'}).click();
  await expect(page.getByTestId('submitted')).toContainText('fundERC1155');await expect(page.getByTestId('submitted')).toContainText('"1","3"');
  await gadget.getByRole('button',{name:'Mint NFT'}).click();await form.getByRole('textbox',{name:'NFT quantity'}).fill('12');await form.getByRole('combobox',{name:'Destination'}).selectOption('slot');
  await page.screenshot({path:'artifacts/admin-inventory-mint.png',fullPage:true});
  await form.getByRole('button',{name:'Simulate and confirm mint'}).click();await expect(page.getByTestId('submitted')).toContainText('mintERC1155');await expect(page.getByTestId('submitted')).toContainText('"1","12","slot"');
  await page.getByRole('button',{name:'Toggle owner'}).click();await expect(gadget.getByRole('button',{name:'Mint NFT'})).toBeDisabled();
  await expect(page.getByText('Minting requires the shared wallet', {exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Accept collection ownership with Privy'})).toBeVisible();
  await page.setViewportSize({width:1024,height:768});await page.screenshot({path:'artifacts/admin-inventory-owner.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);expect(errors).toEqual([]);
});

for(const [name,id] of [['Books','6'],['Water Bottle','7'],['Caps','8']])test('admin deposits and mints '+name+' using its collection ID',async({page})=>{
  await page.goto('/inventory-fixture');
  const card=page.locator('.collectible-card').filter({has:page.getByRole('heading',{name,exact:true})});
  await expect(card).toContainText('7 NFT');await expect(card).toContainText('10 NFT');
  expect(await card.locator('img').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
  await card.getByRole('button',{name:'Deposit NFT'}).click();
  const form=page.getByRole('region',{name:'Prepare deposit or mint'});
  await form.getByRole('textbox',{name:'NFT quantity'}).fill('3');await form.getByRole('button',{name:'Simulate and confirm deposit'}).click();
  await expect(page.getByTestId('submitted')).toContainText('"'+id+'","3"');
  await card.getByRole('button',{name:'Mint NFT'}).click();await form.getByRole('textbox',{name:'NFT quantity'}).fill('4');await form.getByRole('combobox',{name:'Destination'}).selectOption('slot');
  await form.getByRole('button',{name:'Simulate and confirm mint'}).click();
  await expect(page.getByTestId('submitted')).toContainText('mintERC1155');await expect(page.getByTestId('submitted')).toContainText('"'+id+'","4","slot"');
});
