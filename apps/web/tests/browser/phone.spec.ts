import {fixtureOrigin} from './origin';
import {test,expect,type Page} from '@playwright/test';
import QRCode from 'qrcode';
import {WALLET_ASSETS,NFT_PRIZES} from '../../lib/assets';
import {BASE_PRIZE_COLLECTION,BASE_PRIZE_IDS} from '../../lib/prize-collection';
const address='0x0000000000000000000000000000000000000011',recipient='0x0000000000000000000000000000000000000022',contract='0x0000000000000000000000000000000000000099';
async function setup(page:Page,{paired=false,busy=false,unavailable=false,playActive=true,playPrepared=false,usdc='100000000',eth='0.001',gasMode='usdc',allowance='2500000',sessionId='fixture-session'}={}) {
  let connected=paired;
  let playGrant=playActive||playPrepared?{active:playActive,budget:'5000000',signerId:'fixture',policyId:'fixture'}:undefined;
  await page.route('**/api/account/welcome',route=>route.fulfill({json:{status:'granted',amount:'2'}}));
  const session=()=>({id:sessionId,state:'active',address,code:'123456',serverTime:Date.now(),expiresAt:Date.now()+180000,welcome:{status:'granted',amount:'2'},...(playGrant?{playGrant}:{})});
  await page.route('**/api/account',async route=>route.fulfill({json:{userId:'fixture-user',wallet:{address,depositQr:'data:image/gif;base64,R0lGODlhAQABAAAAACw=',balance:{amount:'10',stale:false,updatedAt:Date.now()},portfolio:unavailable?null:{address,chainId:8453,contract,updatedAt:Date.now(),eth,allowance,freeSpins:'2',ticketPrice:'50000',busy,canTransact:!busy,gameId:busy?'4':null,gasMode,assets:WALLET_ASSETS.map(asset=>({...asset,balance:asset.id==='usdc'?usdc:'100000000',formatted:asset.decimals===8?'1':'10',verified:true})),nfts:NFT_PRIZES.map(nft=>({...nft,token:BASE_PRIZE_COLLECTION,tokenId:BASE_PRIZE_IDS[nft.symbol],balance:'2'}))}}}}));
  await page.route('**/api/relay/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/phone/logout')){connected=false;return route.fulfill({json:{ok:true}});}
    if(path.endsWith('/lookup'))return route.fulfill({json:{code:'123456',origin:fixtureOrigin,expiresAt:Date.now()+300000}});
    if(path.endsWith('/approve')){connected=true;return route.fulfill({json:session()});}
    if(path.endsWith('/phone/activity'))return route.fulfill({json:{...session(),sessionId}});
    if(path.endsWith('/phone/play/prepare')){playGrant={active:false,budget:route.request().postDataJSON().budget,signerId:'fixture',policyId:'fixture'};return route.fulfill({json:session()});}
    if(path.endsWith('/phone/play/activate')){playGrant={active:true,budget:playGrant!.budget,signerId:'fixture',policyId:'fixture'};return route.fulfill({json:session()});}
    if(path.endsWith('/phone/game')||path.endsWith('/phone/approval'))return route.fulfill({json:{configured:true,settings:{ticketPrice:'50000'},player:{balance:usdc,freeSpins:'2',allowance,game:{id:'4',pending:busy}},gasMode}});
    return connected?route.fulfill({json:session()}):route.fulfill({status:401,json:{error:'No iPad linked'}});
  });
  await page.setViewportSize({width:390,height:844});
}
test('standalone wallet shows allowance and all prizes; transfer requires readable review and explicit confirmation',async({page})=>{
  await setup(page);await page.goto('/phone-fixture');
  await expect(page.getByText('No iPad linked to this page')).toBeVisible();
  await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByLabel('Wallet address',{exact:true})).toHaveText(address);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{document.body.dataset.copiedAddress=value;}}}));
  await page.getByRole('button',{name:'Copy address',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-copied-address',address);
  await expect(page.getByRole('button',{name:'Address copied'})).toBeVisible();
  await expect(page.getByText('2.5 USDC',{exact:true})).toBeVisible();
  await expect(page.locator('b').filter({hasText:'GOLD · DGLD'})).toBeVisible();
  await page.screenshot({path:'/tmp/phone-wallet-standalone.png',fullPage:true});
  await page.locator('#wallet-approval').screenshot({path:'/tmp/iphone-wallet-approval.png'});
  await page.getByRole('button',{name:'Send NVIDIA · NVDAc'}).click();
  await page.getByLabel('External recipient address').fill(recipient);await page.getByLabel('Token amount',{exact:true}).fill('0.0005');
  await page.getByRole('button',{name:'Review transfer'}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByText('0.0005 NVDAc').first()).toBeVisible();await expect(dialog.getByText(recipient,{exact:true})).toBeVisible();
  expect(await page.locator('body').getAttribute('data-submitted')).toBeNull();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toBeHidden();expect(await page.locator('body').getAttribute('data-submitted')).toBeNull();
  await page.getByRole('button',{name:'Review transfer'}).click();await dialog.getByRole('button',{name:'Confirm from my wallet'}).click();
  await expect(page.locator('body')).toHaveAttribute('data-submitted',JSON.stringify({action:'transferERC20',args:[WALLET_ASSETS[1].address,recipient,'50000']}));
});
test('NFT quantity validation, allowance replacement and zero revocation remain separate reviewed actions',async({page})=>{
  await setup(page);await page.goto('/phone-fixture');
  await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await page.getByRole('button',{name:'Send Magnet'}).click();await page.getByLabel('External recipient address').fill(recipient);await page.getByLabel('NFT quantity (whole)').fill('1.5');await page.getByRole('button',{name:'Review transfer'}).click();
  await expect(page.getByRole('dialog')).toBeHidden();await expect(page.getByText('Amount above the available balance or invalid.')).toBeVisible();
  await page.getByLabel('NFT quantity (whole)').fill('2');await page.getByRole('button',{name:'Review transfer'}).click();await expect(page.getByText('2 NFT · ID 5',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByLabel('New total USDC limit').fill('3');await page.getByRole('button',{name:'Review approval'}).click();await expect(page.getByRole('dialog').getByText('3 USDC',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Revoke USDC approval'}).click();await expect(page.getByRole('dialog').getByText('0 USDC',{exact:true})).toBeVisible();
});
test('ending pairing keeps wallet signed in; logout returns to standalone login',async({page})=>{
  await setup(page,{paired:true});await page.goto('/phone-fixture');
  await page.getByRole('button',{name:'End the iPad link'}).click();
  await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await page.getByText('Account & security',{exact:true}).click();
  await expect(page.getByText('ACCOUNT CONNECTED',{exact:false})).toBeVisible();await expect(page.locator('b').filter({hasText:'GOLD · DGLD'})).toBeVisible();await expect(page.getByText('2.5 USDC',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign out of the wallet'}).click();await expect(page.getByRole('button',{name:'Sign in with passkey'})).toBeVisible();await expect(page.locator('b').filter({hasText:'GOLD · DGLD'})).toBeHidden();
  await page.getByRole('button',{name:'Sign in with passkey'}).click();await page.getByRole('button',{name:'Wallet',exact:true}).click();await expect(page.locator('b').filter({hasText:'GOLD · DGLD'})).toBeVisible();
});
test('authenticated QR pairing reuses login; inactivity expires only the iPad session',async({page})=>{
  await setup(page);await page.clock.install();await page.goto('/phone-fixture#pair=fixture-secret');
  await expect(page.getByRole('button',{name:'Sign in with passkey'})).toBeHidden();await page.getByLabel('The code matches.').check();await page.getByRole('button',{name:'Link the wallet'}).click();
  await expect(page.getByRole('button',{name:'End the iPad link'})).toBeVisible();
  // A configured slot must still expose the proof approval: the iPad waits for
  // grant.active, so gating this card on slotConfigured would strand the link.
  await expect(page.getByText("Now it is the iPad's turn.")).toBeVisible();
  await expect(page.getByRole('button',{name:'Approve and take a seat'})).toBeVisible();
  // Freeze relay expiry relative to real time while advancing the browser clock.
  await page.route('**/api/relay/phone',route=>route.fulfill({status:401,json:{error:'Session expired'}}));
  await page.clock.fastForward(181000);await expect(page.getByRole('button',{name:'End the iPad link'})).toBeHidden();await page.getByRole('button',{name:'Wallet',exact:true}).click();await expect(page.locator('b').filter({hasText:'GOLD · DGLD'})).toBeVisible();
});
test('pending spin disables wallet writes; unavailable reads never look like zero holdings',async({page})=>{
  await setup(page,{paired:true,busy:true});await page.goto('/phone-fixture');
  await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByText('Spin in progress #4.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Review approval'})).toBeDisabled();await expect(page.getByRole('button',{name:'Send NVIDIA · NVDAc'})).toBeDisabled();
  await page.unrouteAll({behavior:'wait'});await setup(page,{unavailable:true});await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByText('Prize balances and approval unavailable.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Review approval'})).toBeDisabled();
});


test('camera scanner decodes the iPad QR locally, stops the camera and requires explicit pairing confirmation',async({page})=>{
  await setup(page);
  const secret='a'.repeat(64),picture=await QRCode.toDataURL(fixtureOrigin+'/phone#pair='+secret,{width:512,margin:4});
  await page.addInitScript(({picture})=>{
    (window as any).cameraRequests=0;
    Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{
      (window as any).cameraRequests++;
      const image=new Image();image.src=picture;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;canvas.getContext('2d')!.drawImage(image,0,0);
      const stream=canvas.captureStream(5);(window as any).cameraTrack=stream.getTracks()[0];return stream;
    }}});
  },{picture});
  await page.goto('/phone-fixture');
  expect(await page.evaluate(()=>(window as any).cameraRequests)).toBe(0);
  await page.getByRole('button',{name:'Scan iPad QR'}).click();
  await expect(page.getByLabel('The code matches.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Link the wallet'})).toBeDisabled();
  expect(await page.evaluate(()=>(window as any).cameraTrack.readyState)).toBe('ended');
  await expect(page.getByRole('button',{name:'Sign in with passkey'})).toBeHidden();
  await page.getByLabel('The code matches.').check();await page.getByRole('button',{name:'Link the wallet'}).click();
  await expect(page.getByRole('button',{name:'End the iPad link'})).toBeVisible();
});

