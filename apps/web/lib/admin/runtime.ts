import {createSwapService,createSwapChain} from './swaps';
import {createLifiClient} from './lifi';
import {createInventoryReader} from './inventory';
import {createAssetsHandler} from './assets-api';
import {adminWrites} from './write-coordinator';
import {PrivyClient} from '@privy-io/node';
import {isAddress,type Address} from 'viem';
import {createWalletAuthorizationHandler} from '../wallet-authorization-api';
import {createWalletService} from '../privy';
import {createBalanceReader} from '../balance';
import {createAdminService} from './service';
import {createAdminHandler} from './api';
import {prizeCollectionAddress} from '../prize-collection';
import {loadAdminWalletExternalId} from './config';
const global=globalThis as typeof globalThis&{sharedAdmin?:ReturnType<typeof build>};
function build() {
  const appId=process.env.NEXT_PUBLIC_PRIVY_APP_ID,secret=process.env.PRIVY_APP_SECRET,ownerId=process.env.ADMIN_OWNER_USER_ID;
  if(ownerId&&!/^did:privy:[a-zA-Z0-9_-]{5,100}$/.test(ownerId))throw new Error('Invalid ADMIN_OWNER_USER_ID');
  const client=appId&&secret?new PrivyClient({appId,appSecret:secret,maxRetries:0,timeout:20000}):undefined;
  const contract=()=>{const address=process.env.SLOT_CONTRACT_ADDRESS;return address&&isAddress(address)?address as Address:null;};
  const externalId=loadAdminWalletExternalId(process.env.ADMIN_WALLET_EXTERNAL_ID);
  const collection=prizeCollectionAddress(process.env.SLOT_PRIZE1155_ADDRESS);
  const service=client?createAdminService(client,ownerId,contract,externalId,collection):undefined;
  const walletService=appId&&secret?createWalletService(appId,secret):undefined;
  const origin=process.env.APP_ORIGIN||(process.env.RAILWAY_PUBLIC_DOMAIN?`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`:'http://localhost:3000');
  return {service,authorization:createWalletAuthorizationHandler({walletService,origin}),assets:createAssetsHandler({admin:service,walletService,swaps:client&&service&&walletService?createSwapService({client,walletService,admin:service,chain:createSwapChain(process.env.BASE_RPC_URL),getQuote:createLifiClient(fetch,process.env.LIFI_API_KEY),coordinator:adminWrites()}):undefined,inventory:createInventoryReader(process.env.BASE_RPC_URL,collection),contract,origin}),handle:createAdminHandler({service,walletService,origin,readBalance:createBalanceReader(process.env.BASE_RPC_URL)})};
}
export function getAdminRuntime(){return global.sharedAdmin||=build();}
