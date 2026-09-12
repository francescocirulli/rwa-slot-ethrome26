import {createAccountWelcomeHandler} from '@/lib/account-welcome';
import {createWalletService} from '@/lib/privy';
import {createWelcomeService} from '@/lib/welcome';
import {getSlotEngine} from '@/lib/slot/runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
let handler:ReturnType<typeof createAccountWelcomeHandler>|undefined;
export function POST(request:Request) {
  if(!handler){
    const appId=process.env.NEXT_PUBLIC_PRIVY_APP_ID,secret=process.env.PRIVY_APP_SECRET;
    const wallets=appId&&secret?createWalletService(appId,secret):undefined;
    const slot=getSlotEngine();
    const origin=process.env.APP_ORIGIN||(process.env.RAILWAY_PUBLIC_DOMAIN?`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`:process.env.NODE_ENV!=='production'?'http://localhost:3000':'');
    handler=createAccountWelcomeHandler(wallets,wallets&&slot?createWelcomeService(wallets,slot):undefined,origin);
  }
  return handler(request);
}
