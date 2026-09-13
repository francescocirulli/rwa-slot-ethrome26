'use client';
import {useEffect,useRef,useState} from 'react';
import {usePrivy} from '@privy-io/react-auth';
import {useWalletRequest} from '@/lib/wallet-authorization-client';
import type {EnsClaim,EnsName} from '@/lib/ens/service';
type View={configured:boolean;names:EnsName[];claims:EnsClaim[]};
type ReadState='loading'|'ready'|'unavailable';
type Review={id:string;claimId:string;name:string;address:string;quantity:number;registrationPayer:'backend';gasMode:'usdc'|'eth';expires:number};
type Pending={id:string;claimId:string};
class EnsRequestError extends Error {constructor(message:string,public stage?:string,public code?:string,public retryToken?:string){super(message);}}
export function PhoneENS({address,onChanged}:{address:string;onChanged:()=>void}){
 const {getAccessToken}=usePrivy(),walletRequest=useWalletRequest();
 const [view,setView]=useState<View|null>(null),[label,setLabel]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[review,setReview]=useState<Review|null>(null),[pending,setPending]=useState<Pending|null>(null);
 const [namesState,setNamesState]=useState<ReadState>('loading'),[claimsState,setClaimsState]=useState<ReadState>('loading');
 const refreshing=useRef(false),completedSeen=useRef(new Set<string>());
 const alive=useRef(true),owner=useRef(address),locked=useRef(false),pendingRef=useRef(pending);owner.current=address;pendingRef.current=pending;
 const storageKey='slot-ens:'+address.toLowerCase();
 async function api(body?:unknown,authorize=false,view?:'names'|'claims'){
  const token=await getAccessToken();if(!token)throw Error('Sign in again.');
  const response=await (authorize?walletRequest:fetch)('/api/ens'+(view?'?view='+view:''),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json','X-Slot-Request':'1'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(authorize?95000:120000)});
  const data=await response.json();if(!alive.current||owner.current!==address)throw Error('Wallet changed.');
  if(!response.ok)throw new EnsRequestError(data.error||'Registration is temporarily unavailable.',data.stage,data.code,data.retryToken);return data;
 }
 const apiRef=useRef(api);apiRef.current=api;
 function saveRetry(claimId:string,token?:string){if(token)sessionStorage.setItem(storageKey+':retry:'+claimId,token);}
 function clearPending(){sessionStorage.removeItem(storageKey);pendingRef.current=null;setPending(null);}
 async function refresh(){
  if(refreshing.current)return;refreshing.current=true;
  const saved=pendingRef.current,current=()=>alive.current&&owner.current===address;
  const readNames=()=>apiRef.current(undefined,false,'names').then(next=>{
    if(!current())return;
    setView(previous=>({...previous,configured:next.configured,names:next.names,claims:previous?.claims||[]}));setNamesState('ready');
   }).catch(()=>{if(current())setNamesState('unavailable');});
  const namesRead=readNames();
  try{await Promise.all([namesRead,
   (async()=>{
    try{
     const next:Pick<View,'configured'|'claims'>=await apiRef.current(undefined,false,'claims');
     if(!current())return;
     setView(previous=>({...previous,configured:next.configured,claims:next.claims,names:previous?.names||[]}));setClaimsState('ready');
     const newlyCompleted=next.claims.filter(c=>c.completed&&!completedSeen.current.has(c.id));
     for(const c of newlyCompleted)completedSeen.current.add(c.id);
     const claim=next.claims.find(c=>c.id===saved?.claimId);
     if(saved&&(claim?.stage==='ready'||claim?.stage==='registered'))clearPending();
     // Keep ambiguous submissions protected across reorgs. Once a transfer is
     // visible, GET already follows its proof; no duplicate status read is needed.
     else if(saved&&(!claim||claim.stage==='voucher')){
      const status=await apiRef.current({action:'status',id:saved.id}).catch(()=>null);
      if(current()&&status?.stage==='failed'){saveRetry(saved.claimId,status.retryToken);clearPending();}
     }
     // The parallel name read may have preceded the mint. Read once more
     // after a newly observed completion before stopping the progress poll.
     if(newlyCompleted.length){await namesRead;if(current())await readNames();}
    }catch{if(current())setClaimsState('unavailable');}
   })(),
  ]);}finally{if(current())refreshing.current=false;}
 }
 const refreshRef=useRef(refresh);refreshRef.current=refresh;
 useEffect(()=>{
  alive.current=true;refreshing.current=false;completedSeen.current.clear();pendingRef.current=null;setView(null);setReview(null);setPending(null);setError('');setNamesState('loading');setClaimsState('loading');
  try{const raw=sessionStorage.getItem(storageKey);if(raw){let saved;try{saved=JSON.parse(raw);}catch{saved={id:raw,claimId:''};}pendingRef.current=saved;setPending(saved);}}catch{}
  void refreshRef.current().catch(()=>setError('ENS is temporarily unavailable. Refresh to retry.'));
  return()=>{alive.current=false;};
 },[storageKey]);
 const waiting=!!pending||!!view?.claims.some(c=>!c.completed)||namesState==='unavailable'||claimsState==='unavailable';
 useEffect(()=>{
  if(!waiting)return;
  const timer=setInterval(()=>{if(!locked.current)void refreshRef.current().catch(()=>{});},5000);
  return()=>clearInterval(timer);
 },[waiting,storageKey]);
 async function run(work:()=>Promise<void>){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');
  try{await work();}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'Registration is temporarily unavailable.');}
  finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 async function prepare(id:string){const retryToken=sessionStorage.getItem(storageKey+':retry:'+id)||undefined;setReview(await apiRef.current({action:'prepare',claimId:id,retryToken}));}
 async function send(){
  if(!review)return;const r=review;
  if(r.address.toLowerCase()!==address.toLowerCase()||r.expires<Date.now()||r.registrationPayer!=='backend'){setReview(null);throw Error('Review expired. Please continue again.');}
  const saved={id:r.id,claimId:r.claimId};sessionStorage.setItem(storageKey,JSON.stringify(saved));pendingRef.current=saved;setPending(saved);setReview(null);
  try{await apiRef.current({action:'send',id:r.id,confirm:true},true);await refresh();onChanged();}
  catch(cause){if(cause instanceof EnsRequestError&&cause.stage==='failed'){saveRetry(r.claimId,cause.retryToken);clearPending();}throw cause;}
 }
 if(view&&!view.configured)return null;
 return <section className="phone-card" aria-label="ENS names on Sepolia">
  <span className="eyebrow">YOUR ENS · SEPOLIA TESTNET</span><h2>Your name onchain.</h2>
  <p>Use one ENS Registration voucher to claim your <b>.wallstreetslot.eth</b> name.</p><p className="small">Free registration · No Sepolia funds needed.</p>
  {view?.names.map(item=><div className="ready-card ens-name-card" key={item.name}><b>{item.name}</b><p className="small">{namesState==='ready'?'Registered on Sepolia · Owned by your wallet':'Last verified on Sepolia'} · Expires {new Date(Number(item.expiry)*1000).toLocaleDateString()}{item.resolvedAddress?.toLowerCase()!==address.toLowerCase()?' · Address record differs from your wallet':''}</p><div className="ens-name-actions"><button className="phone-text" onClick={()=>void run(()=>navigator.clipboard.writeText(item.name))}>Copy name</button><a className="phone-chain-link" href={'https://explorer.ens.dev/'+encodeURIComponent(item.name)} target="_blank" rel="noreferrer">ENS Explorer ↗</a></div></div>)}
  {namesState==='loading'&&<p role="status">Loading names from Sepolia…</p>}
  {namesState==='unavailable'&&<p role="alert" className="phone-error">Sepolia names could not be refreshed. Any names shown are from the last successful read.</p>}
  {claimsState==='unavailable'&&<p role="alert" className="phone-error">Claim progress could not be refreshed. Do not send another voucher. Sepolia names load separately.</p>}
  {view?.claims.filter(c=>!c.completed&&!view.names.some(n=>n.name===c.name)).map(c=><div className="receive-box" key={c.id}><b>{c.name}</b>
   {claimsState==='unavailable'?<p className="small">Last known claim status; waiting for a fresh check.</p>:<>
    <ol className="small" aria-label="Registration progress">
     <li>{c.stage==='voucher'?'Base: transfer one voucher to the dead address.':'Base: voucher transferred to the dead address.'}</li>
     <li>{c.stage==='voucher'?'Sepolia: registration follows Base finality.':c.stage==='finalizing-base'?'Sepolia: waiting for Base finality. Registration has not started.':'Sepolia: Base transfer finalized. Registration is pending.'}</li>
     <li>Sepolia: the name appears after registration and ownership are verified.</li>
    </ol>
    {c.stage!=='voucher'&&<p className="small">No further voucher is needed. You can close this page; registration continues automatically.</p>}
    {c.voucherTransactionHash&&<a className="phone-chain-link" href={'https://basescan.org/tx/'+c.voucherTransactionHash} target="_blank" rel="noreferrer">Voucher transfer on Base ↗</a>}
    {c.stage==='voucher'&&!pending&&!review&&<><p className="small">Your name is reserved. Use one voucher to finish.</p><button className="phone-secondary" disabled={busy} onClick={()=>void run(()=>prepare(c.id))}>{busy?'Checking voucher…':'Continue'}</button></>}
   </>}

  </div>)}
  {view&&claimsState==='ready'&&namesState==='ready'&&!view.claims.some(c=>!c.completed)&&!pending&&<form onSubmit={event=>{event.preventDefault();void run(async()=>{const claim:EnsClaim=await apiRef.current({action:'reserve',label,confirm:true});setView(previous=>previous?{...previous,claims:[...previous.claims.filter(c=>c.id!==claim.id),claim]}:previous);await prepare(claim.id);});}}>
   <label htmlFor="ens-label">Choose your name</label><input id="ens-label" value={label} maxLength={32} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={e=>setLabel(e.target.value)} placeholder="frank" disabled={busy}/><p className="small">.wallstreetslot.eth · 3–32 letters, numbers or hyphens</p>
   <button className="phone-primary" disabled={busy||!label}>{busy?'Preparing…':'Continue'}</button>
  </form>}
  {review&&<div className="receive-box" role="dialog" aria-label="Confirm ENS voucher redemption"><h3>{review.name}</h3><p>Use <b>1 ENS Registration voucher</b> to register this name. Your voucher cannot be recovered after redemption.</p><p>Registration is free. We cover all Sepolia fees.</p><p className="small">The voucher transfer uses {review.gasMode==='eth'?'ETH on Base':'USDC on Base, with ETH fallback'} for its network fee.</p><details><summary>Transaction details</summary><p className="small" style={{overflowWrap:'anywhere'}}>Your name belongs to {review.address}. The voucher is transferred on Base to 0x000000000000000000000000000000000000dEaD. This transfer is not a token burn.</p></details><button className="phone-primary" disabled={busy} onClick={()=>void run(send)}>Confirm redemption</button><button className="phone-text" disabled={busy} onClick={()=>void run(async()=>{await apiRef.current({action:'cancel',id:review.id});setReview(null);})}>Cancel</button></div>}
  {pending&&claimsState==='ready'&&!view?.claims.some(c=>c.id===pending.claimId&&c.stage!=='voucher')&&<p role="status" className="phone-progress">Checking your voucher transfer on Base. No second transfer will be sent.</p>}
  {namesState!=='ready'&&claimsState==='ready'&&view?.claims.some(c=>c.completed)&&<p role="status">Registration completed on Sepolia. Refreshing current name ownership.</p>}
  {error&&<p className="phone-error" role="alert">{error}</p>}
  <button className="phone-text" disabled={busy} onClick={()=>void run(refresh)}>Refresh ENS ↻</button>
  <p className="small">Registered names live on Sepolia testnet. Names and renewals are managed under wallstreetslot.eth.</p>
 </section>;
}
