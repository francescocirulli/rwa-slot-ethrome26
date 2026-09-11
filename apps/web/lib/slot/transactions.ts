import {createWriteCoordinator,type WriteCoordinator} from '../admin/write-coordinator';
import {randomBytes} from 'node:crypto';
import type {Address} from 'viem';
import {TransactionReceiptNotFoundError} from 'viem';
import type {Identity, WalletService} from '../types';
import type {SlotEngine, SubmittedSpin} from './engine';
import {prepareAction} from './actions';
import {SlotError, slotError} from './errors';
import {definiteSendFailure, transactionError, type GasToken} from './gas';
import type {AdminAccessService} from '../admin/service';
import {withWalletAuthorization} from '../wallet-authorization';

type Transaction = Awaited<ReturnType<typeof prepareAction>>;
type Operation = {
  id:string; userId:string; walletId:string; address:string; action:string; args:string[]; scope:'personal'|'admin';
  transaction:Transaction; expiresAt:number;
  stage:'prepared'|'submitting'|'confirming'|'confirmed'|'failed'|'uncertain'|'cancelled';
  submission?:SubmittedSpin; gasToken?:GasToken; error?:string;
};
export function createContractApi({walletService, getSlot, origin, admin, coordinator=createWriteCoordinator(), now=Date.now}: {
  walletService?:WalletService; getSlot:()=>SlotEngine|null; origin:string; admin?:AdminAccessService; coordinator?:WriteCoordinator; now?:()=>number;
}) {
  const operations=new Map<string,Operation>(), activeWallets=new Map<string,string>();
  const preparing=new Set<string>();
  const terminal=(op:Operation)=>['confirmed','failed','cancelled'].includes(op.stage);
  function view(op:Operation) {return {id:op.id,address:op.address,action:op.action,args:op.args,transaction:op.transaction,
    expiresAt:op.expiresAt,stage:op.stage,hash:op.submission?.hash||null,gasToken:op.gasToken||null,error:op.error||null};}
  function owned(id:unknown,user:Identity,scope:'personal'|'admin',readOnly=false) {
    if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new SlotError('Input','Richiesta non valida.',400);
    const op=operations.get(id);
    if(!op||op.scope!==scope||(!(readOnly&&scope==='admin')&&op.userId!==user.userId)||!user.wallets.some(w=>w.id===op.walletId&&w.address.toLowerCase()===op.address.toLowerCase()))throw new SlotError('UnknownOperation','Richiesta non recuperabile. Verifica il wallet prima di effettuare una nuova operazione.',404);
    return op;
  }
  async function reconcile(op:Operation,slot:SlotEngine) {
    if(terminal(op)||op.stage==='submitting'||op.stage==='prepared')return;
    if(!op.submission)return;
    try {
      if(!op.submission.hash&&walletService?.resolveSpin)op.submission.hash=await walletService.resolveSpin(op.submission);
      if(!op.submission.hash)return;
      const receipt=await slot.reader.client.getTransactionReceipt({hash:op.submission.hash}).catch(error=>{if(error instanceof TransactionReceiptNotFoundError)return null;throw error;});
      if(!receipt)return;
      if(receipt.status==='reverted'){op.stage='failed';op.error='Il contratto ha annullato la transazione. Le commissioni possono essere state addebitate.';return;}
      const head=await slot.reader.client.getBlockNumber({cacheTime:0});
      if(head-receipt.blockNumber+1n>=BigInt(slot.reader.config.confirmations)){op.stage='confirmed';op.error=undefined;}
    }catch(error){if(error instanceof SlotError&&error.code==='TransactionFailed'){op.stage='failed';op.error=error.message;}else throw error;}
  }
  function cleanup() {
    for(const op of operations.values())if(op.stage==='prepared'&&op.expiresAt<=now())op.stage='cancelled';
    if(operations.size>=512)for(const [id,op]of operations){if(terminal(op)){if(op.scope==='admin')coordinator.release(op.walletId,id);operations.delete(id);if(activeWallets.get(op.walletId)===id)activeWallets.delete(op.walletId);break;}}
    if(operations.size>=512)throw new SlotError('Busy','Troppe operazioni in attesa. Riprova tra poco.',503);
  }
  return {async handle(request:Request,kind:'prepare'|'send'|'status'|'cancel',scope:'personal'|'admin'='personal') {
    const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization','Referrer-Policy':'no-referrer'}});
    try {
      if(request.method!==(kind==='status'?'GET':'POST'))throw new SlotError('Method','Metodo non consentito.',405);
      if(kind!=='status'&&(request.headers.get('origin')!==new URL(origin).origin||request.headers.get('x-slot-request')!=='1'))throw new SlotError('Origin','Origine non valida.',403);
      const token=request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1];
      if(!token||token.length>16000)throw new SlotError('Auth','Accedi con Privy.',401);
      if(!walletService)throw new SlotError('Config','Privy non configurato.',503);
      let user=await walletService.authenticate(token).catch(()=>{throw new SlotError('Auth','Accesso non verificato.',401);});
      if(scope==='admin'){
        if(!admin)throw new SlotError('AdminNotReady','Wallet condiviso non configurato.',403);
        const access=await admin.resolve(user);user={...user,wallets:[access.wallet]};
      }
      const wallet=user.wallets[0];if(!wallet)throw new SlotError('Wallet','Crea prima il wallet embedded.',409);
      const slot=getSlot();if(!slot)throw new SlotError('Config','Contratto non configurato.',503);
      if(kind==='status'){const op=owned(new URL(request.url).searchParams.get('id'),user,scope,true);await reconcile(op,slot);return reply({...view(op),canConfirm:op.userId===user.userId});}
      if(!request.headers.get('content-type')?.startsWith('application/json'))throw new SlotError('Input','Formato non valido.',415);
      let body='',bytes=0;const stream=request.body?.getReader();
      if(stream){const decoder=new TextDecoder();while(true){const chunk=await stream.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>5000){await stream.cancel();throw new SlotError('Input','Richiesta troppo grande.',413);}body+=decoder.decode(chunk.value,{stream:true});}}
      let input;try{input=JSON.parse(body);}catch{throw new SlotError('Input','JSON non valido.',400);}
      if(!input||typeof input!=='object')throw new SlotError('Input','Parametri non validi.',400);
      if(kind==='prepare') {
        if(typeof input.action!=='string'||!Array.isArray(input.args)||input.args.length>8||!input.args.every((arg:unknown)=>typeof arg==='string'&&arg.length<=100))throw new SlotError('Input','Parametri non validi.',400);
        if(scope==='admin')await admin!.assertAction(user,input.action);
        if(preparing.has(wallet.id))throw new SlotError('Busy','Preparazione già in corso.');
        preparing.add(wallet.id);
        try {
          cleanup();
          const previous=operations.get(activeWallets.get(wallet.id)||'');
          if(previous){await reconcile(previous,slot);if(!terminal(previous))return reply({error:'Questo wallet ha già un’operazione in corso. Attendi o verifica la conferma.',code:'Pending',pending:previous.stage==='prepared'?null:{id:previous.id,hash:previous.submission?.hash}},409);}
          const leaseId=randomBytes(32).toString('hex');
          if(scope==='admin')await coordinator.acquire(wallet.id,leaseId,async()=>{const saved=operations.get(leaseId);if(!saved)return false;if(saved.stage==='prepared'&&saved.expiresAt<=now())saved.stage='cancelled';await reconcile(saved,slot);return terminal(saved);});
          let transaction:Transaction;try{transaction=await prepareAction(slot.reader,wallet.address as Address,input.action,input.args);}catch(error){if(scope==='admin')coordinator.release(wallet.id,leaseId);throw error;}
          const op:Operation={id:leaseId,userId:user.userId,walletId:wallet.id,address:wallet.address,
            action:input.action,args:[...input.args],transaction,expiresAt:now()+300000,stage:'prepared',scope};
          operations.set(op.id,op);activeWallets.set(wallet.id,op.id);return reply(view(op));
        }finally{preparing.delete(wallet.id);}
      }
      const op=owned(input.id,user,scope);
      const operationWallet=user.wallets.find(candidate=>candidate.id===op.walletId)!;
      if(kind==='cancel') {if(op.stage==='prepared')op.stage='cancelled';return reply(view(op));}
      if(op.stage!=='prepared'){await reconcile(op,slot);return reply(view(op),202);}
      if(op.expiresAt<=now()){op.stage='cancelled';throw new SlotError('Expired','Conferma scaduta. Prepara di nuovo l’operazione.');}
      if(input.confirm!==true)throw new SlotError('Consent','Conferma operazione e commissioni prima dell’invio.',400);
      if(!walletService.sendOwned)throw new SlotError('Config','Invio Privy non disponibile.',503);
      // Mark synchronously, before yielding, so concurrent confirmations share one send.
      op.stage='submitting';
      void withWalletAuthorization(request,user,async authorization=>{
        let sending=false;
        try {
          const assertAccess=async()=>{
            if(op.expiresAt<=now())throw new SlotError('Cancelled','Conferma scaduta prima dell’invio. Prepara di nuovo l’operazione.');
            if(scope!=='admin')return;
            const access=await admin!.assertAction(user,op.action);
            if(access.wallet.id!==op.walletId||access.wallet.address.toLowerCase()!==op.address.toLowerCase())throw new SlotError('Cancelled','Il wallet condiviso è cambiato.');
          };
          await assertAccess();
          // Recheck roles, state and calldata after review without trusting client fields.
          const checked=await prepareAction(slot.reader,op.address as Address,op.action,op.args);
          if(checked.to!==op.transaction.to||checked.data!==op.transaction.data||checked.chainId!==op.transaction.chainId)throw new SlotError('Cancelled','Configurazione cambiata. Prepara nuovamente l’operazione.');
          sending=true;
          op.submission=await walletService.sendOwned!(operationWallet,authorization,op.transaction,op.id,op.transaction.gasMode,gas=>{op.gasToken=gas;},assertAccess);
          if(!op.submission.hash&&!op.submission.transactionId)throw new Error('Missing submission reference');
          op.gasToken=op.submission.gasToken||op.gasToken;op.stage='confirming';
        }catch(error){op.stage=!sending||definiteSendFailure(error)?'failed':'uncertain';op.error=sending?transactionError(error):slotError(error).message;}
      }).catch(error=>{op.stage='failed';op.error=slotError(error).message;});
      return reply(view(op),202);
    }catch(error){const safe=slotError(error);return reply({error:safe.message,code:safe.code},safe.status);}
  }};
}
