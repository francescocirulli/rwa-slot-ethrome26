import {randomBytes} from 'node:crypto';
import {isHex,type Address,type Hex} from 'viem';
import type {WalletService,Wallet} from '../types';
import {SlotError} from '../slot/errors';
import {definiteSendFailure,type GasMode} from '../slot/gas';
import type {SubmittedSpin} from '../slot/engine';
import {personalWrites,type WriteCoordinator} from '../admin/write-coordinator';
import {withWalletAuthorization} from '../wallet-authorization';
import type {EnsService} from './service';
import {ENS_PARENT} from './config';

type Review={id:string;claimId:Hex;userId:string;wallet:Wallet;expires:number;transaction:{to:Address;data:Hex;chainId:number};stage:'prepared'|'sending'|'submitted'|'uncertain'|'failed';submission?:SubmittedSpin};
export function createEnsApi({service,walletService,origin,gasMode='usdc',writes=personalWrites()}:{service:EnsService|null;walletService?:WalletService;origin:string;gasMode?:GasMode;writes?:WriteCoordinator}){
  const reviews=new Map<string,Review>();
  const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization','Referrer-Policy':'no-referrer'}});
  return async(request:Request)=>{
    try{
      if(!['GET','POST'].includes(request.method))throw new SlotError('Method','Method not allowed.',405);
      if(request.method==='POST'&&(request.headers.get('origin')!==new URL(origin).origin||request.headers.get('x-slot-request')!=='1'))throw new SlotError('Origin','Invalid origin.',403);
      const token=request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1];
      if(!token||token.length>16000)throw new SlotError('Auth','Sign in to use ENS.',401);
      if(!walletService)throw new SlotError('Config','Wallet access is unavailable.',503);
      const user=await walletService.authenticate(token).catch(()=>{throw new SlotError('Auth','Access not verified.',401);});
      const wallet=user.wallets[0];if(!wallet)throw new SlotError('Wallet','Create your personal wallet first.',409);
      if(!service)return reply({configured:false,parent:ENS_PARENT,names:[],claims:[]});
      const owner=wallet.address as Address,url=new URL(request.url);
      if(request.method==='GET'){
        if(url.searchParams.has('label'))return reply(await service.available(url.searchParams.get('label')));
        const [names,claims]=await Promise.all([service.names(owner),service.claims(owner)]);
        return reply({configured:true,parent:ENS_PARENT,names,claims});
      }
      if(!request.headers.get('content-type')?.startsWith('application/json'))throw new SlotError('Input','Expected JSON.',415);
      const chunks:Uint8Array[]=[];let bytes=0;const reader=request.body?.getReader();
      if(reader)while(true){const c=await reader.read();if(c.done)break;bytes+=c.value.length;if(bytes>2048){await reader.cancel();throw new SlotError('Input','Request too large.',413);}chunks.push(c.value);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new SlotError('Input','Invalid JSON.',400);}
      const action=body?.action;
      if(action==='reserve'){
        if(body.confirm!==true)throw new SlotError('Consent','Confirm the requested name.',400);
        return reply(await service.reserve(owner,body.label));
      }
      if(action==='complete'){
        if(body.confirm!==true||!isHex(body.claimId)||body.claimId.length!==66)throw new SlotError('Input','Invalid claim.',400);
        return reply(await service.fulfill(owner,body.claimId));
      }
      if(action==='prepare'){
        if(!isHex(body.claimId)||body.claimId.length!==66)throw new SlotError('Input','Invalid claim.',400);
        for(const [id,r] of reviews)if(r.stage==='prepared'&&r.expires<Date.now()){reviews.delete(id);writes.release(r.wallet.address.toLowerCase(),id);}
        if(reviews.size>=256)throw new SlotError('EnsBusy','Too many pending ENS requests.',503);
        const claim=await service.getClaim(body.claimId,owner),id=randomBytes(32).toString('hex');
        await writes.acquire(owner.toLowerCase(),id,async()=>{
          const saved=reviews.get(id);
          if(!saved)return true;
          if(saved.stage==='failed'||saved.stage==='prepared'&&saved.expires<Date.now())return true;
          return (await service.getClaim(saved.claimId,owner)).stage!=='voucher';
        });
        try{
          const transaction=await service.prepareVoucher(owner,body.claimId);
          const r:Review={id,claimId:body.claimId,userId:user.userId,wallet,transaction,expires:Date.now()+90000,stage:'prepared'};
          reviews.set(id,r);
          // Expired, unsubmitted reviews must not lock spins/transfers indefinitely.
          const timer=setTimeout(()=>{if(r.stage==='prepared'){reviews.delete(id);writes.release(owner.toLowerCase(),id);}},91000);timer.unref();
          return reply({id,claimId:r.claimId,name:claim.name,address:owner,quantity:1,gasMode,expires:r.expires});
        }catch(error){writes.release(owner.toLowerCase(),id);throw error;}
      }
      const r=typeof body.id==='string'?reviews.get(body.id):undefined;
      if(!r||r.userId!==user.userId||r.wallet.id!==wallet.id)throw new SlotError('EnsReview','Review unavailable. Check your onchain claim before preparing another.',404);
      if(action==='cancel'){
        if(r.stage!=='prepared')throw new SlotError('EnsPending','Submission is under verification.',409);
        reviews.delete(r.id);writes.release(owner.toLowerCase(),r.id);return reply({cancelled:true});
      }
      if(action==='status'){
        const claim=await service.getClaim(r.claimId,owner);
        if(claim.stage!=='voucher'){writes.release(owner.toLowerCase(),r.id);reviews.delete(r.id);}
        if(r.submission&&walletService.resolveSpin){try{await walletService.resolveSpin(r.submission);}catch(error){if(definiteSendFailure(error)){r.stage='failed';writes.release(owner.toLowerCase(),r.id);}}}
        return reply({stage:r.stage,claim,submission:r.submission});
      }
      if(action!=='send'||body.confirm!==true)throw new SlotError('Input','Invalid ENS operation.',400);
      if(r.stage!=='prepared')return reply({stage:r.stage,submission:r.submission});
      if(r.expires<Date.now())throw new SlotError('EnsReview','Review expired. Prepare again.',409);
      if(!walletService.sendOwned)throw new SlotError('Config','Wallet signing unavailable.',503);
      r.stage='sending';
      try{
        const assertValid=async()=>{const current=await walletService.authenticate(token);if(!current.wallets.some(w=>w.id===wallet.id&&w.address.toLowerCase()===owner.toLowerCase()))throw new SlotError('Auth','Wallet access changed.',403);};
        await assertValid();
        // Both client confirmation and the exact Privy request bytes are authorized.
        r.submission=await withWalletAuthorization(request,user,authorization=>walletService.sendOwned!(wallet,authorization,r.transaction,'ens-voucher:'+r.claimId,gasMode,()=>{},assertValid));
        r.stage='submitted';return reply({stage:r.stage,submission:r.submission});
      }catch(error){r.stage=definiteSendFailure(error)?'failed':'uncertain';if(r.stage==='failed')writes.release(owner.toLowerCase(),r.id);throw error;}
    }catch(error){
      if(error instanceof SlotError)return reply({error:error.message,code:error.code},error.status);
      // Provider errors can contain auth payloads, RPC endpoints and signatures.
      return reply({error:'ENS operation unavailable or under verification. Refresh your claim before trying again.',code:'EnsUnavailable'},503);
    }
  };
}
