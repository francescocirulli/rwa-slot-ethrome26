import {test, expect, type Page, type BrowserContext, type Browser} from '@playwright/test';
import {pairingSecret} from '../fixtures';

async function link(page: Page, phone: BrowserContext) {
  await page.goto('/');
  await page.locator('#attract-wake').click();
  await expect(page.locator('#login-qr')).toBeVisible();
  const secret = pairingSecret((await page.locator('#login-qr').getAttribute('src'))!);
  const code = (await page.locator('#pair-code').textContent())!.replace(/ /g, '');
  const result = await phone.request.post('http://localhost:3101/api/relay/approve', {data: {secret, code}});
  expect(result.ok()).toBeTruthy();
  await expect(page.locator('#wallet-panel')).toBeVisible();
}
async function phoneContext(browser: Browser) {
  return browser.newContext({extraHTTPHeaders: {Authorization: 'Bearer player-a', Origin: 'http://localhost:3101', 'X-Slot-Request': '1'}});
}

test('real pairing UI, wallet, receive QR, verified signature and logout at iPad sizes', async ({page, browser}) => {
  const phone = await phoneContext(browser);
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await link(page, phone);
  await expect(page.locator('#balance')).toHaveText('128.50');
  await expect(page.locator('#free-spin-summary')).toBeVisible();
  await expect(page.locator('#free-spin-balance')).toHaveText('—');
  await expect(page.locator('#free-spin-note')).toHaveText('The slot is not live yet.');
  await page.getByRole('button', {name: 'Top up wallet'}).click();
  await expect(page.locator('#deposit-qr')).toBeVisible();
  await page.locator('#deposit-close').click();
  for (const height of [768, 650]) {
    await page.setViewportSize({width: 1024, height});
    await page.screenshot({path: `artifacts/terminal-wallet-${height}.png`});
    const size = await page.evaluate(() => ({document: document.documentElement.scrollHeight, viewport: innerHeight}));
    expect(size.document, JSON.stringify(size)).toBeLessThanOrEqual(size.viewport);
  }
  await phone.request.post('http://localhost:3101/api/relay/phone/prepare', {data: {}});
  await phone.request.post('http://localhost:3101/api/relay/phone/activate', {data: {}});
  await expect(page.locator('#sign-button')).toBeEnabled();
  await phone.close();
  await page.locator('#sign-button').click();
  await expect(page.locator('#proof-toggle')).toBeVisible();
  await page.locator('#proof-toggle').click();
  await expect(page.locator('#proof-value')).toContainText('0x');
  await page.locator('#proof-close').click();
  await page.setViewportSize({width: 1024, height: 768});
  await page.screenshot({path: 'artifacts/terminal-wallet.png'});
  await page.locator('#logout').click();
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#full-address')).toHaveText('');
  await expect(page.locator('#proof-value')).toHaveText('');
  await expect(page.locator('#login-qr')).toBeVisible();
  expect(errors).toEqual([]);
});

test('offline idle timeout hides wallet and a late poll cannot bring it back', async ({page, context, browser}) => {
  const phone = await phoneContext(browser);
  await page.clock.install(); await link(page, phone);
  let releasePoll!: () => void, pollStarted!: () => void;
  const held = new Promise<void>(resolve => {pollStarted = resolve;});
  const release = new Promise<void>(resolve => {releasePoll = resolve;});
  await page.route('**/api/relay/tablet', async route => {
    const response = await route.fetch();
    pollStarted(); await release;
    await route.fulfill({response});
  }, {times: 1});
  await page.clock.runFor(2100); await held;
  await context.setOffline(true);
  await page.clock.fastForward(181000);
  await expect(page.locator('#wallet-panel')).toBeHidden();
  await expect(page.locator('#full-address')).toHaveText('');
  // Let the failed logout and pairing XHRs settle before restoring the network.
  // Jumping 26s across a live HTTP request used to race its 25s timeout in CI.
  await expect(page.locator('#retry')).toBeVisible();
  await context.setOffline(false);
  releasePoll();
  await expect(page.locator('#login-qr')).toBeVisible();
  await expect(page.locator('#wallet-panel')).toBeHidden();
  await phone.close();
});

