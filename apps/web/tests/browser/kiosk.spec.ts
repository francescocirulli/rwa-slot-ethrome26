import {test,expect} from '@playwright/test';

test('demo never contacts real relay, covers both stages, ignores repeated lever and resets to real',async({page})=>{
  const relay:string[]=[];const errors:string[]=[];page.on('request',r=>{if(r.url().includes('/api/relay'))relay.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?demo=1');await expect(page.locator('#attract-screen')).toBeVisible();
  await page.locator('#attract-wake').click();await page.locator('#demo-login').click();
  await expect(page.locator('#spin-free')).toBeEnabled();
  await page.locator('#demo-outcome').selectOption('jackpot');
  await page.evaluate(()=>{for(let i=0;i<10;i++)(window as any).slotPullLever();});
  await expect(page.locator('.machine')).toHaveClass(/is-spinning/);await expect(page.locator('#mode-switch')).toBeDisabled();
  await expect(page.locator('#free-spin-count')).toHaveText('1');
  await expect(page.locator('.cell[data-result-symbol]')).toHaveCount(0);
  await expect(page.locator('#game-title')).toContainText('Hai vinto', {timeout:12000});
  await expect(page.locator('#game-phase')).toContainText('DEMO');await expect(page.locator('.cell.winner')).toHaveCount(5);
  await expect(page.locator('#free-spin-count')).toHaveText('1');
  await page.locator('#demo-empty').click();await expect(page.locator('#spin-free')).toBeDisabled();await expect(page.locator('#spin-paid')).toBeDisabled();
  await page.evaluate(()=>(window as any).slotPullLever());await expect(page.locator('.machine')).not.toHaveClass(/is-spinning/);
  expect(relay).toEqual([]);expect(errors).toEqual([]);
  await page.locator('#mode-switch').click();await expect(page).toHaveURL(/\/$/);await expect(page.locator('body')).toHaveAttribute('data-mode','real');
});

test('demo loss, paid credits plus illustrative gas, and idle expiry',async({page})=>{
  await page.goto('/?demo=1');await page.locator('#attract-wake').click();await page.locator('#demo-login').click();
  await expect(page.locator('#spin-paid')).toBeEnabled();await page.locator('#demo-outcome').selectOption('loss');await page.locator('#spin-paid').click();
  await expect(page.locator('#balance')).toHaveText('0,19');await expect(page.locator('#game-title')).toHaveText('Questa volta, nessun premio.',{timeout:12000});
  await expect(page.locator('.cell.winner')).toHaveCount(0);await expect(page.locator('#spin-free')).toBeEnabled();
  for(const height of [768,650]) {await page.setViewportSize({width:1024,height});await page.screenshot({path:`artifacts/kiosk-demo-${height}.png`});expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);}
  await page.clock.install();await page.clock.fastForward(181000);await expect(page.locator('#wallet-panel')).toBeHidden();await expect(page.locator('#attract-screen')).toBeVisible();
});

test('paired hardware motion wakes kiosk and one physical lever starts one demo round',async({page,request})=>{
  let seq=0;
  const device=async(events:unknown[]=[])=>{const response=await request.post('/api/hardware/device',{headers:{Authorization:'Bearer browser-hardware-test-token-32-characters'},data:{bridgeId:'a'.repeat(32),seq:++seq,online:true,events}});return response.json();};
  await page.goto('/?demo=1');const initial=await device();
  await page.locator('#hardware-open').click();await page.locator('#hardware-code').fill(initial.code);await page.locator('#hardware-pair').click();
  await expect(page.locator('#hardware-status')).toHaveText('Arduino collegato.');await page.locator('#hardware-close').click();
  await device([{evt:'motion'}]);await expect(page.locator('#attract-screen')).toBeHidden();
  await page.locator('#demo-login').click();await expect(page.locator('#spin-free')).toBeEnabled();
  let gate='';await expect.poll(async()=>{gate=(await device()).gate;return gate;}).not.toBe('');
  await device([{evt:'lever',gate},{evt:'lever',gate}]);await expect(page.locator('.machine')).toHaveClass(/is-spinning/);
  await device([{evt:'lever',gate}]);await expect(page.locator('#free-spin-count')).toHaveText('1');
  await expect(page.locator('#game-title')).toContainText('nessun premio',{timeout:12000});
  await expect.poll(async () => (await device()).command.cmd).toBe('result');
  const effect = (await device()).command; expect(effect.tier).toBe(0); expect(effect.hub).toBe(false);
  await page.waitForTimeout(2500);await expect(page.locator('#free-spin-count')).toHaveText('1');
});
