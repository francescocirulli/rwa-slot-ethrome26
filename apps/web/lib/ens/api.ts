import {randomBytes} from 'node:crypto';
import {isHex,type Address,type Hex} from 'viem';
import type {WalletService,Wallet} from '../types';
import {SlotError} from '../slot/errors';
import {definiteSendFailure,transactionError,type GasMode} from '../slot/gas';
import type {SubmittedSpin} from '../slot/engine';
import {personalWrites,type WriteCoordinator} from '../admin/write-coordinator';
import {withWalletAuthorization} from '../wallet-authorization';
import type {EnsService} from './service';
import {ENS_PARENT} from './config';
import {retryEnsRead} from './read-check';
import {createEnsRetries,ensDefiniteFailure,ensRetryableRejection} from './retry';

type Review={id:string;claimId:Hex;userId:string;wallet:Wallet;expires:number;transaction:{to:Address;data:Hex;chainId:number};stage:'preparing'|'prepared'|'sending'|'submitted'|'uncertain'|'failed';submission?:SubmittedSpin;attempt:number;retryToken?:string};
export function createEnsApi({service,walletService,origin,gasMode='usdc',writes=personalWrites(),retrySecret}:{service:EnsService|null;walletService?:WalletService;origin:string;gasMode?:GasMode;writes?:WriteCoordinator;retrySecret?:string}){
  const reviews=new Map<string,Review>(),preparing=new Set<string>();
  const retries=retrySecret?createEnsRetries(retrySecret):undefined;
  const retryScope=(r:Pick<Review,'userId'|'wallet'|'claimId'>)=>JSON.stringify([r.userId,r.wallet.id,r.wallet.address.toLowerCase(),r.claimId]);
  const view=(r:Review,name:string)=>({id:r.id,claimId:r.claimId,name,address:r.wallet.address,quantity:1,registrationPayer:'backend',gasMode,expires:r.expires});
  async function hold(r:Review){
    await writes.acquire(r.wallet.address.toLowerCase(),r.id,async()=>{
      if(r.stage==='preparing')return false;
      if(r.stage==='failed'||r.stage==='prepared'&&r.expires<Date.now())return true;
      return (await service!.getClaim(r.claimId,r.wallet.address as Address)).stage!=='voucher';
    });
  }
  const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization','Referrer-Policy':'no-referrer'}});
  return async(request:Request)=>{
    let phase='read';
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
      if(['reserve','prepare','send','status','cancel','complete'].includes(action))phase=action;
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
        const attempt=retries?retries.read(retryScope({userId:user.userId,wallet,claimId:body.claimId}),body.retryToken):0;
        if(body.retryToken&&!retries)throw new SlotError('EnsRetry','Voucher recovery is not configured.',503);
        if(preparing.has(wallet.id))throw new SlotError('EnsBusy','Your voucher review is being prepared. Wait a moment, then continue.',409);
        preparing.add(wallet.id);
        try{
          for(const [id,r] of reviews)if(r.stage==='prepared'&&r.expires<Date.now()){reviews.delete(id);writes.release(r.wallet.address.toLowerCase(),id);}
          const previous=[...reviews.values()].find(r=>r.userId===user.userId&&r.wallet.id===wallet.id&&r.claimId===body.claimId&&r.stage!=='failed');
          if(previous&&['sending','submitted','uncertain'].includes(previous.stage))throw new SlotError('EnsPending','Your redemption is already being confirmed.',409);
          // Recover a review whose response was lost, without replacing its lease
          // or creating another transfer. Sending still rechecks the exact bytes.
          if(previous?.stage==='prepared'){
            const claim=await retryEnsRead('review',()=>service.getClaim(body.claimId,owner));
            if(claim.stage!=='voucher')throw new SlotError('EnsConsumed','Your voucher is already recorded. Refresh to follow registration.',409);
            await hold(previous);return reply(view(previous,claim.name));
          }
          if(reviews.size>=256)throw new SlotError('EnsBusy','Too many pending ENS requests.',503);
          const id=randomBytes(32).toString('hex');
          const r:Review={id,attempt,claimId:body.claimId,userId:user.userId,wallet,transaction:{to:owner,data:'0x',chainId:8453},expires:Date.now()+90000,stage:'preparing'};
          await hold(r);
          try{
            const {claim,transaction}=await retryEnsRead('review',()=>service.prepareReview(owner,body.claimId));
            r.transaction=transaction;
            r.expires=Date.now()+90000;r.stage='prepared';reviews.set(id,r);
            const timer=setTimeout(()=>{if(r.stage==='prepared'){reviews.delete(id);writes.release(owner.toLowerCase(),id);}},91000);timer.unref();
            return reply(view(r,claim.name));
          }catch(error){writes.release(owner.toLowerCase(),id);throw error;}
        }finally{preparing.delete(wallet.id);}
      }
      const r=typeof body.id==='string'?reviews.get(body.id):undefined;
      if(!r||r.userId!==user.userId||r.wallet.id!==wallet.id)throw new SlotError('EnsReview','Review unavailable. Check your onchain claim before preparing another.',404);
      if(action==='cancel'){
        if(r.stage!=='prepared')throw new SlotError('EnsPending','Submission is under verification.',409);
        reviews.delete(r.id);writes.release(owner.toLowerCase(),r.id);return reply({cancelled:true});
      }
      if(action==='status'){
        if(r.stage==='failed')return reply({stage:r.stage,retryToken:r.retryToken});
        if(r.stage==='prepared'&&r.expires<Date.now()){r.stage='failed';writes.release(owner.toLowerCase(),r.id);return reply({stage:r.stage});}
        const claim=await service.getClaim(r.claimId,owner);
        if(claim.stage!=='voucher')writes.release(owner.toLowerCase(),r.id);
        if(claim.stage==='ready'||claim.stage==='registered')reviews.delete(r.id);
        if(r.submission&&walletService.resolveSpin){try{await walletService.resolveSpin(r.submission);}catch(error){if(definiteSendFailure(error)){r.stage='failed';writes.release(owner.toLowerCase(),r.id);}}}
        return reply({stage:r.stage,claim,submission:r.submission});
      }
      if(action!=='send'||body.confirm!==true)throw new SlotError('Input','Invalid ENS operation.',400);
      if(r.stage!=='prepared')return reply({stage:r.stage,submission:r.submission});
      if(r.expires<Date.now()){r.stage='failed';writes.release(owner.toLowerCase(),r.id);return reply({error:'Review expired. Continue to prepare a new review.',code:'EnsReview',stage:'failed'},409);}
      if(!walletService.sendOwned)throw new SlotError('Config','Wallet signing unavailable.',503);
      r.stage='sending';let attempted=false,check='wallet-access';
      try{
        const assertValid=async()=>{const current=await walletService.authenticate(token);if(!current.wallets.some(w=>w.id===wallet.id&&w.address.toLowerCase()===owner.toLowerCase()))throw new SlotError('Auth','Wallet access changed.',403);};
        await assertValid();
        check='voucher';
        const currentTransaction=await retryEnsRead('send-check',()=>service.prepareVoucher(owner,r.claimId));
        check='wallet-access';await assertValid();
        if(r.expires<Date.now())throw new SlotError('EnsReview','Review expired. Continue to prepare a new review.',409);
        if(currentTransaction.to!==r.transaction.to||currentTransaction.data!==r.transaction.data||currentTransaction.chainId!==r.transaction.chainId)throw new SlotError('EnsReview','Voucher review changed. Prepare again.',409);
        // Both client confirmation and the exact Privy request bytes are authorized.
        check='submission';attempted=true;
        r.submission=await withWalletAuthorization(request,user,async authorization=>{
          const send=()=>walletService.sendOwned!(wallet,authorization,r.transaction,'ens-voucher:'+r.claimId+(r.attempt?':retry:'+r.attempt:''),gasMode,()=>{},assertValid);
          try{return await send();}catch(error){
            // Privy caches terminal errors as well as successful sends. Permit
            // one fresh request under the same explicit voucher confirmation.
            // Never advance after an unknown result or idempotency conflict.
            if(!retries||!ensRetryableRejection(error)||r.attempt>=1024)throw error;
            r.attempt++;
            const refreshed=await retryEnsRead('send-check',()=>service.prepareVoucher(owner,r.claimId));
            if(r.expires<Date.now())throw new SlotError('EnsReview','Review expired. Continue to prepare a new review.',409);
            if(refreshed.to!==r.transaction.to||refreshed.data!==r.transaction.data||refreshed.chainId!==r.transaction.chainId)throw new SlotError('EnsReview','Voucher review changed. Prepare again.',409);
            return send();
          }
        });
        r.stage='submitted';return reply({stage:r.stage,submission:r.submission});
      }catch(error){
        r.stage=!attempted||ensDefiniteFailure(error)?'failed':'uncertain';
        console.warn(JSON.stringify({event:'ens.request_failed',check,stage:r.stage,code:error instanceof SlotError?error.code:'Unavailable'}));
        if(attempted&&ensRetryableRejection(error))r.retryToken=retries?.next(retryScope(r),r.attempt);if(r.stage==='failed')writes.release(owner.toLowerCase(),r.id);
        const errorMessage=error instanceof SlotError?error.message:r.stage==='uncertain'?'The Base voucher submission needs verification. No second transfer will be sent. Refresh ENS to check its status.':!attempted?'Voucher checks are temporarily unavailable. This request did not submit a transfer. Continue to try again.':transactionError(error);
        return reply({error:errorMessage,code:error instanceof SlotError?error.code:'EnsSendUnavailable',stage:r.stage,retryToken:r.retryToken},error instanceof SlotError?error.status:503);
      }
    }catch(error){
      if(error instanceof SlotError)return reply({error:error.message,code:error.code},error.status);
      // Provider errors can contain auth payloads, RPC endpoints and signatures.
      if(phase==='prepare')return reply({error:'Voucher checks are temporarily unavailable. This request did not submit a transfer. Refresh ENS, then Continue.',code:'EnsPrepareUnavailable'},503);
      if(phase==='read')return reply({error:'ENS chain data is temporarily unavailable. Refresh to retry.',code:'EnsReadUnavailable'},503);
      return reply({error:'ENS operation unavailable or under verification. Refresh your claim before trying again.',code:'EnsUnavailable'},503);
    }
  };
}