test('reload restores the connected wallet without issuing a new QR and keeps permission distinct', async ({page, browser}) => {
  const phone = await phoneContext(browser);
  await link(page, phone);
  await expect(page.locator('body')).toHaveAttribute('data-wallet-state', 'awaiting-permission');
  await expect(page.locator('#signature-title')).toHaveText('Approval pending.');
  await expect(page.locator('#sign-button')).toBeDisabled();
  const requests: string[] = [];
  page.on('request', request => {if (request.method() === 'POST') requests.push(new URL(request.url()).pathname);});
  await page.reload();
  await expect(page.locator('#wallet-panel')).toBeVisible();
  await expect(page.locator('#login-qr')).toBeHidden();
  await expect(page.locator('#balance')).toHaveText('128.50');
  expect(requests).not.toContain('/api/relay/pair');
  await phone.request.post('http://localhost:3101/api/relay/phone/logout', {data: {}});
  await expect(page.locator('#login-qr')).toBeVisible();
  await expect(page.locator('#session-feedback')).toContainText('session was closed');
  await expect(page.locator('#balance')).not.toHaveAttribute('title');
  await phone.close();
});

test('offline connected state blocks signing, recovers on reconnect, and does not masquerade as logout', async ({page, context, browser}) => {
  const phone = await phoneContext(browser);
  await link(page, phone);
  await phone.request.post('http://localhost:3101/api/relay/phone/prepare', {data: {}});
  await phone.request.post('http://localhost:3101/api/relay/phone/activate', {data: {}});
  await expect(page.locator('#sign-button')).toBeEnabled();
  await context.setOffline(true);
  await expect(page.locator('body')).toHaveAttribute('data-wallet-state', 'offline');
  await expect(page.locator('#connection-banner')).toBeVisible();
  await expect(page.locator('#wallet-panel')).toBeVisible();
  await expect(page.locator('#sign-button')).toBeDisabled();
  await expect(page.locator('#login-qr')).toBeHidden();
  await context.setOffline(false);
  await expect(page.locator('#sign-button')).toBeEnabled();
  await expect(page.locator('#connection-banner')).toBeHidden();
  await page.locator('#logout').click();
  await expect(page.locator('#session-feedback')).toContainText('You logged out');
  await phone.close();
});

