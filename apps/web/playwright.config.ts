import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 30000,
  use: {baseURL: 'http://localhost:3101', channel: process.env.CI ? undefined : 'chrome', headless: true, viewport: {width: 1024, height: 768}},
  webServer: {command: 'npx tsx tests/browser/server.ts', url: 'http://localhost:3101/api/health', reuseExistingServer: false, timeout: 20000},
});
