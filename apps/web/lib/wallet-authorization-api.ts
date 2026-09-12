import type {WalletService} from './types';
import {SlotError} from './slot/errors';
import {walletAuthorizations} from './wallet-authorization';

export function createWalletAuthorizationHandler({walletService,origin}:{walletService?:WalletService;origin:string}) {
  return async(request:Request)=>{
    const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization','Referrer-Policy':'no-referrer'}});
    try{
      if(request.method!=='POST')throw new SlotError('Method','Method not allowed.',405);
      if(request.headers.get('origin')!==new URL(origin).origin||request.headers.get('x-slot-request')!=='1')throw new SlotError('Origin','Invalid origin.',403);
      const token=request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1];
      if(!token||token.length>16000)throw new SlotError('Auth','Sign in with Privy.',401);
      if(!walletService)throw new SlotError('Config','Privy not configured.',503);
      const user=await walletService.authenticate(token).catch(()=>{throw new SlotError('Auth','Access not verified.',401);});
      if(!request.headers.get('content-type')?.startsWith('application/json'))throw new SlotError('Input','Invalid format.',415);
      let length=0;const chunks:Uint8Array[]=[],reader=request.body?.getReader();
      if(reader)while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>2048){await reader.cancel();throw new SlotError('Input','Request too large.',413);}chunks.push(chunk.value);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SlotError('Input','Invalid JSON.',400);}
      if(!input||typeof input!=='object')throw new SlotError('Input','Invalid parameters.',400);
      const channels=walletAuthorizations();
      if(input.action==='create')return reply(channels.create(user.userId,input.path));
      if(input.action==='poll')return reply(await channels.poll(input.id,user.userId));
      if(input.action==='sign'){channels.sign(input.id,user.userId,input.challengeId,input.signature);return reply({ok:true});}
      if(input.action==='cancel'){channels.cancel(input.id,user.userId);return reply({ok:true});}
      throw new SlotError('Input','Invalid operation.',400);
    }catch(error){if(error instanceof SlotError)return reply({error:error.message,code:error.code},error.status);return reply({error:'Wallet authorization unavailable.',code:'WalletAuthorization'},503);}
  };
}
