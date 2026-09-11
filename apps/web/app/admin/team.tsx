'use client';
import {useEffect,useRef,useState} from 'react';
import {usePrivy} from '@privy-io/react-auth';
import type {AdminAccountView} from '@/lib/admin/model';
import {walletAuthorizationHeaders} from '@/lib/wallet-authorization-client';
export function AdminTeam({account,onRefresh}:{account:AdminAccountView;onRefresh:()=>void}) {
  const {getAccessToken}=usePrivy();
  const [member,setMember]=useState(''),[review,setReview]=useState<{id:string;remove:boolean}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[verified,setVerified]=useState(false);
  const alive=useRef(true),locked=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function request(action:'proof'|'member',body:object) {
    if(locked.current)return;locked.current=true;setBusy(true);setError('');setVerified(false);
    try {
      const token=await getAccessToken();if(!token||!alive.current)throw new Error('Accedi di nuovo.');
      const walletHeaders=await walletAuthorizationHeaders();if(!alive.current)return;
      const response=await fetch('/api/admin/'+action,{method:'POST',headers:{Authorization:`Bearer ${token}`,...walletHeaders,'Content-Type':'application/json','X-Slot-Request':'1'},body:JSON.stringify({...body,confirm:true}),signal:AbortSignal.timeout(90000)});
      const value=await response.json();if(!alive.current)return;
      if(!response.ok)throw new Error(value.error||'Operazione non verificata. Aggiorna prima di riprovare.');
      if(action==='proof')setVerified(value.verified&&value.address.toLowerCase()===account.wallet?.address.toLowerCase());
      else{setReview(null);setMember('');onRefresh();}
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'Operazione non disponibile.');}
    finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  return <section className="admin-card admin-team"><div className="card-heading"><h2>Un wallet, il vostro team.</h2><span className="real-badge">{account.role==='owner'?'PROPRIETARIO':'COLLABORATORE'}</span></div>
    <p>Saldo, indirizzo di ricarica e commissioni sono condivisi. Ogni persona entra con il proprio account e conferma le proprie operazioni.</p>
    <div className="admin-account-code"><span>IL TUO CODICE ACCOUNT</span><code>{account.userId}</code></div>
    <button className="admin-secondary" disabled={busy} onClick={()=>void request('proof',{})}>{busy?'Verifica in corso…':'Verifica accesso con firma'} ↗</button><p className="fine-print">Una firma di prova, senza transazioni né commissioni.</p>
    {verified&&<p className="admin-message" role="status">Firma verificata dal wallet condiviso ✓</p>}
    {account.role==='owner'?<><h3>Collaboratori autorizzati</h3>{account.members.length?<ul className="team-members">{account.members.map(item=><li key={item.userId}><div><code>{item.userId}</code><span>{item.enabled?'Permessi aggiornati · swap abilitato':'Permessi da aggiornare per LI.FI o per il contratto'}</span></div><div>{!item.enabled&&<button className="admin-text" disabled={busy} onClick={()=>setReview({id:item.userId,remove:false})}>Aggiorna permessi</button>}<button className="admin-text" disabled={busy} onClick={()=>setReview({id:item.userId,remove:true})}>Rimuovi accesso</button></div></li>)}</ul>:<p className="fine-print">Nessun collaboratore. L’altra persona deve accedere all’admin e inviarti il suo codice account.</p>}
      <form onSubmit={event=>{event.preventDefault();setReview({id:member.trim(),remove:false});}}><label htmlFor="team-member">Codice account del collaboratore</label><input id="team-member" value={member} onChange={event=>setMember(event.target.value)} placeholder="did:privy:…" required pattern="did:privy:[a-zA-Z0-9_-]{5,100}" disabled={busy}/><button className="admin-secondary" type="submit" disabled={busy}>Aggiungi collaboratore ↗</button></form>
      {review&&<div className="team-review" role="region" aria-label="Conferma accesso collaboratore"><h3>{review.remove?'Revoca questo accesso.':'Autorizza questo account.'}</h3><code>{review.id}</code><p>{review.remove?'Il collaboratore perderà la possibilità di accedere e inviare nuove operazioni. Le transazioni già inviate proseguono.':'Potrà scambiare USDC o ETH nei token premio tramite LI.FI, pagando il gas dal saldo condiviso in USDC o ETH. Potrà anche gestire la slot, depositare e prelevare premi quando il contratto lo consente. Proprietà del wallet e gestione degli accessi restano a te.'}</p><div><button className="admin-text" disabled={busy} onClick={()=>setReview(null)}>Annulla</button><button className="admin-primary" disabled={busy} onClick={()=>void request('member',{userId:review.id,operation:review.remove?'remove':'add'})}>{busy?'Aggiornamento…':review.remove?'Conferma revoca':'Conferma autorizzazione'}</button></div></div>}
    </>:<p className="fine-print">Il proprietario gestisce gli accessi. {!account.operationsEnabled?'Le operazioni saranno abilitate dopo il deploy del contratto.':''}</p>}
    {error&&<p className="admin-error" role="alert">{error}<button className="admin-text" disabled={busy} onClick={onRefresh}>Aggiorna stato</button></p>}
  </section>;
}
