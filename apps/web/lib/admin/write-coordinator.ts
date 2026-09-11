import {SlotError} from '../slot/errors';
type Lease={id:string;done:()=>Promise<boolean>};
// One shared wallet must not start a swap while an admin contract call is pending (or vice versa).
export function createWriteCoordinator(){
  const leases=new Map<string,Lease>();
  return {async acquire(walletId:string,id:string,done:Lease['done']){
    while(true){
      const previous=leases.get(walletId);
      if(previous?.id===id)return;
      if(previous){const finished=await previous.done();if(leases.get(walletId)!==previous)continue;if(!finished)throw new SlotError('WalletBusy','Il wallet condiviso ha un’operazione in corso. Verificala prima di continuare.',409);}
      leases.set(walletId,{id,done});return;
    }
  },release(walletId:string,id:string){if(leases.get(walletId)?.id===id)leases.delete(walletId);}};
}
export type WriteCoordinator=ReturnType<typeof createWriteCoordinator>;
const shared=globalThis as typeof globalThis&{adminWrites?:WriteCoordinator};
export function adminWrites(){return shared.adminWrites||=createWriteCoordinator();}
