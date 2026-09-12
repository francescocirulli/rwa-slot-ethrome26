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
    const token=await getAccessToken();if(!token||!alive.current)throw new Error('Sign in again.');
    const response=await (path==='execute'?walletRequest:fetch)('/api/admin/assets/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json','X-Slot-Request':'1'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(50000)});
    const value=await response.json();if(!alive.current)throw new Error('Account changed.');if(!response.ok)throw new Error(value.error||'Operation unavailable.');return value;
  }
  apiRef.current=api;
  async function reload(){try{const value=await apiRef.current!('inventory');if(value.address.toLowerCase()!==address.toLowerCase())throw new Error('Wallet changed.');setInventory(value);setLoadError('');}catch(e){if(alive.current)setLoadError((e as Error).message);}}
  refreshRef.current=reload;
  useEffect(()=>{alive.current=true;try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved&&typeof saved.id==='string'&&saved.address?.toLowerCase()===address.toLowerCase())setOperation(saved);}catch{}return()=>{alive.current=false;};},[storageKey,address]);
  useEffect(()=>{if(!['swap','inventory'].includes(tab))return;let stopped=false,timer:ReturnType<typeof setTimeout>;async function poll(){await refreshRef.current!();if(!stopped)timer=setTimeout(poll,15000);}void poll();return()=>{stopped=true;clearTimeout(timer);};},[tab]);
  useEffect(()=>{if(!quote)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[quote]);
  useEffect(()=>{onSwapBusy(pending||busy);},[pending,busy,onSwapBusy]);
  function remember(value:SwapView){sessionStorage.setItem(storageKey,JSON.stringify(value));setOperation(value);}
  async function check(value:SwapView){
    const params=new URLSearchParams({id:value.id});if(value.actionId)params.set('actionId',value.actionId);if(value.userOperationHash)params.set('userOperationHash',value.userOperationHash);if(value.fromBlock)params.set('fromBlock',value.fromBlock);if(value.hashes?.[0])params.set('hash',value.hashes[0]);
    const next:SwapView=await apiRef.current!('status?'+params);
    if(next.address.toLowerCase()!==address.toLowerCase())throw new Error('Wallet changed.');
    setError('');
    // Polling can arrive while wallet authorization still precedes the POST.
    // Keep the recovery marker until that submission attempt has finished.
    if(next.stage==='quoted'){if(lock.current)return;sessionStorage.removeItem(storageKey);setOperation(null);setQuote(null);return;}
    remember(next);
    if(complete(next)){sessionStorage.removeItem(storageKey);await refreshRef.current!();refreshAccount.current();}
  }
  useEffect(()=>{if(!pending||!operation)return;let stopped=false,timer:ReturnType<typeof setTimeout>;async function poll(){try{await check(operation!);}catch(e){if(!stopped)setError((e as Error).message);}if(!stopped)timer=setTimeout(poll,4000);}void poll();return()=>{stopped=true;clearTimeout(timer);};},[pending,operation?.id,operation?.actionId]);
  async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();}catch(e){if(alive.current)setError((e as Error).message);}finally{lock.current=false;if(alive.current)setBusy(false);}}
  async function getQuote(){setQuote(null);assetUnits(amount,inputAsset.decimals);const value:SwapView=await api('quote',{assetId,amount,inputAssetId});if(value.address.toLowerCase()!==address.toLowerCase()||value.assetId!==assetId||value.inputAssetId!==inputAssetId)throw new Error('Quote mismatch.');setQuote(value);setClock(Date.now());}
  async function execute(){
    if(!quote||quote.expiresAt<=Date.now())throw new Error('Request a new quote.');
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
    {loadError&&<p className="admin-error" role="alert">{loadError}<button className="admin-text" onClick={()=>void reload()}>Refresh</button></p>}
    {error&&<p className="admin-error" role="alert">{error}</p>}
    {operation&&<section className={'admin-card swap-status '+(['succeeded','approved'].includes(operation.stage)?'swap-success':'')} aria-live="polite">
      <span className="eyebrow">LI.FI / {operation.step==='approval'?'USDC APPROVAL':operationAsset?.ticker||'SWAP'}</span>
      <h2>{operation.stage==='approved'?'USDC approved.':operation.stage==='succeeded'?'Tokens received.':pending?operation.step==='approval'?'Approval under verification.':'Swap under verification.':'Operation not completed.'}</h2>
      {operation.stage==='succeeded'?<p>Received <b>{formatUnits(BigInt(operation.output||'0'),operationAsset?.decimals||18)} {operationAsset?.ticker}</b> in the shared wallet. You can deposit them from the Inventory tab.</p>
        :operation.stage==='approved'?<p>You can now request a fresh quote and confirm the swap. The approval has not bought any tokens yet.</p>
        :<p>{operation.error||(operation.step==='approval'?'Waiting for the USDC approval to confirm.':'Waiting for the LI.FI result on Base before refreshing balances.')}</p>}
      {operation.gasToken&&<p className="fine-print">Gas mode: {operation.gasToken} from the shared wallet{operation.gasToken==='ETH'?' · ETH fallback':''}.</p>}
      {operation.hashes.map(hash=><a className="admin-text" key={hash} href={'https://basescan.org/tx/'+hash} target="_blank" rel="noreferrer">Transaction {short(hash)} ↗</a>)}
      {pending&&<button className="admin-secondary" disabled={busy} onClick={()=>void run(()=>check(operation))}>Check status ↻</button>}
    </section>}
    {tab==='swap'&&<div className="swap-layout"><section className="admin-card swap-card">
      <div className="card-heading"><span className="eyebrow">01 / PREPARE THE PRIZES</span><span className="real-badge">LI.FI · BASE</span></div>
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
    </section><aside className="admin-card swap-notes"><span className="eyebrow">THE TEAM WALLET</span><h2>One balance.<br/>More options.</h2><div className="swap-token-cloud">{RWA_ASSETS.map(a=><div key={a.id}><img src={a.logo} alt={a.name}/><span>{a.ticker}</span></div>)}</div><ol><li>Choose USDC or ETH and the prize token.</li><li>Confirm from your Privy account.</li><li>Open Inventory and deposit into the slot.</li></ol><p className="fine-print">Admins and authorized collaborators use the same wallet. LI.FI finds the available route; Privy signs the transactions.</p><a className="admin-text" href={'https://basescan.org/address/'+asset.address} target="_blank" rel="noreferrer">{asset.ticker} contract ↗</a></aside></div>}
    {tab==='inventory'&&<AdminInventory inventory={inventory} slot={slot} busy={busy||pending||contractBusy} loadError={loadError} canDeposit={canDeposit} onReload={()=>void reload()} onConfigure={onConfigure} onOperation={async(action,args)=>{await onDeposit(action,args);await reload();onRefresh();}}/>}
  </div>;
}