test('denied camera offers local photo scanning and rejects a foreign pairing origin',async({page})=>{
  await setup(page);
  await page.addInitScript(()=>{Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{throw new DOMException('denied','NotAllowedError');}}});});
  await page.goto('/phone-fixture');await page.getByRole('button',{name:'Scan iPad QR'}).click();
  await expect(page.getByText('Consenti l’accesso alla fotocamera',{exact:false})).toBeVisible();
  const secret='b'.repeat(64),image=async(origin:string)=>({name:'qr.png',mimeType:'image/png',buffer:await QRCode.toBuffer(origin+'/phone#pair='+secret,{width:512,margin:4})});
  await page.locator('input[type=file]').setInputFiles(await image('https://other.example'));
  await expect(page.getByText('Scansiona il QR mostrato da questa app sull’iPad.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Link the wallet'})).toBeHidden();
  await page.locator('input[type=file]').setInputFiles(await image(fixtureOrigin));
  await expect(page.getByLabel('The code matches.')).toBeVisible();await expect(page.getByRole('dialog')).toBeHidden();
});

test('closing scanner while permission is pending stops a late camera stream',async({page})=>{
  await setup(page);
  await page.addInitScript(()=>{Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>new Promise(resolve=>{(window as any).allowCamera=()=>{
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const stream=canvas.captureStream();(window as any).cameraTrack=stream.getTracks()[0];resolve(stream);
  };})}});});
  await page.goto('/phone-fixture');await page.getByRole('button',{name:'Scan iPad QR'}).click();await page.getByRole('button',{name:'Chiudi scanner'}).click();
  await page.evaluate(()=>(window as any).allowCamera());
  await expect.poll(()=>page.evaluate(()=>(window as any).cameraTrack.readyState)).toBe('ended');
  await expect(page.getByRole('dialog')).toBeHidden();
});


