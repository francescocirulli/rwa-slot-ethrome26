import QRCode from 'qrcode';
import {APIError} from '@privy-io/node';
import type {Balance,WalletService} from '../types';
import {SlotError} from '../slot/errors';
import type {AdminService} from './service';
import {withWalletAuthorization} from '../wallet-authorization';
export function createAdminHandler({service,walletService,origin,readBalance}:{service?:AdminService;walletService?:WalletService;origin:string;readBalance:(address:string)=>Promise<Balance>}) {
  return async function handle(request:Request,action:'account'|'create'|'member'|'proof') {
    const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization','Referrer-Policy':'no-referrer'}});
    try {
      if(request.method!==(action==='account'?'GET':'POST'))throw new SlotError('Method','Method not allowed.',405);
      if(action!=='account'&&(request.headers.get('origin')!==new URL(origin).origin||request.headers.get('x-slot-request')!=='1'))throw new SlotError('Origin','Invalid origin.',403);
      const token=request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1];
      if(!token||token.length>16000)throw new SlotError('Auth','Accedi con il tuo account Privy.',401);
      if(!service||!walletService)throw new SlotError('Config','Privy not configured.',503);
      const user=await walletService.authenticate(token).catch(()=>{throw new SlotError('Auth','Access not verified.',401);});
      if(action!=='account') {
        if(!request.headers.get('content-type')?.startsWith('application/json'))throw new SlotError('Input','Invalid format.',415);
        const chunks:Uint8Array[]=[];let bytes=0;const stream=request.body?.getReader();
        if(stream)while(true){const chunk=await stream.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>2048){await stream.cancel();throw new SlotError('Input','Richiesta troppo grande.',413);}chunks.push(chunk.value);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SlotError('Input','Invalid JSON.',400);}
        if(!input||input.confirm!==true)throw new SlotError('Consent','Confirm this operation first.',400);
        if(action==='create')await service.create(user);
        if(action==='member') {
          if(typeof input.userId!=='string'||!['add','remove'].includes(input.operation))throw new SlotError('Input','Invalid collaborator.',400);
          await withWalletAuthorization(request,user,authorization=>service.setMember(user,authorization,input.userId,input.operation==='remove'));
        }
        if(action==='proof')return reply(await withWalletAuthorization(request,user,authorization=>service.proof(user,authorization)));
      }
      const state=await service.status(user);
      const wallet=state.wallet?{address:state.wallet.address,balance:await readBalance(state.wallet.address),depositQr:await QRCode.toDataURL(state.wallet.address,{width:280,margin:2,errorCorrectionLevel:'M'})}:null;
      return reply({...state,userId:user.userId,wallet});
    }catch(error) {
      if(error instanceof SlotError)return reply({error:error.message,code:error.code},error.status);
      if(error instanceof APIError){
        const code=(error.error as {code?:unknown}|undefined)?.code;
        console.warn('Privy admin request rejected',{action,status:error.status,code:typeof code==='string'&&/^[a-z_]{1,64}$/.test(code)?code:'unknown'});
      }
      if(error instanceof APIError&&error.status===404)return reply({error:'Privy account or resource not found. Check the code and refresh.',code:'PrivyNotFound'},404);
      if(error instanceof APIError&&[401,403].includes(error.status||0))return reply({error:'Privy did not authorize the operation. Sign in again and check the app permissions.',code:'PrivyPermission'},403);
      return reply({error:'Privy operation cannot be verified. Refresh the status before retrying.',code:'PrivyUnavailable'},503);
    }
  };
}