test('onchain slot spins through both transactions, waits for finality, maps row-major results and clears on logout', async ({page, browser}) => {
  const phone = await phoneContext(browser);
  let phase: 'idle' | 'waiting' | 'revealable' | 'confirming' | 'complete' = 'idle';
  const symbols = [1,1,0,0,2,0,2,1,2,0,2,0,2,1,1];
  let sessionId = '';
  await page.route('**/api/relay/tablet/game', async route => {
    const response = await page.request.get('http://localhost:3101/api/relay/tablet');
    const session = await response.json(); sessionId = session.id;
    const game = phase === 'idle' ? null : {id:'1',player:session.address,pending:phase==='waiting'||phase==='revealable',hasResult:phase==='confirming'||phase==='complete',confirmed:phase==='complete',won:true,status:phase==='waiting'?'waiting':phase==='revealable'?'revealable':'won',targetBlock:'105',revealDeadline:'361',symbols,matchCount:5,winningLine:1,winningSymbol:1,payout:{kind:3,formattedAmount:'2',tokenSymbol:null},transactionHash:'0x'+'a'.repeat(64)};
    await route.fulfill({json:{configured:true,funding:{ready:true,assets:[]},sessionId:session.id,block:phase==='waiting'?'103':'107',settings:{ticketPrice:'1000000',paused:false,totalOutcomeWeight:1000,configuredPrizeCount:3},keeper:{configured:true,canStartFreeSpin:true,balanceWei:'1000000000000000'},player:{address:session.address,freeSpins:'2',allowance:'0',balance:'128500000',latestGameId:phase==='idle'?'0':'1',historyReady:true,game,operation:null}}});
  });
  await page.route('**/api/relay/tablet/spin',async route=>{
    const body=route.request().postDataJSON();expect(body).toEqual({mode:'free',afterGameId:'0'});phase='waiting';
    await route.fulfill({status:202,json:{sessionId,operation:{key:'test',stage:'confirming',afterGameId:'0'}}});
  });
  await link(page,phone);
  await expect(page.locator('#free-spin-summary')).toBeVisible();
  await expect(page.locator('#free-spin-balance')).toHaveText('2');
  await expect(page.locator('#free-spin-note')).toContainText('The lever uses them first');
  await expect(page.locator('#spin-free')).toBeEnabled();
  await expect(page.locator('#spin-paid')).toBeDisabled();
  await page.locator('#spin-free').click();
  await expect(page.locator('.machine')).toHaveClass(/is-spinning/);
  await expect(page.locator('#game-phase')).toContainText('WAITING FOR BLOCK');
  await expect(page.locator('.cell[data-result-symbol]')).toHaveCount(0);
  phase='revealable';await expect(page.locator('#game-phase')).toContainText('REVEAL');
  await expect(page.locator('.machine')).toHaveClass(/is-spinning/);
  phase='confirming';await expect(page.locator('#game-phase')).toContainText('CONFIRMING RESULT');
  await expect(page.locator('.cell[data-result-symbol]')).toHaveCount(0);
  await expect(page.locator('#game-tx')).toBeHidden();
  phase='complete';await expect(page.locator('#game-title')).toContainText('You won 2 free spin');
  await expect(page.locator('.machine')).not.toHaveClass(/is-spinning/);
  await expect(page.locator('.cell.winner')).toHaveCount(5);
  await expect(page.locator('#game-tx')).toHaveAttribute('href','https://basescan.org/tx/0x'+'a'.repeat(64));
  for(let row=0;row<3;row++)for(let column=0;column<5;column++)await expect(page.locator('.reel').nth(column).locator('.cell').nth(row)).toHaveAttribute('data-result-symbol',String(symbols[row*5+column]));
  for(const height of [768,650]){
    await page.setViewportSize({width:1024,height});
    await page.screenshot({path:`artifacts/terminal-onchain-${height}.png`});
    expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
  }
  await page.locator('#logout').click();
  await expect(page.locator('#login-qr')).toBeVisible();
  await expect(page.locator('#game-controls')).toBeHidden();
  await expect(page.locator('#game-tx')).not.toHaveAttribute('href');
  await expect(page.locator('#free-spin-summary')).toBeHidden();
  await expect(page.locator('#free-spin-balance')).toHaveText('—');
  await expect(page.locator('.cell[data-result-symbol]')).toHaveCount(0);
  await phone.close();
});

test('free-spin counter waits for the welcome grant, tracks spending and hides stale balances offline', async ({page, context, browser}) => {
  const phone = await phoneContext(browser);
  let credits = '0', granted = false;
  await page.route('**/api/relay/tablet/game', async route => {
    const response = await page.request.get('http://localhost:3101/api/relay/tablet');
    const session = await response.json();
    await route.fulfill({json: {configured: true, funding:{ready:true,assets:[]}, sessionId: session.id, block: '107', settings: {ticketPrice: '1000000', paused: false, totalOutcomeWeight: 1000, configuredPrizeCount: 3}, keeper: {configured: true, canStartFreeSpin: true, balanceWei: '1000000'}, player: {address: session.address, freeSpins: credits, allowance: '0', balance: '0', latestGameId: '0', historyReady: true, game: null, operation: null, welcome: {status: granted ? 'granted' : 'pending', amount: '2'}}}});
  });
  await link(page, phone);
  await expect(page.locator('#free-spin-balance')).toHaveText('0');
  await expect(page.locator('#free-spin-note')).toContainText('+2 on the way');
  await expect(page.locator('#spin-free')).toBeDisabled();
  credits = '2'; granted = true;
  await expect(page.locator('#free-spin-balance')).toHaveText('2');
  await expect(page.locator('#spin-free')).toBeEnabled();
  await expect(page.locator('#play-consent-title')).toHaveText('You can already play for free.');
  credits = '1'; await expect(page.locator('#free-spin-balance')).toHaveText('1');
  credits = '0'; await expect(page.locator('#free-spin-balance')).toHaveText('0');
  await expect(page.locator('#free-spin-note')).toHaveText('No free spins available.');
  await expect(page.locator('#spin-free')).toBeDisabled();
  await page.unroute('**/api/relay/tablet/game');
  await context.setOffline(true);
  await expect(page.locator('#free-spin-balance')).toHaveText('—');
  await expect(page.locator('#free-spin-note')).toHaveText('Balance pending update.');
  await phone.close();
});