test('paired setup has one approval form and empty wallets see Base funding before any signature',async({page})=>{
  await setup(page,{paired:true,playActive:false,allowance:'0',usdc:'0',eth:'0'});await page.goto('/phone-fixture');
  await expect(page.getByRole('heading',{name:'Your USDC limit.'})).toBeHidden();
  await expect(page.getByRole('button',{name:'Approve and play'})).toBeHidden();
  await expect(page.getByText('You can already play for free on the iPad.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Manage spending in Wallet'}).click();
  await page.getByLabel('I authorize spins within this budget').check();
  await expect(page.getByRole('button',{name:'Approve and play'})).toBeDisabled();
  await page.getByRole('link',{name:'Fund your wallet on Base'}).click();
  await expect(page.getByText('Add USDC on Base to this address',{exact:false})).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await page.locator('body').getAttribute('data-submitted')).toBeNull();
  await page.unrouteAll({behavior:'wait'});await setup(page,{paired:true,playActive:false,allowance:'0'});
  await page.getByRole('button',{name:'Refresh balances'}).click();
  await expect(page.getByRole('heading',{name:'Your USDC limit.'})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Approve and play'})).toBeEnabled();
  await page.getByRole('button',{name:'Approve and play'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('ETH alone cannot enable paid play; ETH gas mode requires ETH and failed balances block approval',async({page})=>{
  await setup(page,{paired:true,playActive:false,allowance:'0',usdc:'0'});await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await page.getByLabel('I authorize spins within this budget').check();
  await expect(page.getByRole('button',{name:'Approve and play'})).toBeDisabled();
  await page.unrouteAll({behavior:'wait'});await setup(page,{eth:'0',gasMode:'eth'});await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByRole('button',{name:'Review approval'})).toBeDisabled();
  await expect(page.getByText('Add ETH on Base to pay approval fees.',{exact:false})).toBeVisible();
  await page.unrouteAll({behavior:'wait'});await setup(page,{unavailable:true});await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByRole('button',{name:'Review approval'})).toBeDisabled();
});

test('paid play rechecks USDC before preparing permission when displayed balances are stale',async({page})=>{
  await setup(page,{paired:true,playActive:false,allowance:'0'});await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await page.getByLabel('I authorize spins within this budget').check();
  await expect(page.getByRole('button',{name:'Approve and play'})).toBeEnabled();
  let prepared=0;
  await page.route('**/api/relay/phone/play/prepare',route=>{prepared++;return route.abort();});
  await page.route('**/api/relay/phone/approval',route=>route.fulfill({json:{configured:true,settings:{ticketPrice:'50000'},player:{balance:'0',freeSpins:'2',allowance:'0'},gasMode:'usdc'}}));
  await page.getByRole('button',{name:'Approve and play'}).click();
  await expect(page.getByRole('alert').filter({hasText:'Add USDC on Base'})).toBeVisible();
  expect(prepared).toBe(0);await expect(page.getByRole('dialog')).toBeHidden();
});

for(const [name,id] of [['Books','6'],['Water Bottle','7'],['Caps','8']])test('phone reviews and transfers '+name+' with its exact ERC1155 ID',async({page})=>{
  await setup(page);await page.goto('/phone-fixture');
  await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await page.getByRole('button',{name:'Send '+name}).click();
  await page.getByLabel('External recipient address').fill(recipient);await page.getByLabel('NFT quantity (whole)').fill('2');
  await page.getByRole('button',{name:'Review transfer'}).click();
  await expect(page.getByRole('dialog').getByText('2 NFT · ID '+id,{exact:true})).toBeVisible();
  expect(await page.locator('body').getAttribute('data-submitted')).toBeNull();
  await page.getByRole('button',{name:'Confirm from my wallet'}).click();
  await expect(page.locator('body')).toHaveAttribute('data-submitted',JSON.stringify({action:'transferERC1155',args:[BASE_PRIZE_COLLECTION,id,recipient,'2']}));
});

test('welcome spins recover without pairing or working balance RPCs and resume after reload',async({page})=>{
  await setup(page,{unavailable:true});let claims=0;
  await page.route('**/api/account',route=>route.fulfill({status:503,json:{error:'Balance RPC unavailable'}}));
  await page.route('**/api/account/welcome',route=>{
    claims++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postData()).toBeNull();
    return claims===1?route.fulfill({status:503,json:{status:'unavailable',amount:'2'}}):route.fulfill({json:{status:'granted',amount:'2'}});
  });
  await page.goto('/phone-fixture');
  await expect(page.getByRole('status',{name:'Welcome spins'})).toContainText('being credited');
  await expect(page.getByRole('status',{name:'Welcome spins'})).toContainText('have been credited',{timeout:10000});
  expect(claims).toBe(2);
  await page.reload();
  await expect(page.getByRole('status',{name:'Welcome spins'})).toContainText('have been credited');
  expect(claims).toBe(3);
  await expect(page.getByText('No iPad linked to this page')).toBeVisible();
});


for (const viewport of [{width:320,height:568},{width:390,height:844},{width:430,height:932},{width:844,height:390}]) {
  test(`phone navigation stays reachable at ${viewport.width}×${viewport.height}`, async ({page}) => {
    await setup(page);
    await page.setViewportSize(viewport);
    await page.goto('/phone-fixture');
    const nav = page.getByRole('navigation', {name:'Phone sections'});
    const scan = page.getByRole('button', {name:'Scan iPad QR'});
    await expect(scan).toBeVisible();
    if (viewport.height >= 568) await expect(scan).toBeInViewport();
    await expect(page.getByRole('heading', {name:'Your winnings.'})).toBeHidden();
    for (const name of ['Wallet','Activity','Play']) {
      const button = nav.getByRole('button', {name,exact:true});
      await expect(button).toBeInViewport();
      const bounds = await button.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      await button.click();
      await expect(button).toHaveAttribute('aria-current','page');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (name === 'Wallet') {
        await expect(page.getByLabel('Wallet address', {exact:true})).toBeVisible();
        const winnings = await page.getByRole('heading', {name:'Your winnings.'}).boundingBox();
        const limit = await page.getByRole('heading', {name:'Your USDC limit.'}).boundingBox();
        expect(limit!.y).toBeLessThan(winnings!.y);
        await page.getByText('Account & security', {exact:true}).scrollIntoViewIfNeeded();
        await expect(nav).toBeInViewport();
      }
      if (name === 'Activity') await expect(page.getByRole('region', {name:'Season leaderboard'})).toBeVisible();
    }
    if (viewport.width === 390) await page.screenshot({path:'/tmp/iphone-play-redesign.png'});
  });
}

test('changing views preserves a transfer draft and never submits it', async ({page}) => {
  await setup(page);await page.goto('/phone-fixture');
  await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await page.getByRole('button',{name:'Send NVIDIA · NVDAc'}).click();
  await expect(page.getByLabel('External recipient address')).toBeFocused();
  await page.getByLabel('External recipient address').fill(recipient);
  await page.getByLabel('Token amount',{exact:true}).fill('0.0005');
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByLabel('External recipient address')).toHaveValue(recipient);
  await expect(page.getByLabel('Token amount',{exact:true})).toHaveValue('0.0005');
  expect(await page.locator('body').getAttribute('data-submitted')).toBeNull();
});

