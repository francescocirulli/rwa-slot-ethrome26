import {randomBytes} from 'node:crypto';
import type {Identity,WalletAuthorization} from './types';
import {SlotError} from './slot/errors';

const key=()=>randomBytes(32).toString('hex');
const cancelled=()=>new SlotError('Cancelled','Wallet authorization interrupted or expired. Confirm the operation again.',409);
export const authorizationPaths=new Set(['/api/admin/member','/api/admin/proof','/api/admin/assets/execute','/api/admin/contract/send','/api/contract/send']);
type Challenge={id:string;payload:string;resolve:(signature:string)=>void;reject:(error:Error)=>void};
type Channel={userId:string;path:string;claimed:boolean;closed:boolean;challenge?:Challenge;wake:Set<()=>void>;timer:ReturnType<typeof setTimeout>};

// Only exact SDK request bytes and their signatures cross this channel. User
// keys stay in Privy's browser SDK; this does not grant membership or custody.
export function createWalletAuthorizations(ttl=90000) {
  const channels=new Map<string,Channel>();
  const notify=(channel:Channel)=>{for(const wake of channel.wake)wake();channel.wake.clear();};
  function close(channel:Channel) {
    channel.closed=true;channel.challenge?.reject(cancelled());channel.challenge=undefined;notify(channel);
  }
  function owned(id:unknown,userId:string) {
    const channel=typeof id==='string'?channels.get(id):undefined;
    if(!channel||channel.userId!==userId)throw new SlotError('WalletAuthorization','Wallet authorization not available for this account.',404);
    return channel;
  }
  return {
    create(userId:string,path:unknown) {
      if(typeof path!=='string'||!authorizationPaths.has(path))throw new SlotError('Input','Invalid wallet operation.',400);
      const active=[...channels.values()].filter(channel=>!channel.closed);
      if(active.length>=32||active.filter(channel=>channel.userId===userId).length>=2||channels.size>=256)throw new SlotError('WalletBusy','Wait for the current authorization to finish.',429);
      const id=key();
      const timer=setTimeout(()=>{const channel=channels.get(id);if(channel)close(channel);channels.delete(id);},ttl);timer.unref();
      channels.set(id,{userId,path,claimed:false,closed:false,wake:new Set(),timer});
      return {id};
    },
    async poll(id:unknown,userId:string) {
      const channel=owned(id,userId);
      if(!channel.challenge&&!channel.closed)await new Promise<void>(resolve=>{
        const wake=()=>{clearTimeout(timer);channel.wake.delete(wake);resolve();};
        const timer=setTimeout(wake,1000);channel.wake.add(wake);
      });
      return {state:channel.closed?'done' as const:channel.challenge?'sign' as const:'waiting' as const,claimed:channel.claimed,
        ...(channel.challenge?{challenge:{id:channel.challenge.id,payload:channel.challenge.payload}}:{})};
    },
    sign(id:unknown,userId:string,challengeId:unknown,signature:unknown) {
      const channel=owned(id,userId),challenge=channel.challenge;
      if(channel.closed||!challenge||challenge.id!==challengeId)throw cancelled();
      if(typeof signature!=='string'||signature.length>256||!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)||Buffer.from(signature,'base64').length<64)throw new SlotError('Input','Invalid authorization signature.',400);
      channel.challenge=undefined;challenge.resolve(signature);notify(channel);
    },
    cancel(id:unknown,userId:string){close(owned(id,userId));},
    async run<T>(id:unknown,userId:string,path:string,work:(authorization:WalletAuthorization)=>Promise<T>):Promise<T> {
      const channel=owned(id,userId);
      if(channel.closed||channel.claimed||channel.path!==path)throw cancelled();
      channel.claimed=true;
      try{return await work({sign_fns:[async payload=>{
        if(channel.closed||channel.challenge||payload.byteLength>131072)throw cancelled();
        const signature=await new Promise<string>((resolve,reject)=>{channel.challenge={id:key(),payload:Buffer.from(payload).toString('base64'),resolve,reject};notify(channel);});
        if(channel.closed)throw cancelled();
        return signature;
      }]});}finally{close(channel);}
    },
    dispose(){for(const channel of channels.values()){close(channel);clearTimeout(channel.timer);}channels.clear();},
  };
}
const state=globalThis as typeof globalThis&{walletAuthorizations?:ReturnType<typeof createWalletAuthorizations>};
export const walletAuthorizations=()=>state.walletAuthorizations??=createWalletAuthorizations();
export function withWalletAuthorization<T>(request:Request,user:Identity,work:(authorization:WalletAuthorization)=>Promise<T>) {
  return walletAuthorizations().run(request.headers.get('x-wallet-authorization'),user.userId,new URL(request.url).pathname,work);
}