test('a paired wallet can enter demo when the contract is not configured', async ({page, browser}) => {
  const phone = await phoneContext(browser);
  await link(page, phone);
  await expect(page.locator('#free-spin-note')).toHaveText('The slot is not live yet.');
  await page.locator('#mode-switch').click();
  await expect(page).toHaveURL(/demo=1/);
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'demo');
  await phone.close();
});

test('funding blocks both spin types, recovers after replenishment and keeps Gold payout distinct from jackpot reels',async({page,browser})=>{
  const phone=await phoneContext(browser);
  let funding:boolean|null=false,won=false;
  await page.route('**/api/relay/tablet/game',async route=>{
    const response=await page.request.get('http://localhost:3101/api/relay/tablet');const session=await response.json();
    const game=won?{id:'2',pending:false,hasResult:true,confirmed:true,won:true,status:'won',symbols:Array(15).fill(11),matchCount:5,winningLine:0,winningSymbol:11,payout:{kind:1,token:'0xe908475f8beb7a138b0dc6eb5a05cb27068ffb9a',formattedAmount:'0.01',tokenSymbol:'DGLD'},transactionHash:'0x'+'b'.repeat(64)}:null;
    await route.fulfill({json:{configured:true,sessionId:session.id,block:'120',funding:funding===null?null:{ready:funding,assets:[]},settings:{ticketPrice:'1000000',paused:false,totalOutcomeWeight:1000,configuredPrizeCount:3},keeper:{configured:true,canStartFreeSpin:true,balanceWei:'1000000'},player:{freeSpins:'2',allowance:'10000000',balance:'20000000',latestGameId:won?'2':'0',historyReady:true,game,operation:null}}});
  });
  await link(page,phone);
  await expect(page.locator('.reels img[src="/symbols/jackpot.svg"]')).toHaveCount(2);
  await expect(page.locator('#game-availability')).toContainText('Prize restock');
  await expect(page.locator('#play-consent-title')).toHaveText('Waiting for the machine.');
  await expect(page.locator('#spin-free')).toBeDisabled();await expect(page.locator('#spin-paid')).toBeDisabled();
  await page.screenshot({path:'artifacts/terminal-funding.png'});
  funding=true;await expect(page.locator('#spin-free')).toBeEnabled();await expect(page.locator('#game-availability')).toBeHidden();
  funding=null;await expect(page.locator('#spin-free')).toBeDisabled();await expect(page.locator('#game-availability')).toContainText('Checking prize reserves');
  funding=false;won=true;await expect(page.locator('#game-title')).toHaveText('You won 0.01 Gold (DGLD)!');
  await expect(page.locator('.reels img[src="/symbols/jackpot.svg"]')).toHaveCount(15);
  await expect(page.locator('#won-prize')).toHaveAttribute('src','/symbols/symbol-11.svg');
  await expect(page.locator('#game-tx')).toHaveAttribute('href','https://basescan.org/tx/0x'+'b'.repeat(64));
  await expect(page.locator('#game-availability')).toContainText('Prize restock');
  for(const height of [768,650]){await page.setViewportSize({width:1024,height});await page.screenshot({path:`artifacts/terminal-gold-${height}.png`});expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);}
  await phone.close();
});