test('session expiry warning remains reachable while viewing the wallet', async ({page}) => {
  await setup(page,{paired:true});await page.clock.install();await page.goto('/phone-fixture');
  await expect(page.getByRole('button',{name:'End the iPad link'})).toBeVisible();
  // Freeze reads and the navigation activity request before advancing time.
  // A late activity response would otherwise renew the fixture deadline.
  await page.route('**/api/relay/phone',route=>route.abort());
  await page.route('**/api/relay/phone/activity',route=>route.abort());
  await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByLabel('Wallet address',{exact:true})).toHaveText(address);
  await page.clock.fastForward(151000);
  const keepAlive=page.getByRole('button',{name:'I am still here'});
  await expect(keepAlive).toBeInViewport();
  await expect(page.getByRole('button',{name:'Wallet',exact:true})).toHaveAttribute('aria-current','page');
  await page.clock.fastForward(31000);
  await expect(keepAlive).toBeHidden();
  await expect(page.getByLabel('Wallet address',{exact:true})).toHaveText(address);
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await expect(page.getByRole('button',{name:'Scan iPad QR'})).toBeVisible();
});

test('one wallet approval card and draft survive tab switches, failed refresh and session expiry',async({page})=>{
 await setup(page,{paired:true,playActive:false});await page.goto('/phone-fixture');
 const card=page.locator('#wallet-approval');await expect(card).toHaveCount(1);await expect(card).toBeHidden();
 await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await page.getByRole('button',{name:'Change USDC limit',exact:true}).click();
 await page.getByLabel('New total USDC limit').fill('7.25');
 await page.evaluate(()=>{(window as any).approvalCard=document.getElementById('wallet-approval');});
 for(const tab of ['Activity','Play','Wallet','Activity','Wallet']){
  await page.getByRole('button',{name:tab,exact:true}).click();
  if(tab==='Wallet')await expect(card).toBeVisible();else await expect(card).toBeHidden();
  expect(await page.evaluate(()=>(window as any).approvalCard===document.getElementById('wallet-approval'))).toBe(true);
 }
 await page.route('**/api/account',route=>route.fulfill({status:503,json:{error:'Temporary balance outage'}}));
 await page.getByRole('button',{name:'Refresh balances'}).click();
 await expect(card).toContainText('Needs refresh');await expect(card).toContainText('2.5 USDC');
 await expect(page.getByLabel('New total USDC limit')).toHaveValue('7.25');
 await expect(card.getByRole('button',{name:'Review approval'})).toBeDisabled();
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.getByRole('button',{name:'End the iPad link'}).click();
 await expect(card).toBeHidden();await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await expect(page.getByLabel('New total USDC limit')).toHaveValue('7.25');await expect(card).toHaveCount(1);
 expect(await page.evaluate(()=>(window as any).approvalCard===document.getElementById('wallet-approval'))).toBe(true);
});

