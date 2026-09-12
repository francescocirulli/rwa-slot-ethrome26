import {adminWrites,personalWrites} from '../admin/write-coordinator';
import {createContractApi} from './transactions';
import {getSlotEngine} from './runtime';
import {createWalletService} from '../privy';
import {getAdminRuntime} from '../admin/runtime';
const global=globalThis as typeof globalThis & {slotContractApi?:ReturnType<typeof createContractApi>};
export function getContractApi() {
  return global.slotContractApi ||= createContractApi({getSlot:getSlotEngine,coordinator:adminWrites(),personalCoordinator:personalWrites(),admin:getAdminRuntime().service,
    origin:process.env.APP_ORIGIN||(process.env.RAILWAY_PUBLIC_DOMAIN?`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`:'http://localhost:3000'),
    walletService:process.env.NEXT_PUBLIC_PRIVY_APP_ID&&process.env.PRIVY_APP_SECRET?createWalletService(process.env.NEXT_PUBLIC_PRIVY_APP_ID,process.env.PRIVY_APP_SECRET):undefined});
}
