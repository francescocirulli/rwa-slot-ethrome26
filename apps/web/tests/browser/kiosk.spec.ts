import {test,expect} from '@playwright/test';

test('demo never contacts real relay, covers both stages, ignores repeated lever and resets to real',async({page})=>{
  const relay:string[]=[];const errors:string[]=[];page.on('request',r=>{if(r.url().includes('/api/relay'))relay.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?demo=1');await expect(page.locator('#attract-screen')).toHaveCount(0);
  await page.locator('#demo-login').click();
  await expect(page.locator('#spin-free')).toBeEnabled();
  await expect(page.locator('#demo-outcome')).toHaveValue('random');
  await page.evaluate(()=>{Math.random=()=>0.9;});
  await page.locator('#demo-outcome').selectOption('11-5');
  await page.evaluate(()=>{for(let i=0;i<10;i++)(window as any).slotPullLever();});
  await expect(page.locator('.machine')).toHaveClass(/is-spinning/);await expect(page.locator('#mode-switch')).toBeDisabled();
  await expect(page.locator('#free-spin-count')).toHaveText('1');
  await expect(page.locator('.cell[data-result-symbol]')).toHaveCount(0);
  await expect(page.locator('#game-title')).toContainText('You won 0.001 Gold (DGLD)', {timeout:12000});
  await expect(page.locator('.cell.winner img[alt=JACKPOT]')).toHaveCount(5);
  await expect(page.locator('#game-tx')).toBeHidden();
  await expect(page.locator('#game-phase')).toContainText('DEMO');await expect(page.locator('.cell.winner')).toHaveCount(5);
  await expect(page.locator('#free-spin-count')).toHaveText('1');
  await page.locator('#demo-empty').click();await expect(page.locator('#spin-free')).toBeDisabled();await expect(page.locator('#spin-paid')).toBeDisabled();
  await page.evaluate(()=>(window as any).slotPullLever());await expect(page.locator('.machine')).not.toHaveClass(/is-spinning/);
  expect(relay).toEqual([]);expect(errors).toEqual([]);
  await page.locator('#mode-switch').click();await expect(page).toHaveURL(/\/$/);await expect(page.locator('body')).toHaveAttribute('data-mode','real');
});

test('demo loss, paid credits plus illustrative gas, and idle expiry',async({page})=>{
  await page.goto('/?demo=1');await page.locator('#demo-login').click();
  await expect(page.locator('#spin-paid')).toBeEnabled();await page.locator('#demo-outcome').selectOption('loss');await page.locator('#spin-paid').click();
  await expect(page.locator('#balance')).toHaveText('0.19');await expect(page.locator('#game-title')).toHaveText('No prize this time.',{timeout:12000});
  await expect(page.locator('.cell.winner')).toHaveCount(0);await expect(page.locator('#spin-free')).toBeEnabled();
  for(const height of [768,650]) {await page.setViewportSize({width:1024,height});await page.screenshot({path:`artifacts/kiosk-demo-${height}.png`});expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);}
  await page.clock.install();await page.clock.fastForward(181000);await expect(page.locator('#wallet-panel')).toBeHidden();await expect(page.locator('#demo-login')).toBeVisible();
});

test('paired hardware motion wakes kiosk and one physical lever starts one demo round',async({page,request})=>{
  let seq=0;
  const device=async(events:unknown[]=[])=>{const response=await request.post('/api/hardware/device',{headers:{Authorization:'Bearer browser-hardware-test-token-32-characters'},data:{deviceId:'a'.repeat(32),seq:++seq,online:true,events}});return response.json();};
  await page.goto('/?demo=1');const initial=await device();
  await page.locator('#settings-open').click();await page.locator('#hardware-open').click();await page.locator('#hardware-code').fill(initial.code);await page.locator('#hardware-pair').click();
  await expect(page.locator('#hardware-status')).toHaveText('Arduino linked.');await page.locator('#hardware-close').click();
  await device([{evt:'motion'}]);await expect.poll(async()=>(await device()).command.cmd).toBe('attract');
  await page.locator('#demo-login').click();await expect(page.locator('#spin-free')).toBeEnabled();
  await page.locator('#demo-outcome').selectOption('loss');
  let gate='';await expect.poll(async()=>{gate=(await device()).gate;return gate;}).not.toBe('');
  await device([{evt:'lever',gate},{evt:'lever',gate}]);await expect(page.locator('.machine')).toHaveClass(/is-spinning/);
  await device([{evt:'lever',gate}]);await expect(page.locator('#free-spin-count')).toHaveText('1');
  await expect(page.locator('#game-title')).toContainText('No prize',{timeout:12000});
  await expect.poll(async () => (await device()).command.cmd).toBe('result');
  const effect = (await device()).command; expect(effect.tier).toBe(0); expect(effect.hub).toBe(false);
  await page.waitForTimeout(2500);await expect(page.locator('#free-spin-count')).toHaveText('1');
});


test('demo freezes one diagonal 3/5, waits for confirmation and credits exactly one bonus spin',async({page})=>{
  await page.goto('/?demo=1');await page.locator('#demo-login').click();
  await expect(page.locator('#spin-free')).toBeEnabled();await page.evaluate(()=>{Math.random=()=>0.5;});
  await page.locator('#demo-outcome').selectOption('1-3');await page.locator('#spin-free').click();
  await expect(page.locator('.machine')).toHaveClass(/is-spinning/);await expect(page.locator('#free-spin-count')).toHaveText('1');
  const read=()=>page.evaluate(()=>new Promise<any>(resolve=>(window as any).slotDemo.request('/api/relay/tablet/game',null,(_:unknown,d:unknown)=>resolve(d))));
  const pending=await read();expect(pending.player.game.hasResult).toBe(false);expect(pending.player.game.symbols).toEqual([]);expect(pending.player.game.payout).toBeNull();
  // A changed test control or repeated polls must never reroll the accepted round.
  await page.evaluate(()=>{(document.getElementById('demo-outcome') as HTMLSelectElement).value='11-5';});
  await expect.poll(async()=>{const s=await read();return s.player.game.hasResult&&!s.player.game.confirmed;},{intervals:[100]}).toBe(true);
  await expect(page.locator('.cell[data-result-symbol]')).toHaveCount(0);await expect(page.locator('.machine')).toHaveClass(/is-spinning/);
  await expect(page.locator('#game-title')).toContainText('You won 1 free spin',{timeout:10000});await expect(page.locator('#free-spin-count')).toHaveText('2');
  const first=await read(),second=await read();expect(second.player.game).toEqual(first.player.game);expect(second.player.freeSpins).toBe('2');
  expect(first.player.game.matchCount).toBe(3);expect(first.player.game.winningLine).toBe(1);
  await expect(page.locator('.cell.winner')).toHaveCount(3);
  for(let c=0;c<5;c++)expect(new Set([first.player.game.symbols[c],first.player.game.symbols[c+5],first.player.game.symbols[c+10]]).size).toBe(3);
});
