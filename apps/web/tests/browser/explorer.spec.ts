import {test,expect,type Page} from '@playwright/test';
const player='0x0000000000000000000000000000000000000011';
const tx='0x'+'a'.repeat(64);
const row={gameId:'17',player,playedAt:1789250000,won:true,points:100,matches:5,symbol:2,prize:1,transactionHash:tx,symbols:Array(15).fill(2)};
function result(params:URLSearchParams){return {snapshot:'370999',season:'1',from:1789240000,timestamp:1789250010,historyDays:30,indexing:false,summary:{spins:26,wins:20,points:1300,winRate:76.9,three:10,five:10,losses:6,symbols:[{symbol:2,wins:12},{symbol:5,wins:8}]},total:26,page:Number(params.get('page')||0),pageSize:25,rows:[{...row,gameId:params.get('page')==='1'?'1':'17',symbols:params.get('game')?row.symbols:null}]};}
async function fixture(page:Page){
  const requests:URLSearchParams[]=[];
  await page.route('**/api/explorer?*',route=>{const params=new URL(route.request().url()).searchParams;requests.push(params);return route.fulfill({json:result(params)});});
  return requests;
}
test('iPhone filters query the backend, receipt opens, pagination pins snapshot and summary includes all results',async({page})=>{
  const requests=await fixture(page);await page.setViewportSize({width:390,height:844});await page.goto('/terminal/explorer.html#player='+player);
  await expect(page.locator('#spins')).toHaveText('26');await expect(page.locator('#points')).toHaveText('1300');
  await page.getByLabel('Result',{exact:true}).selectOption('true');await page.getByLabel('Winning symbol').selectOption('2');await page.getByLabel('Time window').selectOption('week');await page.getByRole('button',{name:'Apply filters'}).click();
  await expect.poll(()=>requests.at(-1)?.get('symbol')).toBe('2');expect(requests.at(-1)?.get('won')).toBe('true');expect(requests.at(-1)?.get('period')).toBe('week');
  await page.getByRole('button',{name:'View spin 17'}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('#grid img')).toHaveCount(15);await expect(page.getByRole('link',{name:'View transaction'})).toHaveAttribute('href','https://basescan.org/tx/'+tx);
  await page.getByRole('button',{name:'Close ×'}).click();await page.getByRole('button',{name:'Next →'}).click();await expect(page.getByRole('button',{name:'View spin 1',exact:true})).toBeVisible();expect(requests.at(-1)?.get('snapshot')).toBe('370999');
  await page.getByRole('button',{name:'My summary'}).click();await expect(page.locator('#breakdown')).toBeVisible();expect(requests.at(-1)?.get('player')).toBe(player);expect(requests.at(-1)?.get('won')).toBeNull();await expect(page.locator('#points')).toHaveText('1300');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'/private/tmp/explorer-iphone.png',fullPage:true});
});
test('query failure clears stale results and missing wallet never shows everyone as personal summary',async({page})=>{
  await fixture(page);await page.goto('/terminal/explorer.html');await expect(page.locator('#results')).toBeVisible();
  await page.getByRole('button',{name:'My summary'}).click();await expect(page.locator('#results')).toBeHidden();await expect(page.getByRole('status').first()).toContainText('Connect your wallet');
  await page.getByRole('button',{name:'Game Explorer'}).click();await expect(page.locator('#results')).toBeVisible();
  await page.route('**/api/explorer?*',route=>route.fulfill({status:503,json:{error:'Archive unavailable'}}));await page.getByRole('button',{name:'Refresh'}).click();await expect(page.locator('#results')).toBeHidden();await expect(page.getByRole('status').first()).toHaveText('Archive unavailable');
});
test('iPad opens workspace with paired wallet and clears it when session ends',async({page})=>{
  await fixture(page);await page.goto('/terminal/index.html');await expect(page.locator('#pair-code')).not.toHaveText('— — —');
  await page.evaluate(address=>{window.dispatchEvent(new CustomEvent('slot-session',{detail:{address,state:'active'}}));},player);
  await page.getByRole('button',{name:'Game Explorer',exact:true}).click();const workspace=page.frameLocator('#explorer-frame');await expect(workspace.locator('#spins')).toHaveText('26');
  await workspace.getByRole('button',{name:'My summary'}).click();await expect(workspace.locator('#breakdown')).toBeVisible();
  await page.screenshot({path:'/private/tmp/explorer-ipad.png',fullPage:true});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('slot-session',{detail:null})));await expect(page.locator('#explorer-dialog')).toBeHidden();await expect(page.locator('#explorer-frame')).not.toHaveAttribute('src',/.+/);
});
test('phone launchers open the same explorer with the authenticated wallet',async({page})=>{
  const requests=await fixture(page);
  await page.route('**/api/account',route=>route.fulfill({json:{userId:'fixture-user',wallet:{address:player,balance:{amount:'0',stale:false,updatedAt:Date.now()},portfolio:null}}}));
  await page.route('**/api/account/welcome',route=>route.fulfill({json:{status:'granted',amount:'2'}}));
  await page.route('**/api/relay/**',route=>route.fulfill({status:401,json:{error:'No session'}}));
  await page.setViewportSize({width:390,height:844});await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();await expect(page.getByLabel('Wallet address',{exact:true})).toHaveText(player);
  await page.getByRole('button',{name:'Activity',exact:true}).click();await page.getByRole('button',{name:'My summary ↗'}).click();
  const frame=page.frameLocator('iframe[title="Game archive workspace"]');await expect(frame.locator('#result-title')).toHaveText('Your record.');expect(requests.at(-1)?.get('player')).toBe(player);
  await frame.locator('#explore-tab').focus();await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Back to activity'})).toBeFocused();await page.keyboard.press('Tab');await expect(frame.locator('#explore-tab')).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Game Explorer and summary'})).toBeHidden();
});
