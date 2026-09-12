import {test,expect,type Page} from '@playwright/test';
import QRCode from 'qrcode';
import {WALLET_ASSETS,NFT_PRIZES} from '../../lib/assets';
import {BASE_PRIZE_COLLECTION,BASE_PRIZE_IDS} from '../../lib/prize-collection';
const address='0x0000000000000000000000000000000000000011',recipient='0x0000000000000000000000000000000000000022',contract='0x0000000000000000000000000000000000000099';
async function setup(page:Page,{paired=false,busy=false,unavailable=false}={}) {
  let connected=paired;
  const session=()=>({id:'fixture-session',state:'active',address,code:'123456',serverTime:Date.now(),expiresAt:Date.now()+180000,welcome:{status:'granted',amount:'2'},playGrant:{active:true,budget:'5000000'}});
  await page.route('**/api/account',async route=>route.fulfill({json:{userId:'fixture-user',wallet:{address,depositQr:'data:image/gif;base64,R0lGODlhAQABAAAAACw=',balance:{amount:'10',stale:false,updatedAt:Date.now()},portfolio:unavailable?null:{address,chainId:8453,contract,updatedAt:Date.now(),eth:'0.001',allowance:'2500000',freeSpins:'2',ticketPrice:'50000',busy,canTransact:!busy,gameId:busy?'4':null,gasMode:'usdc',assets:WALLET_ASSETS.map(asset=>({...asset,balance:'100000000',formatted:asset.decimals===8?'1':'10',verified:true})),nfts:NFT_PRIZES.map(nft=>({...nft,token:BASE_PRIZE_COLLECTION,tokenId:BASE_PRIZE_IDS[nft.symbol],balance:'2'}))}}}}));
  await page.route('**/api/relay/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/phone/logout')){connected=false;return route.fulfill({json:{ok:true}});}
    if(path.endsWith('/lookup'))return route.fulfill({json:{code:'123456',origin:'http://localhost:3101',expiresAt:Date.now()+300000}});
    if(path.endsWith('/approve')){connected=true;return route.fulfill({json:session()});}
    if(path.endsWith('/phone/activity'))return route.fulfill({json:{...session(),sessionId:'fixture-session'}});
    if(path.endsWith('/phone/game'))return route.fulfill({json:{configured:true,settings:{ticketPrice:'50000'},player:{freeSpins:'2',allowance:'2500000',game:{id:'4',pending:busy}},gasMode:'usdc'}});
    return connected?route.fulfill({json:session()}):route.fulfill({status:401,json:{error:'No iPad linked'}});
  });
  await page.setViewportSize({width:390,height:844});
}
test('standalone wallet shows allowance and all prizes; transfer requires readable review and explicit confirmation',async({page})=>{
  await setup(page);await page.goto('/phone-fixture');
  await expect(page.getByText('No iPad linked to this page')).toBeVisible();
  await expect(page.getByLabel('Wallet address',{exact:true})).toHaveText(address);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{document.body.dataset.copiedAddress=value;}}}));
  await page.getByRole('button',{name:'Copy address',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-copied-address',address);
  await expect(page.getByRole('button',{name:'Address copied'})).toBeVisible();
  await expect(page.getByText('2.5 USDC',{exact:true})).toBeVisible();
  await expect(page.locator('b').filter({hasText:'GOLD · DGLD'})).toBeVisible();
  await page.screenshot({path:'/tmp/phone-wallet-standalone.png',fullPage:true});
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
  await page.getByRole('button',{name:'Send Magnet'}).click();await page.getByLabel('External recipient address').fill(recipient);await page.getByLabel('NFT quantity (whole)').fill('1.5');await page.getByRole('button',{name:'Review transfer'}).click();
  await expect(page.getByRole('dialog')).toBeHidden();await expect(page.getByText('Amount above the available balance or invalid.')).toBeVisible();
  await page.getByLabel('NFT quantity (whole)').fill('2');await page.getByRole('button',{name:'Review transfer'}).click();await expect(page.getByText('2 NFT · ID 5',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByLabel('New total USDC limit').fill('3');await page.getByRole('button',{name:'Review approval'}).click();await expect(page.getByRole('dialog').getByText('3 USDC',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Revoke USDC approval'}).click();await expect(page.getByRole('dialog').getByText('0 USDC',{exact:true})).toBeVisible();
});
test('ending pairing keeps wallet signed in; logout returns to standalone login',async({page})=>{
  await setup(page,{paired:true});await page.goto('/phone-fixture');
  await page.getByRole('button',{name:'End the iPad link'}).click();
  await expect(page.getByText('ACCOUNT CONNECTED',{exact:false})).toBeVisible();await expect(page.locator('b').filter({hasText:'GOLD · DGLD'})).toBeVisible();await expect(page.getByText('2.5 USDC',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign out of the wallet'}).click();await expect(page.getByRole('button',{name:'Sign in with passkey'})).toBeVisible();await expect(page.locator('b').filter({hasText:'GOLD · DGLD'})).toBeHidden();
  await page.getByRole('button',{name:'Sign in with passkey'}).click();await expect(page.locator('b').filter({hasText:'GOLD · DGLD'})).toBeVisible();
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
  await page.clock.fastForward(181000);await expect(page.getByRole('button',{name:'End the iPad link'})).toBeHidden();await expect(page.locator('b').filter({hasText:'GOLD · DGLD'})).toBeVisible();
});
test('pending spin disables wallet writes; unavailable reads never look like zero holdings',async({page})=>{
  await setup(page,{paired:true,busy:true});await page.goto('/phone-fixture');
  await expect(page.getByText('Spin in progress #4.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Review approval'})).toBeDisabled();await expect(page.getByRole('button',{name:'Send NVIDIA · NVDAc'})).toBeDisabled();
  await page.unrouteAll({behavior:'wait'});await setup(page,{unavailable:true});await page.goto('/phone-fixture');
  await expect(page.getByText('Prize balances and approval unavailable.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Review approval'})).toBeDisabled();
});


test('camera scanner decodes the iPad QR locally, stops the camera and requires explicit pairing confirmation',async({page})=>{
  await setup(page);
  const secret='a'.repeat(64),picture=await QRCode.toDataURL('http://localhost:3101/phone#pair='+secret,{width:512,margin:4});
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
  await page.getByRole('button',{name:'Scansiona QR dell’iPad'}).click();
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
  await page.goto('/phone-fixture');await page.getByRole('button',{name:'Scansiona QR dell’iPad'}).click();
  await expect(page.getByText('Consenti l’accesso alla fotocamera',{exact:false})).toBeVisible();
  const secret='b'.repeat(64),image=async(origin:string)=>({name:'qr.png',mimeType:'image/png',buffer:await QRCode.toBuffer(origin+'/phone#pair='+secret,{width:512,margin:4})});
  await page.locator('input[type=file]').setInputFiles(await image('https://other.example'));
  await expect(page.getByText('Scansiona il QR mostrato da questa app sull’iPad.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Link the wallet'})).toBeHidden();
  await page.locator('input[type=file]').setInputFiles(await image('http://localhost:3101'));
  await expect(page.getByLabel('The code matches.')).toBeVisible();await expect(page.getByRole('dialog')).toBeHidden();
});

test('closing scanner while permission is pending stops a late camera stream',async({page})=>{
  await setup(page);
  await page.addInitScript(()=>{Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>new Promise(resolve=>{(window as any).allowCamera=()=>{
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const stream=canvas.captureStream();(window as any).cameraTrack=stream.getTracks()[0];resolve(stream);
  };})}});});
  await page.goto('/phone-fixture');await page.getByRole('button',{name:'Scansiona QR dell’iPad'}).click();await page.getByRole('button',{name:'Chiudi scanner'}).click();
  await page.evaluate(()=>(window as any).allowCamera());
  await expect.poll(()=>page.evaluate(()=>(window as any).cameraTrack.readyState)).toBe('ended');
  await expect(page.getByRole('dialog')).toBeHidden();
});
