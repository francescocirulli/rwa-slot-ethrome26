'use client';
import {useEffect,useRef,useState} from 'react';
import {usePrivy} from '@privy-io/react-auth';
import {formatUnits} from 'viem';
import {RWA_ASSETS,PAYMENT_ASSET,ETH_ASSET,SWAP_INPUTS,assetUnits,type Asset} from '@/lib/assets';
import {AdminInventory,type AdminInventoryData} from './inventory';
import type {SwapView} from '@/lib/admin/swaps';
import type {SlotSnapshot} from '@/lib/slot/reader';
import {useWalletRequest} from '@/lib/wallet-authorization-client';

type Data=AdminInventoryData;
const short=(address:string)=>address.slice(0,6)+'…'+address.slice(-4);
const complete=(state:SwapView)=>['approved','succeeded','failed','rejected','expired'].includes(state.stage);
export function AdminAssets({tab,address,userId,slot,contractBusy,canDeposit,onDeposit,onRefresh,onSwapBusy,onConfigure}:{tab:string;address:string;userId:string;slot:SlotSnapshot|null;contractBusy:boolean;canDeposit:boolean;onDeposit:(action:string,args:string[])=>Promise<void>;onRefresh:()=>void;onSwapBusy:(busy:boolean)=>void;onConfigure:(asset:Asset)=>void}){
  const {getAccessToken}=usePrivy();
  const walletRequest=useWalletRequest();
  const [inventory,setInventory]=useState<Data|null>(null),[loadError,setLoadError]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [inputAssetId,setInputAssetId]=useState('usdc');
  const [assetId,setAssetId]=useState('nvidia'),[amount,setAmount]=useState(''),[quote,setQuote]=useState<SwapView|null>(null),[operation,setOperation]=useState<SwapView|null>(null),[clock,setClock]=useState(Date.now());
  const alive=useRef(true),lock=useRef(false),apiRef=useRef<(path:string,body?:unknown)=>Promise<any>>(null),refreshRef=useRef<()=>Promise<void>>(null);
  const storageKey='slot-swap:'+userId+':'+address.toLowerCase();
  const inputAsset=SWAP_INPUTS.find(a=>a.id===inputAssetId)!;
  const asset=RWA_ASSETS.find(a=>a.id===assetId)!,pending=!!operation&&!complete(operation)&&operation.stage!=='quoted';
  const refreshAccount=useRef(onRefresh);refreshAccount.current=onRefresh;
  async function api(path:string,body?:unknown){
    const token=await getAccessToken();if(!token||!alive.current)throw new Error('Accedi di nuovo.');
    const response=await (path==='execute'?walletRequest:fetch)('/api/admin/assets/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json','X-Slot-Request':'1'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(50000)});
    const value=await response.json();if(!alive.current)throw new Error('Account cambiato.');if(!response.ok)throw new Error(value.error||'Operazione non disponibile.');return value;
  }
  apiRef.current=api;
  async function reload(){try{const value=await apiRef.current!('inventory');if(value.address.toLowerCase()!==address.toLowerCase())throw new Error('Wallet cambiato.');setInventory(value);setLoadError('');}catch(e){if(alive.current)setLoadError((e as Error).message);}}
  refreshRef.current=reload;
  useEffect(()=>{alive.current=true;try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved&&typeof saved.id==='string'&&saved.address?.toLowerCase()===address.toLowerCase())setOperation(saved);}catch{}return()=>{alive.current=false;};},[storageKey,address]);
  useEffect(()=>{if(!['swap','inventory'].includes(tab))return;let stopped=false,timer:ReturnType<typeof setTimeout>;async function poll(){await refreshRef.current!();if(!stopped)timer=setTimeout(poll,15000);}void poll();return()=>{stopped=true;clearTimeout(timer);};},[tab]);
  useEffect(()=>{if(!quote)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[quote]);
  useEffect(()=>{onSwapBusy(pending||busy);},[pending,busy,onSwapBusy]);
  function remember(value:SwapView){sessionStorage.setItem(storageKey,JSON.stringify(value));setOperation(value);}
  async function check(value:SwapView){
    const params=new URLSearchParams({id:value.id});if(value.actionId)params.set('actionId',value.actionId);if(value.userOperationHash)params.set('userOperationHash',value.userOperationHash);if(value.fromBlock)params.set('fromBlock',value.fromBlock);if(value.hashes?.[0])params.set('hash',value.hashes[0]);
    const next:SwapView=await apiRef.current!('status?'+params);
    if(next.address.toLowerCase()!==address.toLowerCase())throw new Error('Wallet cambiato.');
    setError('');
    // Polling can arrive while wallet authorization still precedes the POST.
    // Keep the recovery marker until that submission attempt has finished.
    if(next.stage==='quoted'){if(lock.current)return;sessionStorage.removeItem(storageKey);setOperation(null);setQuote(null);return;}
    remember(next);
    if(complete(next)){sessionStorage.removeItem(storageKey);await refreshRef.current!();refreshAccount.current();}
  }
  useEffect(()=>{if(!pending||!operation)return;let stopped=false,timer:ReturnType<typeof setTimeout>;async function poll(){try{await check(operation!);}catch(e){if(!stopped)setError((e as Error).message);}if(!stopped)timer=setTimeout(poll,4000);}void poll();return()=>{stopped=true;clearTimeout(timer);};},[pending,operation?.id,operation?.actionId]);
  async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();}catch(e){if(alive.current)setError((e as Error).message);}finally{lock.current=false;if(alive.current)setBusy(false);}}
  async function getQuote(){setQuote(null);assetUnits(amount,inputAsset.decimals);const value:SwapView=await api('quote',{assetId,amount,inputAssetId});if(value.address.toLowerCase()!==address.toLowerCase()||value.assetId!==assetId||value.inputAssetId!==inputAssetId)throw new Error('Quotazione non corrispondente.');setQuote(value);setClock(Date.now());}
  async function execute(){
    if(!quote||quote.expiresAt<=Date.now())throw new Error('Richiedi una nuova quotazione.');
    // Save a public identifier before sending. Recovery never automatically executes a swap.
    remember({...quote,stage:'submitting',actionId:null,hashes:[]});setQuote(null);
    const result:SwapView=await api('execute',{id:quote.id,confirm:true});remember(result);
    if(complete(result)){sessionStorage.removeItem(storageKey);await reload();onRefresh();}
  }
  const usdcBalance=inventory?.assets.find(a=>a.id==='usdc');
  const quoteValid=!!quote&&quote.expiresAt>clock;
  const swapAllowed=!!inventory?.swapEnabled&&!loadError&&!pending&&!contractBusy&&!busy;
  const operationAsset=RWA_ASSETS.find(a=>a.id===operation?.assetId);
  return <div hidden={!['swap','inventory'].includes(tab)}>
    {loadError&&<p className="admin-error" role="alert">{loadError}<button className="admin-text" onClick={()=>void reload()}>Aggiorna</button></p>}
    {error&&<p className="admin-error" role="alert">{error}</p>}
    {operation&&<section className={'admin-card swap-status '+(['succeeded','approved'].includes(operation.stage)?'swap-success':'')} aria-live="polite">
      <span className="eyebrow">LI.FI / {operation.step==='approval'?'AUTORIZZAZIONE USDC':operationAsset?.ticker||'SWAP'}</span>
      <h2>{operation.stage==='approved'?'USDC autorizzati.':operation.stage==='succeeded'?'Token arrivati.':pending?operation.step==='approval'?'Autorizzazione in verifica.':'Swap in verifica.':'Operazione non completata.'}</h2>
      {operation.stage==='succeeded'?<p>Ricevuti <b>{formatUnits(BigInt(operation.output||'0'),operationAsset?.decimals||18)} {operationAsset?.ticker}</b> nel wallet condiviso. Puoi depositarli dalla tab Inventory.</p>
        :operation.stage==='approved'?<p>Ora puoi richiedere una quotazione aggiornata e confermare lo scambio. L’autorizzazione non ha ancora acquistato token.</p>
        :<p>{operation.error||(operation.step==='approval'?'Attendiamo la conferma dell’autorizzazione USDC.':'Attendiamo il risultato LI.FI su Base prima di aggiornare i saldi.')}</p>}
      {operation.gasToken&&<p className="fine-print">Modalità gas: {operation.gasToken} dal wallet condiviso{operation.gasToken==='ETH'?' · fallback ETH':''}.</p>}
      {operation.hashes.map(hash=><a className="admin-text" key={hash} href={'https://basescan.org/tx/'+hash} target="_blank" rel="noreferrer">Transazione {short(hash)} ↗</a>)}
      {pending&&<button className="admin-secondary" disabled={busy} onClick={()=>void run(()=>check(operation))}>Verifica stato ↻</button>}
    </section>}
    {tab==='swap'&&<div className="swap-layout"><section className="admin-card swap-card">
      <div className="card-heading"><span className="eyebrow">01 / PREPARA I PREMI</span><span className="real-badge">LI.FI · BASE</span></div>
      <h2>Crypto in.<br/><em>Good prizes out.</em></h2><p>Acquista i token per rifornire la tua slot.</p>
      <div className="swap-balances" aria-label="Saldi del wallet condiviso"><div><img src={PAYMENT_ASSET.logo} alt=""/><span>USDC<strong>{usdcBalance?.formatted??'—'}</strong></span></div><div><img src={ETH_ASSET.logo} alt=""/><span>ETH<strong>{inventory?.eth??'—'}</strong></span></div></div>
      <form onSubmit={event=>{event.preventDefault();void run(getQuote);}}>
        <div className="swap-field"><span>PAGHI <small>Saldo: {inputAssetId==='eth'?inventory?.eth??'—':usdcBalance?.formatted??'—'} {inputAsset.ticker}</small></span><div>
          <input aria-label={'Importo '+inputAsset.ticker+' da scambiare'} inputMode="decimal" placeholder="0.00" value={amount} disabled={pending||busy} onChange={e=>{setAmount(e.target.value.replace(',','.'));setQuote(null);}} required/>
          <select className="swap-input-token" aria-label="Token da scambiare" value={inputAssetId} disabled={pending||busy} onChange={e=>{setInputAssetId(e.target.value);setAmount('');setQuote(null);}}>{SWAP_INPUTS.map(a=><option key={a.id} value={a.id}>{a.ticker}</option>)}</select>
        </div></div>
        <div className="swap-arrow" aria-hidden="true">↓</div>
        <label className="swap-field"><span>RICEVI</span><div><img className="asset-logo" src={asset.logo} alt=""/><select aria-label="Token da acquistare" value={assetId} disabled={pending||busy} onChange={e=>{setAssetId(e.target.value);setQuote(null);}}>{RWA_ASSETS.map(a=><option key={a.id} value={a.id}>{a.name} · {a.ticker}</option>)}</select></div></label>
        <p className="swap-network">Slippage 0,5% <span>{inputAsset.ticker} → {asset.ticker} / Base</span></p>
        <p className="fine-print">Il gas viene pagato dal saldo condiviso in USDC. Se gli USDC non bastano per le commissioni, autorizzi il pagamento in ETH. Conserva un saldo sufficiente oltre all’importo da scambiare.</p>
        {!inventory?.swapEnabled&&inventory&&<p className="admin-error">Il proprietario deve aggiornare i tuoi permessi nella pagina Wallet admin per abilitare LI.FI.</p>}
        {!quote&&<button className="admin-primary" disabled={!swapAllowed} type="submit">{busy?'Quotazione in corso…':'Richiedi quotazione'} <span>↗</span></button>}
      </form>
      {quote&&<div className="swap-quote">
        <div className="card-heading"><h3>{quote.step==='approval'?'Autorizza USDC per lo swap':'Controlla lo swap'}</h3><span className="session-badge">{quoteValid?Math.max(0,Math.ceil((quote.expiresAt-clock)/1000))+' s':'Scaduta'}</span></div>
        <dl><dt>Paghi</dt><dd>{formatUnits(BigInt(quote.input),inputAsset.decimals)} {inputAsset.ticker}</dd><dt>Ricevi circa</dt><dd>{formatUnits(BigInt(quote.estimated),asset.decimals)} {asset.ticker}</dd><dt>Minimo ricevuto</dt><dd>{formatUnits(BigInt(quote.minimum),asset.decimals)} {asset.ticker}</dd><dt>Commissioni LI.FI incluse</dt><dd>{formatUnits(BigInt(quote.feeAmount),inputAsset.decimals)} {inputAsset.ticker}</dd><dt>Stima gas dello swap, in ETH</dt><dd>{formatUnits(BigInt(quote.gasEstimate),18)} ETH</dd><dt>Pagamento gas</dt><dd>USDC → fallback ETH</dd><dt>Percorso LI.FI</dt><dd>{quote.route}</dd><dt>Wallet destinatario</dt><dd><code>{address}</code></dd></dl>
        <p className="fine-print">{quote.step==='approval'?'Questo passaggio autorizza solo l’importo USDC indicato. Dopo la conferma onchain, richiedi una nuova quotazione per eseguire lo swap. L’autorizzazione ha un costo di gas separato.':'Il minimo ricevuto è vincolato nella transazione. Se il prezzo peggiora, ti chiederemo una nuova conferma.'} La stima LI.FI del gas non è il costo definitivo in USDC calcolato da Privy.</p>
        <button className="admin-primary" disabled={!swapAllowed} onClick={()=>void run(quoteValid?execute:getQuote)}>{!quoteValid?'Aggiorna quotazione':quote.step==='approval'?'Autorizza USDC con Privy':'Conferma swap con Privy'} <span>↗</span></button>
        <button className="admin-text" disabled={busy} onClick={()=>setQuote(null)}>Annulla</button>
      </div>}
    </section><aside className="admin-card swap-notes"><span className="eyebrow">IL WALLET DEL TEAM</span><h2>Un saldo.<br/>Più possibilità.</h2><div className="swap-token-cloud">{RWA_ASSETS.map(a=><div key={a.id}><img src={a.logo} alt={a.name}/><span>{a.ticker}</span></div>)}</div><ol><li>Scegli USDC o ETH e il token premio.</li><li>Conferma dal tuo account Privy.</li><li>Apri Inventory e deposita nella slot.</li></ol><p className="fine-print">Admin e collaboratori autorizzati usano lo stesso wallet. LI.FI cerca il percorso disponibile; Privy firma le transazioni.</p><a className="admin-text" href={'https://basescan.org/address/'+asset.address} target="_blank" rel="noreferrer">Contratto {asset.ticker} ↗</a></aside></div>}
    {tab==='inventory'&&<AdminInventory inventory={inventory} slot={slot} busy={busy||pending||contractBusy} loadError={loadError} canDeposit={canDeposit} onReload={()=>void reload()} onConfigure={onConfigure} onOperation={async(action,args)=>{await onDeposit(action,args);await reload();onRefresh();}}/>}
  </div>;
}
