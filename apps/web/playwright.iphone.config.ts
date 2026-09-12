import {defineConfig, devices} from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: ['phone.spec.ts','ens.spec.ts','explorer.spec.ts'],
  // These three camera mocks require canvas.captureStream(), unavailable in WebKit.
  // The default Chrome suite still exercises QR decoding and camera cleanup.
  grepInvert: /camera scanner|denied camera|closing scanner/,
  use: {...base.use, ...devices['iPhone 13'], browserName: 'webkit', channel: undefined},
});
