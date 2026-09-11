import type {WalletService} from './types';
import {SlotError} from './slot/errors';
import {walletAuthorizations} from './wallet-authorization';

export function createWalletAuthorizationHandler({walletService,origin}:{walletService?:WalletService;origin:string}) {
  return async(request:Request)=>{
    const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization','Referrer-Policy':'no-referrer'}});
    try{
      if(request.method!=='POST')throw new SlotError('Method','Metodo non consentito.',405);
      if(request.headers.get('origin')!==new URL(origin).origin||request.headers.get('x-slot-request')!=='1')throw new SlotError('Origin','Origine non valida.',403);
      const token=request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1];
      if(!token||token.length>16000)throw new SlotError('Auth','Accedi con Privy.',401);
      if(!walletService)throw new SlotError('Config','Privy non configurato.',503);
      const user=await walletService.authenticate(token).catch(()=>{throw new SlotError('Auth','Accesso non verificato.',401);});
      if(!request.headers.get('content-type')?.startsWith('application/json'))throw new SlotError('Input','Formato non valido.',415);
      let length=0;const chunks:Uint8Array[]=[],reader=request.body?.getReader();
      if(reader)while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>2048){await reader.cancel();throw new SlotError('Input','Richiesta troppo grande.',413);}chunks.push(chunk.value);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SlotError('Input','JSON non valido.',400);}
      if(!input||typeof input!=='object')throw new SlotError('Input','Parametri non validi.',400);
      const channels=walletAuthorizations();
      if(input.action==='create')return reply(channels.create(user.userId,input.path));
      if(input.action==='poll')return reply(await channels.poll(input.id,user.userId));
      if(input.action==='sign'){channels.sign(input.id,user.userId,input.challengeId,input.signature);return reply({ok:true});}
      if(input.action==='cancel'){channels.cancel(input.id,user.userId);return reply({ok:true});}
      throw new SlotError('Input','Operazione non valida.',400);
    }catch(error){if(error instanceof SlotError)return reply({error:error.message,code:error.code},error.status);return reply({error:'Autorizzazione wallet non disponibile.',code:'WalletAuthorization'},503);}
  };
}
