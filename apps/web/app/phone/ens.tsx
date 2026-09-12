'use client';
import {useEffect,useRef,useState} from 'react';
import {usePrivy} from '@privy-io/react-auth';
import {useWalletRequest} from '@/lib/wallet-authorization-client';
import type {EnsClaim,EnsName} from '@/lib/ens/service';
type View={configured:boolean;names:EnsName[];claims:EnsClaim[]};
type Review={id:string;claimId:string;name:string;address:string;quantity:number;gasMode:string;expires:number};
export function PhoneENS({address,onChanged}:{address:string;onChanged:()=>void}){
  const {getAccessToken}=usePrivy(),walletRequest=useWalletRequest();
  const [view,setView]=useState<View|null>(null),[label,setLabel]=useState(''),[available,setAvailable]=useState<{name:string;available:boolean}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[review,setReview]=useState<Review|null>(null),[pending,setPending]=useState<string|null>(null);
  const alive=useRef(true),owner=useRef(address),locked=useRef(false);owner.current=address;
  const storageKey='slot-ens:'+address.toLowerCase();
  async function api(body?:unknown,query='',authorize=false){
    const token=await getAccessToken();if(!token)throw new Error('Sign in again.');
    const response=await (authorize?walletRequest:fetch)('/api/ens'+query,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json','X-Slot-Request':'1'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(authorize?95000:120000)});
    const data=await response.json();if(!alive.current||owner.current!==address)throw new Error('Wallet changed.');
    if(!response.ok)throw new Error(data.error||'ENS unavailable.');return data;
  }
  const apiRef=useRef(api);apiRef.current=api;
  async function refresh(){
    if(pending){
      const result=await apiRef.current({action:'status',id:pending}).catch(()=>null);
      if(result&&(result.stage==='failed'||result.claim?.stage!=='voucher')){sessionStorage.removeItem(storageKey);setPending(null);}
    }
    const next=await apiRef.current();setView(next);
    if(pending&&next.claims?.some((c:EnsClaim)=>c.stage!=='voucher'&&!c.completed)){sessionStorage.removeItem(storageKey);setPending(null);}
  }
  useEffect(()=>{
    alive.current=true;setView(null);setReview(null);setPending(null);setError('');
    try{setPending(sessionStorage.getItem(storageKey));}catch{}
    void apiRef.current().then(setView).catch(()=>setError('ENS is temporarily unavailable. Refresh to retry.'));
    return()=>{alive.current=false;};
  },[storageKey]);
  async function run(work:()=>Promise<void>){
    if(locked.current)return;locked.current=true;setBusy(true);setError('');
    try{await work();}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'ENS operation unavailable.');}
    finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  async function send(){
    if(!review)return;const r=review;
    if(r.address.toLowerCase()!==address.toLowerCase()||r.expires<Date.now())throw new Error('Review expired. Prepare again.');
    sessionStorage.setItem(storageKey,r.id);setPending(r.id);setReview(null);
    await apiRef.current({action:'send',id:r.id,confirm:true},'',true);await refresh();onChanged();
  }
  if(view&&!view.configured)return null;
  return <section className="phone-card" aria-label="ENS names on Sepolia">
    <span className="eyebrow">YOUR ENS · SEPOLIA TESTNET</span><h2>Your name onchain.</h2>
    <p>Redeem one ENS Registration voucher for your own <b>.wallstreetslot.eth</b> name. Sepolia registration gas is paid for you.</p>
    {view?.names.map(item=><div className="ready-card" key={item.name}><b>{item.name}</b><p className="small">Owned by your wallet · Expires {new Date(Number(item.expiry)*1000).toLocaleDateString()}{item.resolvedAddress?.toLowerCase()!==address.toLowerCase()?' · Address record differs from your wallet':''}</p><button className="phone-text" onClick={()=>void run(()=>navigator.clipboard.writeText(item.name))}>Copy name</button><a className="phone-chain-link" href={'https://explorer.ens.dev/'+encodeURIComponent(item.name)} target="_blank" rel="noreferrer">ENS Explorer ↗</a></div>)}
    {!view&&<p role="status">Loading ENS names…</p>}
    {view?.claims.filter(c=>!c.completed).map(c=><div className="receive-box" key={c.id}><b>{c.name}</b>
      <p className="small">{c.stage==='voucher'?'Reserved for your wallet. Consume one voucher to continue.':c.stage==='finalizing-base'?'Voucher received. Registration completes automatically after Base finality; this can take several minutes. Do not send another voucher.':'Voucher confirmed. Your name is ready to register on Sepolia.'}</p>
      {c.stage==='voucher'&&!pending&&<button className="phone-secondary" disabled={busy||!!review} onClick={()=>void run(async()=>setReview(await apiRef.current({action:'prepare',claimId:c.id})))}>Review voucher redemption ↗</button>}
      {c.stage==='ready'&&<button className="phone-primary" disabled={busy} onClick={()=>void run(async()=>{await apiRef.current({action:'complete',claimId:c.id,confirm:true});await refresh();onChanged();})}>Register name · Free ↗</button>}
    </div>)}
    {view&&!view.claims.some(c=>!c.completed)&&<form onSubmit={event=>{event.preventDefault();void run(async()=>setAvailable(await apiRef.current(undefined,'?label='+encodeURIComponent(label))));}}>
      <label htmlFor="ens-label">Choose your name</label><input id="ens-label" value={label} maxLength={32} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={e=>{setLabel(e.target.value);setAvailable(null);}} placeholder="frank" disabled={busy}/><p className="small">.wallstreetslot.eth · 3–32 letters, numbers or hyphens</p>
      <button className="phone-secondary" disabled={busy||!label}>Check availability</button>
      {available&&<p role="status">{available.name} · {available.available?'Available':'Unavailable'}</p>}
      {available?.available&&<button type="button" className="phone-primary" disabled={busy} onClick={()=>void run(async()=>{await apiRef.current({action:'reserve',label,confirm:true});setAvailable(null);await refresh();})}>Confirm name and reserve ↗</button>}
    </form>}
    {review&&<div className="receive-box" role="dialog" aria-label="Confirm ENS voucher redemption"><h3>Redeem for {review.name}</h3><p>This permanently locks <b>1 ENS Registration voucher on Base</b>. The voucher cannot be recovered or redeemed again.</p><p className="small">Your wallet: {review.address}<br/>Base fees: paid by your wallet in {review.gasMode==='eth'?'ETH':'USDC, with ETH fallback'}.<br/>Sepolia registration: free for you.</p><button className="phone-primary" disabled={busy} onClick={()=>void run(send)}>Confirm and authorize voucher ↗</button><button className="phone-text" disabled={busy} onClick={()=>void run(async()=>{await apiRef.current({action:'cancel',id:review.id});setReview(null);})}>Cancel</button></div>}
    {pending&&<p role="status" className="phone-progress">Voucher transaction under verification. Refresh to check its onchain state before continuing.</p>}
    <button className="phone-text" disabled={busy} onClick={()=>void run(refresh)}>{busy?'Working…':'Refresh ENS ↻'}</button>
    {error&&<p className="phone-error" role="alert">{error}</p>}
    <p className="small">These names belong to Sepolia testnet. Names and renewals are managed under wallstreetslot.eth; they are not Ethereum mainnet registrations.</p>
  </section>;
}
