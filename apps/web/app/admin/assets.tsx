'use client';
import {useEffect,useRef,useState} from 'react';
import {usePrivy} from '@privy-io/react-auth';
import {formatUnits} from 'viem';
import {RWA_ASSETS,PAYMENT_ASSET,ETH_ASSET,SWAP_INPUTS,assetUnits,type Asset} from '@/lib/assets';
import {AdminInventory,type AdminInventoryData} from './inventory';
import {buildQuickFundPlan,parseFundingTurns,restoreQuickFundBatch,type QuickFundBatch,type QuickFundItem} from '@/lib/admin/quick-fund';
import type {SwapView} from '@/lib/admin/swaps';
import type {SlotSnapshot} from '@/lib/slot/reader';
import {useWalletRequest} from '@/lib/wallet-authorization-client';
import {FundingConfirmation} from './funding-confirmation';

type Data=AdminInventoryData;
const short=(address:string)=>address.slice(0,6)+'…'+address.slice(-4);
const complete=(state:SwapView)=>['approved','succeeded','failed','rejected','expired'].includes(state.stage);
const statusParams=(value:SwapView)=>{const params=new URLSearchParams({id:value.id});if(value.actionId)params.set('actionId',value.actionId);if(value.userOperationHash)params.set('userOperationHash',value.userOperationHash);if(value.fromBlock)params.set('fromBlock',value.fromBlock);if(value.hashes?.[0])params.set('hash',value.hashes[0]);return params;};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export function AdminAssets({tab,address,userId,slot,contractBusy,canDeposit,onDeposit,onRefresh,onSwapBusy,onConfigure}:{tab:string;address:string;userId:string;slot:SlotSnapshot|null;contractBusy:boolean;canDeposit:boolean;onDeposit:(action:string,args:string[])=>Promise<void>;onRefresh:()=>void;onSwapBusy:(busy:boolean)=>void;onConfigure:(asset:Asset)=>void}){
  const {getAccessToken}=usePrivy();
  const walletRequest=useWalletRequest();
  const [inventory,setInventory]=useState<Data|null>(null),[loadError,setLoadError]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [inputAssetId,setInputAssetId]=useState('usdc');
  const [assetId,setAssetId]=useState('nvidia'),[amount,setAmount]=useState(''),[quote,setQuote]=useState<SwapView|null>(null),[operation,setOperation]=useState<SwapView|null>(null),[clock,setClock]=useState(Date.now());
  const [turnsInput,setTurnsInput]=useState('1'),[fundBatch,setFundBatch]=useState<QuickFundBatch|null>(null),[batchReady,setBatchReady]=useState('');
  const turns=parseFundingTurns(turnsInput);
  const [fundProgress,setFundProgress]=useState<Record<string,string>>({});
  const [funding,setFunding]=useState(false),[fundStatus,setFundStatus]=useState(''),[fundReview,setFundReview]=useState<SwapView|null>(null);
  const decision=useRef<((accepted:boolean)=>void)|null>(null),inventoryRequest=useRef<{path:string;promise:Promise<Data>}|null>(null),operationRef=useRef<SwapView|null>(null),scopeRef=useRef(tab);scopeRef.current=tab;operationRef.current=operation;
  const alive=useRef(true),lock=useRef(false),apiRef=useRef<(path:string,body?:unknown)=>Promise<any>>(null),refreshRef=useRef<()=>Promise<void>>(null);
  const storageKey='slot-swap:'+userId+':'+address.toLowerCase();
  const batchStorageKey='slot-quick-fund:'+userId+':'+address.toLowerCase()+':'+(slot?.address?.toLowerCase()||'unconfigured');
  const inputAsset=SWAP_INPUTS.find(a=>a.id===inputAssetId)!;
  const asset=RWA_ASSETS.find(a=>a.id===assetId)!,pending=!!operation&&!complete(operation)&&operation.stage!=='quoted';
  const refreshAccount=useRef(onRefresh);refreshAccount.current=onRefresh;
  async function api(path:string,body?:unknown){
    const token=await getAccessToken();if(!token||!alive.current)throw new Error('Sign in again.');
    const response=await (path==='execute'?walletRequest:fetch)('/api/admin/assets/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json','X-Slot-Request':'1'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(50000)});
    const value=await response.json();if(!alive.current)throw new Error('Account changed.');if(!response.ok)throw new Error(value.error||'Operation unavailable.');return value;
  }
  apiRef.current=api;
  async function loadInventory():Promise<Data>{
    const path='inventory'+(scopeRef.current==='swap'?'?scope=funding':'');
    if(inventoryRequest.current){if(inventoryRequest.current.path===path)return inventoryRequest.current.promise;await inventoryRequest.current.promise.catch(()=>{});return loadInventory();}
    const request=(async()=>{const value=await apiRef.current!(path);if(value.address.toLowerCase()!==address.toLowerCase())throw new Error('Wallet changed.');setInventory(value);setLoadError('');return value as Data;})();
    inventoryRequest.current={path,promise:request};try{return await request;}finally{if(inventoryRequest.current?.promise===request)inventoryRequest.current=null;}
  }
  async function waitInventory(ready:(data:Data)=>boolean):Promise<Data>{
    for(let attempt=0;attempt<10;attempt++){
      if(!alive.current)throw new Error('Account changed.');
      try{const data=await loadInventory();if(ready(data))return data;}catch{}
      setFundStatus('Aggiorno saldi e riserve automaticamente…');
      await delay(Math.min(1500*(attempt+1),4000));
    }
    throw new Error('Saldi non verificabili al momento. Il rifornimento è interrotto; puoi riprenderlo senza ripetere i depositi confermati.');
  }
  async function reload(){try{await loadInventory();}catch(e){if(alive.current)setLoadError((e as Error).message);}}
  refreshRef.current=reload;
  useEffect(()=>{alive.current=true;try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved&&typeof saved.id==='string'&&saved.address?.toLowerCase()===address.toLowerCase())setOperation(saved);}catch{}return()=>{alive.current=false;decision.current?.(false);decision.current=null;};},[storageKey,address]);
  useEffect(()=>{
    try{const batch=restoreQuickFundBatch(sessionStorage.getItem(batchStorageKey));setFundBatch(batch);if(batch)setTurnsInput(String(batch.turns));setBatchReady(batchStorageKey);}
    catch{setError('Impossibile recuperare il rifornimento. Abilita lo storage del browser e ricarica la pagina.');}
  },[batchStorageKey]);
  function saveBatch(batch:QuickFundBatch|null){
    if(batch)sessionStorage.setItem(batchStorageKey,JSON.stringify(batch));else sessionStorage.removeItem(batchStorageKey);
    setFundBatch(batch);
  }
  useEffect(()=>{if(!['swap','inventory'].includes(tab))return;void refreshRef.current!();},[tab]);
  useEffect(()=>{if(!quote)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[quote]);
  useEffect(()=>{onSwapBusy(pending||busy);},[pending,busy,onSwapBusy]);
  function remember(value:SwapView){operationRef.current=value;sessionStorage.setItem(storageKey,JSON.stringify(value));setOperation(value);}
  async function check(value:SwapView){
    const params=statusParams(value);
    const next:SwapView=await apiRef.current!('status?'+params);
    if(next.address.toLowerCase()!==address.toLowerCase())throw new Error('Wallet changed.');
    setError('');
    // Polling can arrive while wallet authorization still precedes the POST.
    // Keep the recovery marker until that submission attempt has finished.
    if(next.stage==='quoted'){if(lock.current)return;sessionStorage.removeItem(storageKey);setOperation(null);setQuote(null);return;}
    remember(next);
    if(complete(next)){sessionStorage.removeItem(storageKey);await refreshRef.current!();refreshAccount.current();}
  }
  useEffect(()=>{
    if(!pending||busy)return;
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    async function poll(){try{if(operationRef.current)await check(operationRef.current);}catch(e){if(!stopped)setError((e as Error).message);}if(!stopped)timer=setTimeout(poll,4000);}
    timer=setTimeout(poll,4000);return()=>{stopped=true;clearTimeout(timer);};
  },[pending,busy]);
  async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();}catch(e){if(alive.current)setError((e as Error).message);}finally{lock.current=false;if(alive.current)setBusy(false);}}
  async function getQuote(){setFundStatus('');setFundProgress({});setQuote(null);assetUnits(amount,inputAsset.decimals);const value:SwapView=await api('quote',{assetId,amount,inputAssetId});if(value.address.toLowerCase()!==address.toLowerCase()||value.assetId!==assetId||value.inputAssetId!==inputAssetId)throw new Error('Quote mismatch.');setQuote(value);setClock(Date.now());}
  async function execute(){
    if(!quote||quote.expiresAt<=Date.now())throw new Error('Request a new quote.');
    // Save a public identifier before sending. Recovery never automatically executes a swap.
    remember({...quote,stage:'submitting',actionId:null,hashes:[]});setQuote(null);
    const result:SwapView=await api('execute',{id:quote.id,confirm:true});remember(result);
    if(complete(result)){sessionStorage.removeItem(storageKey);await reload();onRefresh();}
  }
  async function quoteToOutput(item:Pick<QuickFundItem,'id'|'ticker'>,desired:bigint,seed=1000000n,alreadySized=false):Promise<SwapView>{
    let probe=seed;
    for(let attempt=0;attempt<5;attempt++){
      const value:SwapView=await apiRef.current!('quote',{assetId:item.id,amount:formatUnits(probe,6),inputAssetId:'usdc'});
      if(value.address.toLowerCase()!==address.toLowerCase()||value.assetId!==item.id||value.inputAssetId!=='usdc')throw new Error('Quotazione non corrispondente.');
      const minimum=BigInt(value.minimum);
      if(minimum<=0n)throw new Error('Quotazione non disponibile per '+item.ticker+'.');
      const scaled=((BigInt(value.input)*desired+minimum-1n)/minimum)*1010n/1000n+1n;
      // The probe is a price estimate, not permission to spend a whole USDC on a tiny prize.
      if(minimum>=desired&&(alreadySized||attempt>0||scaled>=probe))return value;
      probe=scaled;
    }
    throw new Error('Impossibile stimare l’importo per '+item.ticker+'.');
  }
  async function advance(value:SwapView):Promise<SwapView>{
    while(true){
      setFundReview(value);
      const accepted=await new Promise<boolean>(resolve=>{decision.current=resolve;});
      decision.current=null;setFundReview(null);
      if(!accepted)throw new Error('Operation cancelled.');
      if(!alive.current)throw new Error('Account changed.');
      if(value.expiresAt>Date.now())break;
      setFundStatus('Aggiorno la quotazione scaduta…');
      value=await quoteToOutput(RWA_ASSETS.find(asset=>asset.id===value.assetId)!,BigInt(value.minimum),BigInt(value.input),true);
    }
    remember({...value,stage:'submitting',actionId:null,hashes:[]});
    let current:SwapView=await apiRef.current!('execute',{id:value.id,confirm:true});remember(current);
    for(let attempt=0;attempt<90&&!complete(current);attempt++){
      setFundStatus('Attendo la conferma su Base…');await delay(3000);
      if(!alive.current)throw new Error('Account changed.');
      // Only reads are retried. An ambiguous execute is never submitted again.
      try{current=await apiRef.current!('status?'+statusParams(current));remember(current);}catch{if(attempt===89)throw new Error('Verifica temporaneamente indisponibile. La transazione resta in attesa.');}
    }
    if(complete(current))sessionStorage.removeItem(storageKey);
    if(!complete(current))throw new Error('Operazione ancora in verifica. Non inviare una seconda richiesta.');
    if(['failed','rejected','expired'].includes(current.stage))throw new Error(current.error||'Operazione non completata.');
    return current;
  }
  async function acquire(item:QuickFundItem,needed:bigint,data:Data){
    const usdc=data.assets.find(a=>a.id==='usdc');
    if(!usdc?.verified||usdc.balance===null||BigInt(usdc.balance)<=0n)throw new Error('Saldo USDC non disponibile per acquistare '+item.ticker+'.');
    let seed=BigInt(usdc.balance)<1000000n?BigInt(usdc.balance):1000000n;
    for(let attempt=0;attempt<4;attempt++){
      const value=await quoteToOutput(item,needed,seed,attempt>0);
      setFundProgress(progress=>({...progress,[item.id]:value.step==='approval'?'Firma approvazione USDC':'Firma acquisto '+item.ticker}));
      const result=await advance(value);
      if(result.stage==='succeeded')return;
      // Preserve the approved input, avoiding an endless approve / larger quote loop.
      seed=BigInt(result.input);
    }
    throw new Error('Autorizzazione USDC non completata per '+item.ticker+'.');
  }
  async function fundTurns(){
    if(turns===null||batchReady!==batchStorageKey)throw new Error('Inserisci un numero intero di turni da 1 a 99.');
    setFunding(true);setFundProgress({});setFundStatus('Verifico quanto manca…');setQuote(null);
    try{
      let data=await waitInventory(value=>!!value.funding);
      const plan=buildQuickFundPlan({turns,funding:data.funding,assets:data.assets,targets:fundBatch?.targets});
      if(!plan.length)throw new Error('Nessun premio RWA configurato.');
      if(fundBatch&&plan.length!==Object.keys(fundBatch.targets).length)throw new Error('Il catalogo è cambiato. Termina questo rifornimento prima di crearne uno nuovo.');
      if(!fundBatch)saveBatch({turns,targets:Object.fromEntries(plan.map(item=>[item.address.toLowerCase(),item.required.toString()]))});
      for(const [index,item] of plan.entries()){
        try{
          setFundStatus('Premio '+(index+1)+' di '+plan.length+' · '+item.ticker);
          // The initial snapshot covers all assets. Refresh only after a confirmed write.
          let balance=data.assets.find(a=>a.id===item.id);
          if(!balance?.reserve) data=await waitInventory(value=>!!value.assets.find(a=>a.id===item.id)?.reserve);
          balance=data.assets.find(a=>a.id===item.id)!;
          const toFund=item.required>BigInt(balance.reserve!.available)?item.required-BigInt(balance.reserve!.available):0n;
          if(toFund===0n){setFundProgress(progress=>({...progress,[item.id]:'Già a riserva'}));continue;}
          if(!balance.verified||balance.balance===null){data=await waitInventory(value=>{const asset=value.assets.find(a=>a.id===item.id);return !!asset?.verified&&asset.balance!==null;});balance=data.assets.find(a=>a.id===item.id)!;}
          if(BigInt(balance.balance!)<toFund){
            await acquire(item,toFund-BigInt(balance.balance!),data);
            data=await waitInventory(value=>{const asset=value.assets.find(a=>a.id===item.id);return !!asset?.verified&&asset.balance!==null&&BigInt(asset.balance)>=toFund;});
          }
          setFundProgress(progress=>({...progress,[item.id]:'Firma deposito nella slot'}));
          await onDeposit('fundERC20',[item.address,toFund.toString()]);
          data=await waitInventory(value=>{const asset=value.assets.find(a=>a.id===item.id);return !!asset?.reserve&&BigInt(asset.reserve.available)>=item.required;});
          setFundProgress(progress=>({...progress,[item.id]:'Completato'}));
        }catch(e){setFundProgress(progress=>({...progress,[item.id]:(e as Error).message}));throw e;}
      }
      saveBatch(null);
      setFundStatus('Rifornimento completato · '+(turns===1?'1 turno aggiunto':turns+' turni aggiunti')+'. Puoi avviare una nuova ricarica.');
    }catch(cause){setFundStatus('Rifornimento interrotto. Riprendi per completare i premi mancanti.');throw cause;}finally{setFunding(false);setFundReview(null);}
  }
  const usdcBalance=inventory?.assets.find(a=>a.id==='usdc');
  const quoteValid=!!quote&&quote.expiresAt>clock;
  const swapAllowed=!!inventory?.swapEnabled&&!loadError&&!pending&&!contractBusy&&!busy;
  const operationAsset=RWA_ASSETS.find(a=>a.id===operation?.assetId);
  const quickFunding=inventory?.funding??null;
  const quickPlan=buildQuickFundPlan({turns:turns??0,funding:quickFunding,assets:inventory?.assets??[],targets:fundBatch?.targets});
  const quickPending=quickPlan.filter(item=>item.toFund>0n);
  const quickAllowed=turns!==null&&batchReady===batchStorageKey&&!pending&&!contractBusy&&!busy&&canDeposit&&!!slot&&(!!fundBatch||quickPending.length>0||!quickFunding);
  return <><FundingConfirmation review={fundReview} onDecision={accepted=>decision.current?.(accepted)}/><div hidden={!['swap','inventory'].includes(tab)}>
    {loadError&&<p className="admin-error" role="alert">{loadError}<button className="admin-text" onClick={()=>void reload()}>Refresh</button></p>}
    {error&&<p className="admin-error" role="alert">{error}</p>}
    {operation&&!funding&&(!fundStatus||pending)&&<section className={'admin-card swap-status '+(['succeeded','approved'].includes(operation.stage)?'swap-success':'')} aria-live="polite">
      <span className="eyebrow">LI.FI / {operation.step==='approval'?'USDC APPROVAL':operationAsset?.ticker||'SWAP'}</span>
      <h2>{operation.stage==='approved'?'USDC approved.':operation.stage==='succeeded'?'Tokens received.':pending?operation.step==='approval'?'Approval under verification.':'Swap under verification.':'Operation not completed.'}</h2>
      {operation.stage==='succeeded'?<p>Received <b>{formatUnits(BigInt(operation.output||'0'),operationAsset?.decimals||18)} {operationAsset?.ticker}</b> in the shared wallet. You can deposit them from the Inventory tab.</p>
        :operation.stage==='approved'?<p>You can now request a fresh quote and confirm the swap. The approval has not bought any tokens yet.</p>
        :<p>{operation.error||(operation.step==='approval'?'Waiting for the USDC approval to confirm.':'Waiting for the LI.FI result on Base before refreshing balances.')}</p>}
      {operation.gasToken&&<p className="fine-print">Gas mode: {operation.gasToken} from the shared wallet{operation.gasToken==='ETH'?' · ETH fallback':''}.</p>}
      {operation.hashes.map(hash=><a className="admin-text" key={hash} href={'https://basescan.org/tx/'+hash} target="_blank" rel="noreferrer">Transaction {short(hash)} ↗</a>)}
      {pending&&<button className="admin-secondary" disabled={busy} onClick={()=>void run(()=>check(operation))}>Check status ↻</button>}
    </section>}
    {tab==='swap'&&<section className="admin-card quick-fund-card">
      <div className="card-heading"><span className="eyebrow">01 / RIFORNIMENTO RAPIDO</span><span className="real-badge">6 PREMI RWA · USDC</span></div>
      <h2>Riempi la slot.<br/><em>Anche più turni.</em></h2>
      <p>Scegli quanti turni aggiungere alle riserve attuali. Puoi ricaricare più volte. Conferma le firme richieste: acquisti e depositi proseguono automaticamente.</p>
      {<>
        <div className="quick-fund-controls">
          <label htmlFor="quick-fund-turns">Turni da aggiungere<input id="quick-fund-turns" type="number" min={1} max={99} step={1} inputMode="numeric" value={turnsInput} aria-invalid={turns===null} aria-describedby="quick-fund-input-help" disabled={busy||pending||contractBusy||!!fundBatch} onChange={event=>{setTurnsInput(event.target.value);setFundStatus('');setFundProgress({});}}/></label>
          <button className="admin-primary" disabled={!quickAllowed} onClick={()=>void run(fundTurns)}>{funding?'Rifornimento in corso…':fundBatch?'Riprendi rifornimento ↗':'Aggiungi '+(turns===1?'1 turno':(turns??'—')+' turni')+' ↗'}</button>
        </div>
        <p id="quick-fund-input-help" className={turns===null?'admin-error':'fine-print'}>Inserisci un numero intero da 1 a 99. Ogni nuova ricarica aggiunge questi turni alle riserve già presenti.</p>
        {fundBatch&&<p className="fine-print">Rifornimento da completare: {fundBatch.turns} turni. La ripresa mantiene lo stesso obiettivo e salta i depositi già confermati. <button className="admin-text" disabled={busy||pending||contractBusy} onClick={()=>{saveBatch(null);setFundStatus('Rifornimento terminato. I depositi confermati restano nella slot.');setFundProgress({});setError('');}}>Termina questo rifornimento</button></p>}
        {fundStatus&&<p role="status" aria-live="polite">{fundStatus}</p>}
        {quickPlan.length?<div className="quick-fund-table-wrap"><table className="quick-fund-table"><thead><tr><th>Premio</th><th>Riserva obiettivo</th><th>Disponibile in slot</th><th>Da comprare</th><th>Da depositare</th><th><span className="sr-only">Stato</span></th></tr></thead><tbody>{quickPlan.map(item=><tr key={item.id}><td><img src={item.logo} alt=""/><b>{item.ticker}</b></td><td>{formatUnits(item.required,item.decimals)}</td><td>{formatUnits(item.available,item.decimals)}</td><td>{item.toBuy>0n?formatUnits(item.toBuy,item.decimals)+' via USDC':'—'}</td><td>{formatUnits(item.toDeposit,item.decimals)}</td><td>{item.wallet===null?'Saldo non verificabile':(fundBatch?fundProgress[item.id]:null)||(item.toFund===0n?'Già a riserva':item.toBuy>0n?'In coda · compra e deposita':'In coda · deposita')}</td></tr>)}</tbody></table></div>:<p className="fine-print">{quickFunding?'Nessun premio RWA configurato.':'Verificheremo saldi e riserve all’avvio.'}</p>}
        <p className="fine-print">Un turno copre la riserva massima di una giocata per i sei premi RWA. I premi NFT si riforniscono da Inventario. Le autorizzazioni USDC e gli swap restano transazioni separate e verificabili su Base.</p>
      </>}
    </section>}
    {tab==='swap'&&<details className="manual-swap"><summary>Swap manuale</summary><div className="swap-layout"><section className="admin-card swap-card">
      <div className="card-heading"><span className="eyebrow">02 / PREPARE THE PRIZES</span><span className="real-badge">LI.FI · BASE</span></div>
      <h2>Crypto in.<br/><em>Real assets out.</em></h2><p>Buy the tokens to restock your slot.</p>
      <div className="swap-balances" aria-label="Shared wallet balances"><div><img src={PAYMENT_ASSET.logo} alt=""/><span>USDC<strong>{usdcBalance?.formatted??'—'}</strong></span></div><div><img src={ETH_ASSET.logo} alt=""/><span>ETH<strong>{inventory?.eth??'—'}</strong></span></div></div>
      <form onSubmit={event=>{event.preventDefault();void run(getQuote);}}>
        <div className="swap-field"><span>YOU PAY <small>Balance: {inputAssetId==='eth'?inventory?.eth??'—':usdcBalance?.formatted??'—'} {inputAsset.ticker}</small></span><div>
          <input aria-label={inputAsset.ticker+' amount to swap'} inputMode="decimal" placeholder="0.00" value={amount} disabled={pending||busy} onChange={e=>{setAmount(e.target.value.replace(',','.'));setQuote(null);}} required/>
          <select className="swap-input-token" aria-label="Token to swap" value={inputAssetId} disabled={pending||busy} onChange={e=>{setInputAssetId(e.target.value);setAmount('');setQuote(null);}}>{SWAP_INPUTS.map(a=><option key={a.id} value={a.id}>{a.ticker}</option>)}</select>
        </div></div>
        <div className="swap-arrow" aria-hidden="true">↓</div>
        <label className="swap-field"><span>YOU RECEIVE</span><div><img className="asset-logo" src={asset.logo} alt=""/><select aria-label="Token to buy" value={assetId} disabled={pending||busy} onChange={e=>{setAssetId(e.target.value);setQuote(null);}}>{RWA_ASSETS.map(a=><option key={a.id} value={a.id}>{a.name} · {a.ticker}</option>)}</select></div></label>
        <p className="swap-network">Slippage 0.5% <span>{inputAsset.ticker} → {asset.ticker} / Base</span></p>
        <p className="fine-print">Gas is paid from the shared USDC balance. If USDC is not enough for fees, you authorize paying in ETH. Keep enough balance beyond the amount to swap.</p>
        {!inventory?.swapEnabled&&inventory&&<p className="admin-error">The owner must update your permissions in the Admin wallet page to enable LI.FI.</p>}
        {!quote&&<button className="admin-primary" disabled={!swapAllowed} type="submit">{busy?'Getting quote…':'Request quote'} <span>↗</span></button>}
      </form>
      {quote&&<div className="swap-quote">
        <div className="card-heading"><h3>{quote.step==='approval'?'Approve USDC for the swap':'Review the swap'}</h3><span className="session-badge">{quoteValid?Math.max(0,Math.ceil((quote.expiresAt-clock)/1000))+' s':'Expired'}</span></div>
        <dl><dt>You pay</dt><dd>{formatUnits(BigInt(quote.input),inputAsset.decimals)} {inputAsset.ticker}</dd><dt>You receive about</dt><dd>{formatUnits(BigInt(quote.estimated),asset.decimals)} {asset.ticker}</dd><dt>Minimum received</dt><dd>{formatUnits(BigInt(quote.minimum),asset.decimals)} {asset.ticker}</dd><dt>LI.FI fees included</dt><dd>{formatUnits(BigInt(quote.feeAmount),inputAsset.decimals)} {inputAsset.ticker}</dd><dt>Swap gas estimate, in ETH</dt><dd>{formatUnits(BigInt(quote.gasEstimate),18)} ETH</dd><dt>Gas payment</dt><dd>USDC → ETH fallback</dd><dt>LI.FI route</dt><dd>{quote.route}</dd><dt>Recipient wallet</dt><dd><code>{address}</code></dd></dl>
        <p className="fine-print">{quote.step==='approval'?'This step only approves the USDC amount shown. After the onchain confirmation, request a new quote to execute the swap. The approval has a separate gas cost.':'The minimum received is enforced in the transaction. If the price gets worse, we will ask for a new confirmation.'} The LI.FI gas estimate is not the final USDC cost calculated by Privy.</p>
        <button className="admin-primary" disabled={!swapAllowed} onClick={()=>void run(quoteValid?execute:getQuote)}>{!quoteValid?'Refresh quote':quote.step==='approval'?'Approve USDC with Privy':'Confirm swap with Privy'} <span>↗</span></button>
        <button className="admin-text" disabled={busy} onClick={()=>setQuote(null)}>Cancel</button>
      </div>}
    </section><aside className="admin-card swap-notes"><span className="eyebrow">THE TEAM WALLET</span><h2>One balance.<br/>More options.</h2><div className="swap-token-cloud">{RWA_ASSETS.map(a=><div key={a.id}><img src={a.logo} alt={a.name}/><span>{a.ticker}</span></div>)}</div><ol><li>Choose USDC or ETH and the prize token.</li><li>Confirm from your Privy account.</li><li>Open Inventory and deposit into the slot.</li></ol><p className="fine-print">Admins and authorized collaborators use the same wallet. LI.FI finds the available route; Privy signs the transactions.</p><a className="admin-text" href={'https://basescan.org/address/'+asset.address} target="_blank" rel="noreferrer">{asset.ticker} contract ↗</a></aside></div></details>}
    {tab==='inventory'&&<AdminInventory inventory={inventory} slot={slot} busy={busy||pending||contractBusy} loadError={loadError} canDeposit={canDeposit} onReload={()=>void reload()} onConfigure={onConfigure} onOperation={async(action,args)=>{await onDeposit(action,args);await reload();onRefresh();}}/>}
  </div></>;
}