test('an approval review arriving after navigation stays in Wallet',async({page})=>{
 await setup(page);await page.goto('/phone-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await page.evaluate(()=>{(window as any).phoneReviewDelay=new Promise<void>(resolve=>{(window as any).releasePhoneReview=resolve;});});
 await page.getByRole('button',{name:'Review approval'}).click();
 await page.getByRole('button',{name:'Activity',exact:true}).click();
 await page.evaluate(async()=>{(window as any).releasePhoneReview();await new Promise(requestAnimationFrame);});
 await expect(page.getByRole('dialog')).toBeHidden();
 await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(await page.locator('body').getAttribute('data-submitted')).toBeNull();
});


test('budget confirmation survives RPC and network failures and enables the iPad without resending',async({page})=>{
 await setup(page,{paired:true,playActive:false,allowance:'0'});
 const id='a'.repeat(64),hash='0x'+'b'.repeat(64);let sends=0,statusReads=0,receiptReads=0,activations=0;
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/relay/phone/play/activate')activations++;});
 await page.route('**/api/contract/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/prepare'))return route.fulfill({json:{id,address,action:'approveBudget',args:['5000000'],expiresAt:Date.now()+180000,transaction:{to:contract,data:'0x',chainId:8453,gasMode:'usdc'}}});
  if(path.endsWith('/send')){sends++;return route.fulfill({status:202,json:{id,stage:'confirming'}});}
  if(path.endsWith('/status')){
   statusReads++;
   if(statusReads===1)return route.fulfill({status:503,json:{error:'RPC unavailable'}});
   if(statusReads===2)return route.fulfill({status:502,contentType:'text/html',body:'Bad gateway'});
   return route.fulfill({json:{id,hash,stage:'confirming'}});
  }
  if(path.endsWith('/receipt')){
   receiptReads++;
   if(receiptReads===1)return route.abort('failed');
   if(receiptReads===2)return route.fulfill({status:503,json:{error:'RPC unavailable'}});
   return route.fulfill({json:{status:'confirmed'}});
  }
  throw Error('Unexpected transaction request');
 });
 await page.goto('/phone-transactions-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await page.getByLabel('I authorize spins within this budget').check();await page.getByRole('button',{name:'Approve and play'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:false}).click();
 await expect(page.getByText('Confirmation temporarily unavailable.',{exact:false}).first()).toBeVisible();
 await expect(page.getByText('Paid spins are enabled on this iPad.',{exact:true})).toBeVisible({timeout:20000});
 expect(sends).toBe(1);expect(statusReads).toBe(3);expect(receiptReads).toBe(3);expect(activations).toBe(1);
 expect(await page.evaluate(address=>sessionStorage.getItem('slot-contract-tx:'+address),address)).toBeNull();
});

