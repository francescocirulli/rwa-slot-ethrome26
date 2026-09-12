import {defineConfig} from '@playwright/test';
const port=process.env.ENS_TEST_PORT||'3176',baseURL='http://localhost:'+port;
export default defineConfig({
  testDir:'./tests/browser',testMatch:'ens.spec.ts',workers:1,timeout:30000,
  use:{baseURL,channel:process.env.CI?undefined:'chrome',headless:true},
  webServer:{command:'npx tsx tests/browser/server.ts',url:baseURL+'/api/health',
    env:{FIXTURE_PORT:port,FIXTURE_ORIGIN:baseURL},reuseExistingServer:false,timeout:20000},
});
