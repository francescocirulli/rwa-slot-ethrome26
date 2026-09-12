import {ensConfig} from './config';
import {createEnsService} from './service';
import {createEnsApi} from './api';
import {loadBackendPrivateKey} from '../slot/backend-key';
import {createWalletService} from '../privy';
const shared=globalThis as typeof globalThis&{ensApi?:ReturnType<typeof createEnsApi>};
export function ensApi(){
  if(!shared.ensApi){
    const config=ensConfig(),appId=process.env.NEXT_PUBLIC_PRIVY_APP_ID,secret=process.env.PRIVY_APP_SECRET;
    const service=config?createEnsService(config,loadBackendPrivateKey()):null;
    service?.start();
    shared.ensApi=createEnsApi({service,
      walletService:appId&&secret?createWalletService(appId,secret):undefined,
      origin:process.env.APP_ORIGIN||(process.env.RAILWAY_PUBLIC_DOMAIN?`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`:'http://localhost:3000'),
      retrySecret:secret,
      gasMode:process.env.PRIVY_GAS_MODE==='eth'?'eth':'usdc'});
  }
  return shared.ensApi;
}
