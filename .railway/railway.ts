import {defineRailway, github, preserve, project, service} from 'railway/iac';

export default defineRailway(() => {
  const web = service('web', {
    source: github('francescocirulli/rwa-slot-ethrome26', {branch: 'main'}),
    root: '/apps/web',
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'Dockerfile',
      watchPatterns: ['/apps/web/**'],
    },
    healthcheck: '/api/health',
    healthcheckTimeout: 60,
    replicas: 1,
    deploy: {
      sleepApplication: false,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 3,
      overlapSeconds: 0,
      drainingSeconds: 0,
    },
    env: {
      NODE_ENV: 'production',
      HOSTNAME: '0.0.0.0',
      PORT: '3000',
      // Values are provisioned directly in Railway. A plan never exports them
      // or replaces a real backend key with the initial REPLACE_ME placeholder.
      APP_ORIGIN: preserve(),
      NEXT_PUBLIC_PRIVY_APP_ID: preserve(),
      PRIVY_APP_SECRET: preserve(),
      ADMIN_OWNER_USER_ID: preserve(),
      ADMIN_WALLET_EXTERNAL_ID: preserve(),
      PRIVY_GAS_MODE: preserve(),
      BASE_RPC_URL: preserve(),
      SLOT_CONTRACT_ADDRESS: preserve(),
      SLOT_DEPLOYMENT_BLOCK: preserve(),
      SLOT_BACKEND_PRIVATE_KEY: preserve(),
      LIFI_API_KEY: preserve(),
      SLOT_HARDWARE_TOKEN: preserve(),
    },
  });
  return project('rwa-slot-ethrome26', {resources: [web]});
});
