import {createHmac,timingSafeEqual} from 'node:crypto';
import {APIError} from '@privy-io/node';
import {definiteSendFailure} from '../slot/gas';
import {SlotError} from '../slot/errors';

// A new provider key is allowed only after a definite provider rejection. The
// signed cursor survives a server restart without trusting a client attempt ID.
// Replaying an older cursor always reuses the older provider key.
export function createEnsRetries(secret:string){
 const signature=(scope:string,attempt:number)=>createHmac('sha256',secret).update(JSON.stringify(['ens-retry-v1',scope,attempt])).digest();
 return {
  read(scope:string,token:unknown){
   if(token===undefined)return 0;
   if(typeof token!=='string'||!/^\d{1,4}\.[A-Za-z0-9_-]{43}$/.test(token))throw new SlotError('EnsRetry','Invalid voucher recovery. Refresh ENS.',400);
   const [number,mac]=token.split('.'),attempt=Number(number);
   if(attempt<1||attempt>1024||String(attempt)!==number||!timingSafeEqual(signature(scope,attempt),Buffer.from(mac,'base64url')))throw new SlotError('EnsRetry','Invalid voucher recovery. Refresh ENS.',400);
   return attempt;
  },
  next(scope:string,attempt:number){
   if(attempt>=1024)return undefined;
   return `${attempt+1}.${signature(scope,attempt+1).toString('base64url')}`;
  },
 };
}
export function ensDefiniteFailure(error:unknown){
 // An idempotency conflict may refer to an already submitted request. Never
 // authorize a fresh key just because that conflict has HTTP status 400.
 if(error instanceof APIError&&/idempotenc/i.test(JSON.stringify(error.error||{})))return false;
 return definiteSendFailure(error);
}
export function ensRetryableRejection(error:unknown){
 // Local cancellation/auth failures do not prove a previous provider request
 // with this key failed. Only the provider's terminal transaction rejection does.
 return error instanceof APIError&&[400,422].includes(error.status||0)&&ensDefiniteFailure(error)&&
  !/authoriz|authenticat|signature|request.expir/i.test(JSON.stringify(error.error||{}));
}