test('an interrupted confirmed approval can be checked and completed without another USDC transaction',async({page})=>{
 await setup(page,{paired:true,playActive:false,playPrepared:true,allowance:'5000000'});
 const id='c'.repeat(64),hash='0x'+'d'.repeat(64);let writes=0,receipts=0;
 await page.addInitScript(({address,id,hash})=>sessionStorage.setItem('slot-contract-tx:'+address,JSON.stringify({id,hash})),{address,id,hash});
 await page.route('**/api/relay/phone/approval',route=>route.fulfill({json:{configured:true,settings:{ticketPrice:'50000'},player:{balance:'100000000',allowance:'5000000',busy:false},gasMode:'usdc'}}));
 await page.route('**/api/contract/**',route=>{
  if(new URL(route.request().url()).pathname.endsWith('/receipt')){receipts++;return route.fulfill({status:receipts===1?503:200,json:receipts===1?{error:'RPC unavailable'}:{status:'confirmed'}});}
  writes++;return route.fulfill({status:500,json:{error:'Must not resend'}});
 });
 await page.goto('/phone-transactions-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await page.getByRole('button',{name:'Check transaction'}).click();
 await expect(page.getByText('Transaction confirmed on Base.',{exact:false})).toBeVisible();
 await page.getByLabel('I authorize spins within this budget').check();await page.getByRole('button',{name:'Enable this iPad'}).click();
 await expect(page.getByText('Paid spins are enabled on this iPad.',{exact:true})).toBeVisible();
 expect(writes).toBe(0);expect(receipts).toBe(2);
});


test('confirmation authentication failures keep the known hash without retrying or enabling paid spins',async({page})=>{
 await setup(page,{paired:true,playActive:false,allowance:'0'});
 const id='e'.repeat(64),hash='0x'+'f'.repeat(64);let sends=0,reads=0,activations=0;
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/relay/phone/play/activate')activations++;});
 await page.route('**/api/contract/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/prepare'))return route.fulfill({json:{id,address,action:'approveBudget',args:['5000000'],expiresAt:Date.now()+180000,transaction:{to:contract,data:'0x',chainId:8453,gasMode:'usdc'}}});
  if(path.endsWith('/send')){sends++;return route.fulfill({status:202,json:{id,hash,stage:'confirming'}});}
  if(path.endsWith('/receipt')){reads++;return route.fulfill({status:401,json:{error:'Sign in to verify'}});}
  throw Error('Known hashes must recover through receipts');
 });
 await page.goto('/phone-transactions-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await page.getByLabel('I authorize spins within this budget').check();await page.getByRole('button',{name:'Approve and play'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:false}).click();
 await expect(page.getByText('Sign in to verify',{exact:true}).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'Check transaction'})).toBeEnabled();
 await expect(page.getByRole('button',{name:'Complete the approval'})).toBeDisabled();
 expect(JSON.parse((await page.evaluate(address=>sessionStorage.getItem('slot-contract-tx:'+address),address))!)).toEqual({id,hash});
 await page.waitForTimeout(2200);expect(reads).toBe(1);expect(sends).toBe(1);expect(activations).toBe(0);
});

