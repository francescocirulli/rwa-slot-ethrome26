import {test, expect, type Page, type BrowserContext, type Browser} from '@playwright/test';
import {pairingSecret} from '../fixtures';

async function link(page: Page, phone: BrowserContext) {
  await page.goto('/');
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
  await expect(page.locator('#balance')).toHaveText('128,50');
  await page.getByRole('button', {name: 'Ricarica il wallet'}).click();
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
  await context.setOffline(true);
  await page.clock.fastForward(181000);
  await expect(page.locator('#wallet-panel')).toBeHidden();
  await expect(page.locator('#full-address')).toHaveText('');
  await context.setOffline(false);
  await page.clock.fastForward(26000);
  await expect(page.locator('#login-qr')).toBeVisible();
  await expect(page.locator('#wallet-panel')).toBeHidden();
  await phone.close();
});

test('reload restores the connected wallet without issuing a new QR and keeps permission distinct', async ({page, browser}) => {
  const phone = await phoneContext(browser);
  await link(page, phone);
  await expect(page.locator('body')).toHaveAttribute('data-wallet-state', 'awaiting-permission');
  await expect(page.locator('#signature-title')).toHaveText('Autorizzazione in attesa.');
  await expect(page.locator('#sign-button')).toBeDisabled();
  const requests: string[] = [];
  page.on('request', request => {if (request.method() === 'POST') requests.push(new URL(request.url()).pathname);});
  await page.reload();
  await expect(page.locator('#wallet-panel')).toBeVisible();
  await expect(page.locator('#login-qr')).toBeHidden();
  await expect(page.locator('#balance')).toHaveText('128,50');
  expect(requests).not.toContain('/api/relay/pair');
  await phone.request.post('http://localhost:3101/api/relay/phone/logout', {data: {}});
  await expect(page.locator('#login-qr')).toBeVisible();
  await expect(page.locator('#session-feedback')).toContainText('sessione è stata chiusa');
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
  await expect(page.locator('#session-feedback')).toContainText('Sei uscito');
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
    const game = phase === 'idle' ? null : {id:'1',player:session.address,pending:phase==='waiting'||phase==='revealable',hasResult:phase==='confirming'||phase==='complete',confirmed:phase==='complete',won:true,status:phase==='waiting'?'waiting':phase==='revealable'?'revealable':'won',targetBlock:'105',revealDeadline:'361',symbols,matchCount:5,winningLine:1,winningSymbol:1,payout:{kind:3,formattedAmount:'2',tokenSymbol:null}};
    await route.fulfill({json:{configured:true,sessionId:session.id,block:phase==='waiting'?'103':'107',settings:{ticketPrice:'1000000',paused:false,totalOutcomeWeight:1000,configuredPrizeCount:3},keeper:{configured:true,canStartFreeSpin:true,balanceWei:'1000000000000000'},player:{address:session.address,freeSpins:'2',allowance:'0',balance:'128500000',latestGameId:phase==='idle'?'0':'1',historyReady:true,game,operation:null}}});
  });
  await page.route('**/api/relay/tablet/spin',async route=>{
    const body=route.request().postDataJSON();expect(body).toEqual({mode:'free',afterGameId:'0'});phase='waiting';
    await route.fulfill({status:202,json:{sessionId,operation:{key:'test',stage:'confirming',afterGameId:'0'}}});
  });
  await link(page,phone);
  await expect(page.locator('#spin-free')).toBeEnabled();
  await expect(page.locator('#spin-paid')).toBeDisabled();
  await page.locator('#spin-free').click();
  await expect(page.locator('.machine')).toHaveClass(/is-spinning/);
  await expect(page.locator('#game-phase')).toContainText('ATTESA BLOCCO');
  await expect(page.locator('.cell[data-result-symbol]')).toHaveCount(0);
  phase='revealable';await expect(page.locator('#game-phase')).toContainText('REVEAL');
  await expect(page.locator('.machine')).toHaveClass(/is-spinning/);
  phase='confirming';await expect(page.locator('#game-phase')).toContainText('CONFERMA RISULTATO');
  await expect(page.locator('.cell[data-result-symbol]')).toHaveCount(0);
  phase='complete';await expect(page.locator('#game-title')).toContainText('Hai vinto 2 free spin');
  await expect(page.locator('.machine')).not.toHaveClass(/is-spinning/);
  await expect(page.locator('.cell.winner')).toHaveCount(5);
  for(let row=0;row<3;row++)for(let column=0;column<5;column++)await expect(page.locator('.reel').nth(column).locator('.cell').nth(row)).toHaveAttribute('data-result-symbol',String(symbols[row*5+column]));
  for(const height of [768,650]){
    await page.setViewportSize({width:1024,height});
    await page.screenshot({path:`artifacts/terminal-onchain-${height}.png`});
    expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
  }
  await page.locator('#logout').click();
  await expect(page.locator('#login-qr')).toBeVisible();
  await expect(page.locator('#game-controls')).toBeHidden();
  await expect(page.locator('.cell[data-result-symbol]')).toHaveCount(0);
  await phone.close();
});
