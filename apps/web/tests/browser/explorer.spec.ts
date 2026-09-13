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
  await fixture(page);await page.goto('/');await expect(page.locator('#pair-code')).not.toHaveText('— — —');
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
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  await page.getByRole('button',{name:'Game Explorer ↗',exact:true}).click();
  await expect(page.frameLocator('iframe[title="Game archive workspace"]').locator('#spins')).toHaveText('26');
  await expect(page.getByText('Loading the archive…')).toBeHidden();
  await page.getByRole('button',{name:'Back to activity'}).click();
  await page.getByRole('button',{name:'My summary ↗'}).click();
  const frame=page.frameLocator('iframe[title="Game archive workspace"]');await expect(frame.locator('#result-title')).toHaveText('Your record.');expect(requests.at(-1)?.get('player')).toBe(player);
  await frame.locator('#explore-tab').focus();await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Back to activity'})).toBeFocused();await page.keyboard.press('Tab');await expect(frame.locator('#explore-tab')).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Game Explorer and summary'})).toBeHidden();
});


test('production headers permit only same-origin archive embedding',async({request})=>{
 const archive=await request.get('/terminal/explorer.html');
 expect(archive.headers()['x-frame-options']).toBe('SAMEORIGIN');
 expect(archive.headers()['content-security-policy']).toBe("frame-ancestors 'self'");
 const terminal=await request.get('/');
 expect(terminal.headers()['content-security-policy']).toContain("frame-src 'self'");
 for(const path of ['/','/phone-fixture','/ownership-fixture'])expect((await request.get(path)).headers()['x-frame-options']).toBe('DENY');
});

test('a blocked iframe offers recovery instead of a blank archive',async({page})=>{
 await page.clock.install();
 await page.route('**/terminal/explorer.html',route=>route.fulfill({contentType:'text/html',headers:{'X-Frame-Options':'DENY'},body:'<!doctype html><p>Blocked</p>'}));
 await page.goto('/phone-fixture');await page.getByRole('button',{name:'Activity',exact:true}).click();
 await page.getByRole('button',{name:'Game Explorer ↗',exact:true}).click();
 await page.clock.fastForward(13000);
 await expect(page.getByRole('alert')).toContainText('The archive could not open');
 await expect(page.getByRole('link',{name:'Open archive'})).toHaveAttribute('href',/view=explore/);
 await page.unroute('**/terminal/explorer.html');await fixture(page);
 await page.getByRole('button',{name:'Retry archive'}).click();
 await expect(page.frameLocator('iframe[title="Game archive workspace"]').locator('#spins')).toHaveText('26');
 await expect(page.getByText('The archive could not open.',{exact:false})).toBeHidden();
});

test('iPad archive, summary and receipt scroll within the frame while Back stays visible',async({page})=>{
  await page.route('**/api/explorer?*',route=>{
    const params=new URL(route.request().url()).searchParams;
    const data=result(params);
    if(!params.has('game'))data.rows=Array.from({length:25},(_,i)=>({...row,gameId:String(25-i),symbols:null}));
    return route.fulfill({json:data});
  });
  await page.setViewportSize({width:1024,height:650});await page.goto('/');
  await expect(page.locator('#pair-code')).not.toHaveText('— — —');
  await page.evaluate(address=>window.dispatchEvent(new CustomEvent('slot-session',{detail:{address,state:'active'}})),player);
  await page.getByRole('button',{name:'Game Explorer',exact:true}).click();
  const workspace=page.frameLocator('#explorer-frame'),archive=workspace.locator('.archive');
  await expect(workspace.locator('.ledger-row')).toHaveCount(25);
  for(const mode of ['Game Explorer','My summary']){
    await workspace.getByRole('button',{name:mode}).click();
    await expect(workspace.locator('.ledger-row')).toHaveCount(25);
    const bounds=await archive.evaluate(node=>({height:node.clientHeight,content:node.scrollHeight,viewport:window.innerHeight,document:document.documentElement.scrollHeight}));
    expect(bounds.height).toBeGreaterThan(0);expect(bounds.height).toBeLessThanOrEqual(bounds.viewport);
    expect(bounds.content).toBeGreaterThan(bounds.height);expect(bounds.document).toBeLessThanOrEqual(bounds.viewport);
    await archive.evaluate(node=>{node.scrollTop=node.scrollHeight;});
    await expect(workspace.locator('#next')).toBeInViewport();
    await expect(page.getByRole('button',{name:'Back to slot'})).toBeInViewport();
    await workspace.getByRole('button',{name:'View spin 1',exact:true}).click();
    await expect(workspace.locator('#grid img')).toHaveCount(15);
    const receipt=workspace.locator('.receipt');
    await receipt.evaluate(node=>{node.scrollTop=node.scrollHeight;});
    expect(await receipt.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
    await expect(workspace.locator('#receipt-link')).toBeInViewport();
    await workspace.getByRole('button',{name:'Close ×'}).click();
    await expect(workspace.getByRole('button',{name:'View spin 1',exact:true})).toBeFocused();
  }
  await page.getByRole('button',{name:'Back to slot'}).click();
  await expect(page.locator('#explorer-dialog')).toBeHidden();
});

test('iPad touch swipes scroll the embedded archive in both directions',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Native touch injection uses the Chromium DevTools protocol.');
  await fixture(page);await page.setViewportSize({width:1024,height:650});await page.goto('/');
  await page.getByRole('button',{name:'Game Explorer',exact:true}).click();
  const workspace=page.frameLocator('#explorer-frame'),archive=workspace.locator('.archive');
  await expect(workspace.locator('#spins')).toHaveText('26');
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  async function swipe(from:number,to:number){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:500,y:from}]});
    for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:500,y:from+(to-from)*i/10}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  await swipe(570,180);
  await expect.poll(()=>archive.evaluate(node=>node.scrollTop)).toBeGreaterThan(100);
  await expect(page.getByRole('button',{name:'Back to slot'})).toBeInViewport();
  await swipe(180,570);
  await expect.poll(()=>archive.evaluate(node=>node.scrollTop)).toBeLessThan(100);
  await cdp.detach();
});