test('each linked session reuses its remaining allowance without an approval transaction',async({page})=>{
 const writes:string[]=[],budgets:string[]=[];
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/contract/'))writes.push(path);if(path==='/api/relay/phone/play/prepare'){const body=request.postDataJSON();expect(body.reuseAllowance).toBe(true);budgets.push(body.budget);}});
 for(const [sessionId,allowance] of [['first-session','2750000'],['second-session','1750000'],['tiny-allowance','1']]){
  await page.unrouteAll({behavior:'wait'});await setup(page,{paired:true,playActive:false,sessionId,allowance,...(allowance==='1'?{usdc:'0',eth:'0'}:{})});
  await page.goto('/phone-transactions-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByRole('button',{name:'Approve and play'})).toHaveCount(0);
  await expect(page.getByLabel('New total USDC limit')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Enable this iPad'})).toBeDisabled();
  await page.getByLabel('I authorize spins within this budget').check();
  await page.getByRole('button',{name:'Enable this iPad'}).click();
  await expect(page.getByText('Paid spins are enabled on this iPad.',{exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
 }
 expect(budgets).toEqual(['2750000','1750000','1']);expect(writes).toEqual([]);
});

for(const changed of ['0','7500000'])test(`a changed allowance (${changed}) never triggers an implicit approval`,async({page})=>{
 await setup(page,{paired:true,playActive:false});let prepares=0,writes=0;
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(path==='/api/relay/phone/play/prepare')prepares++;if(path.startsWith('/api/contract/'))writes++;});
 await page.route('**/api/relay/phone/approval',route=>route.fulfill({json:{configured:true,settings:{ticketPrice:'50000'},player:{balance:'100000000',allowance:changed,busy:false},gasMode:'usdc'}}));
 await page.goto('/phone-transactions-fixture');await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await page.getByLabel('I authorize spins within this budget').check();await page.getByRole('button',{name:'Enable this iPad'}).click();
 await expect(page.getByRole('alert').filter({hasText:'USDC limit changed'})).toBeVisible();
 await expect(page.getByRole('dialog')).toBeHidden();expect(prepares).toBe(0);expect(writes).toBe(0);
});
