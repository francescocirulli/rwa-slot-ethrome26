// Explicit live smoke test: creates a disposable Privy account and empty wallet.
// Run manually against a local server configured with real Privy credentials.
// Does not persist passkey keys, tokens, cookies, or browser storage to disk.
import {chromium} from '@playwright/test';
import {PNG} from 'pngjs';
import jsQR from 'jsqr';
import {mkdir, writeFile} from 'node:fs/promises';

const origin = process.env.LIVE_CHECK_ORIGIN || 'http://localhost:3002';
const browser = await chromium.launch({channel: 'chrome', headless: true});
const tabletContext = await browser.newContext({viewport: {width: 1024, height: 768},
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 12_5_8 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'});
const phoneContext = await browser.newContext({viewport: {width: 390, height: 844}});
const tablet = await tabletContext.newPage();
const phone = await phoneContext.newPage();
let stage = 'initialization';
const evidence = {date: new Date().toISOString(), realPrivy: true, virtualPasskey: true, transfers: false, steps: []};
function completed(name) {evidence.steps.push(name); console.log(`PASS: ${name}`);}
const failures = [];
for (const page of [tablet, phone]) {
  page.on('response', (response) => {
    if (response.url().includes('/api/relay/') && response.status() >= 400 &&
      !['/tablet', '/phone'].some((ending) => new URL(response.url()).pathname.endsWith(ending))) {
      failures.push({path: new URL(response.url()).pathname, status: response.status()});
    }
  });
}
try {
  await tablet.goto(origin);
  await tablet.locator('#login-qr:not([hidden])').waitFor({timeout: 30000});
  const image = PNG.sync.read(Buffer.from((await tablet.locator('#login-qr').getAttribute('src')).split(',')[1], 'base64'));
  const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  if (!decoded || new URL(decoded.data).origin !== origin) throw new Error('Invalid pairing QR');
  const cdp = await phoneContext.newCDPSession(phone);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {options: {protocol: 'ctap2', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
  await phone.goto(decoded.data);
  stage = 'Privy passkey signup';
  await phone.getByRole('button', {name: 'Prima volta? Crea una passkey'}).click({timeout: 30000});
  await phone.locator('.account-label').waitFor({timeout: 60000});
  completed(stage);
  stage = 'embedded wallet creation and tablet pairing';
  await phone.getByRole('checkbox', {name: /Il codice coincide/}).check();
  await phone.getByRole('button', {name: /Collega il wallet/}).click();
  await Promise.race([
    tablet.locator('#wallet-panel:not([hidden])').waitFor({timeout: 60000}),
    phone.locator('.phone-error').waitFor({timeout: 60000}).then(() => {throw new Error('Phone rejected pairing');}),
  ]);
  completed(stage);
  stage = 'signer authorization';
  await phone.getByRole('checkbox', {name: /Autorizzo la firma/}).check();
  await phone.getByRole('button', {name: /Autorizza e prendi posto/}).click({timeout: 30000});
  await Promise.race([
    phone.locator('.ready-card').waitFor({timeout: 60000}),
    phone.locator('.phone-error').waitFor({timeout: 60000}).then(() => {throw new Error('Phone rejected signer');}),
  ]);
  completed(stage);
  stage = 'proof with phone closed';
  await phone.close();
  await tablet.locator('#sign-button').click({timeout: 30000});
  await tablet.locator('#proof-toggle:not([hidden])').waitFor({timeout: 60000});
  completed(stage);
  stage = 'Base USDC balance read';
  await tablet.waitForFunction(() => document.getElementById('balance-status').textContent.includes('saldo aggiornato'), {timeout: 30000});
  completed(stage);
  stage = 'logout revokes tablet session';
  await tablet.locator('#logout').click();
  await tablet.locator('#login-qr:not([hidden])').waitFor({timeout: 15000});
  if ((await tablet.locator('#full-address').textContent()) !== '') throw new Error('Wallet data remained after logout');
  completed(stage);
  evidence.passed = true;
} catch (error) {
  evidence.passed = false; evidence.failedStage = stage; evidence.errorType = error.name;
  console.log(JSON.stringify({failedStage: stage, errorType: error.name, apiFailures: failures}));
  if (!phone.isClosed()) console.log('Phone notices:', await phone.locator('.phone-error,.phone-progress').allTextContents());
  console.log('Tablet notices:', await tablet.locator('#notice,#signature-title,#balance-status').allTextContents());
  process.exitCode = 1;
} finally {
  // Revoke only the test terminal's pair, including a fresh QR created by logout.
  await tablet.evaluate(async () => {
    await fetch('/api/relay/tablet/logout', {method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Slot-Request': '1'}, body: '{}'}).catch(() => {});
  }).catch(() => {});
  await mkdir('artifacts', {recursive: true});
  await writeFile('artifacts/live-privy-check.json', JSON.stringify(evidence, null, 2));
  await browser.close();
}
