import type {WalletService} from '../types';
import type {AdminAccessService} from './service';
import type {createSwapService} from './swaps';
import type {createInventoryReader} from './inventory';
import {swapError} from './swaps';
import {SlotError} from '../slot/errors';
import {withWalletAuthorization} from '../wallet-authorization';
import type {Address} from 'viem';
export function createAssetsHandler({admin,walletService,swaps,inventory,contract,origin}:{admin?:AdminAccessService;walletService?:WalletService;swaps?:ReturnType<typeof createSwapService>;inventory:ReturnType<typeof createInventoryReader>;contract:()=>Address|null;origin:string}){
  return async function handle(request:Request,action:'inventory'|'quote'|'execute'|'status'){
    const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization','Referrer-Policy':'no-referrer'}});
    try{
      const write=action==='quote'||action==='execute';
      if(request.method!==(write?'POST':'GET'))throw new SlotError('Method','Metodo non consentito.',405);
      if(write&&(request.headers.get('origin')!==new URL(origin).origin||request.headers.get('x-slot-request')!=='1'))throw new SlotError('Origin','Origine non valida.',403);
      if(!admin||!walletService||!swaps)throw new SlotError('Config','Wallet condiviso non configurato.',503);
      const token=request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1];if(!token||token.length>16000)throw new SlotError('Auth','Accedi con Privy.',401);
      const user=await walletService.authenticate(token).catch(()=>{throw new SlotError('Auth','Accesso non verificato.',401);});
      const access=await admin.resolve(user);
      if(action==='inventory')return reply({...await inventory(access.wallet.address as Address,contract()),swapEnabled:access.role==='owner'||!!access.swapEnabled,mintEnabled:access.role==='owner'||!!access.mintEnabled,canManageOwnership:access.role==='owner'});
      if(action==='status'){const params=new URL(request.url).searchParams;return reply(await swaps.status(user,params.get('id'),params.get('actionId'),params.get('hash'),params.get('userOperationHash'),params.get('fromBlock')));}
      if(!request.headers.get('content-type')?.startsWith('application/json'))throw new SlotError('Input','Formato non valido.',415);
      const chunks:Uint8Array[]=[];let bytes=0;const stream=request.body?.getReader();if(stream)while(true){const chunk=await stream.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>2048){await stream.cancel();throw new SlotError('Input','Richiesta troppo grande.',413);}chunks.push(chunk.value);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SlotError('Input','JSON non valido.',400);}
      if(!input||typeof input!=='object')throw new SlotError('Input','Parametri non validi.',400);
      if(action==='quote')return reply(await swaps.quote(user,input.assetId,input.amount,input.inputAssetId));
      return reply(await withWalletAuthorization(request,user,authorization=>swaps.execute(user,authorization,input.id,input.confirm)));
    }catch(error){const failure=swapError(error);return reply({error:failure.message,code:failure.code},failure.status);}
  };
}
