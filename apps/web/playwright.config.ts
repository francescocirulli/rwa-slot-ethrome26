import {defineConfig} from '@playwright/test';
import {fixtureOrigin} from './tests/browser/origin';
export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 30000,
  use: {baseURL: fixtureOrigin, channel: process.env.CI ? undefined : 'chrome', headless: true, viewport: {width: 1024, height: 768}},
  webServer: {command: 'npx tsx tests/browser/server.ts', url: fixtureOrigin+'/api/health', env:{FIXTURE_ORIGIN:fixtureOrigin,FIXTURE_PORT:new URL(fixtureOrigin).port||'3101'}, reuseExistingServer: false, timeout: 20000},
});
