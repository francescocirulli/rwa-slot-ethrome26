'use client';
import {useEffect,useRef,useState} from 'react';
import {usePrivy} from '@privy-io/react-auth';
import type {AdminAccountView} from '@/lib/admin/model';
import {useWalletRequest} from '@/lib/wallet-authorization-client';
export function AdminTeam({account,onRefresh}:{account:AdminAccountView;onRefresh:()=>void}) {
  const {getAccessToken}=usePrivy();
  const walletRequest=useWalletRequest();
  const [member,setMember]=useState(''),[review,setReview]=useState<{id:string;remove:boolean}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[verified,setVerified]=useState(false);
  const alive=useRef(true),locked=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function request(action:'proof'|'member',body:object) {
    if(locked.current)return;locked.current=true;setBusy(true);setError('');setVerified(false);
    try {
      const token=await getAccessToken();if(!token||!alive.current)throw new Error('Sign in again.');
      const response=await walletRequest('/api/admin/'+action,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Slot-Request':'1'},body:JSON.stringify({...body,confirm:true}),signal:AbortSignal.timeout(90000)});
      const value=await response.json();if(!alive.current)return;
      if(!response.ok)throw new Error(value.error||'Operation not verified. Refresh before retrying.');
      if(action==='proof')setVerified(value.verified&&value.address.toLowerCase()===account.wallet?.address.toLowerCase());
      else{setReview(null);setMember('');onRefresh();}
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'Operation unavailable.');}
    finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  return <section className="admin-card admin-team"><div className="card-heading"><h2>One wallet, your team.</h2><span className="real-badge">{account.role==='owner'?'OWNER':'COLLABORATOR'}</span></div>
    <p>Balance, top-up address and fees are shared. Each person signs in with their own account and confirms their own operations.</p>
    <div className="admin-account-code"><span>YOUR ACCOUNT CODE</span><code>{account.userId}</code></div>
    <button className="admin-secondary" disabled={busy} onClick={()=>void request('proof',{})}>{busy?'Verifying…':'Verify access with a signature'} ↗</button><p className="fine-print">A proof signature, with no transactions or fees.</p>
    {verified&&<p className="admin-message" role="status">Signature verified by the shared wallet ✓</p>}
    {account.role==='owner'?<><h3>Authorized collaborators</h3>{account.members.length?<ul className="team-members">{account.members.map(item=><li key={item.userId}><div><code>{item.userId}</code><span>{item.enabled?'Permissions up to date · swap and mint':'Permissions to update for swap, slot or NFT mint'}</span></div><div>{!item.enabled&&<button className="admin-text" disabled={busy} onClick={()=>setReview({id:item.userId,remove:false})}>Update permissions</button>}<button className="admin-text" disabled={busy} onClick={()=>setReview({id:item.userId,remove:true})}>Remove access</button></div></li>)}</ul>:<p className="fine-print">No collaborators. The other person must sign in to the admin and send you their account code.</p>}
      <form onSubmit={event=>{event.preventDefault();setReview({id:member.trim(),remove:false});}}><label htmlFor="team-member">Collaborator account code</label><input id="team-member" value={member} onChange={event=>setMember(event.target.value)} placeholder="did:privy:…" required pattern="did:privy:[a-zA-Z0-9_-]{5,100}" disabled={busy}/><button className="admin-secondary" type="submit" disabled={busy}>Add collaborator ↗</button></form>
      {review&&<div className="team-review" role="region" aria-label="Confirm collaborator access"><h3>{review.remove?'Revoke this access.':'Authorize this account.'}</h3><code>{review.id}</code><p>{review.remove?'The collaborator will lose the ability to sign in and send new operations. Transactions already sent continue.':'They will be able to swap USDC or ETH into prize tokens through LI.FI, paying gas from the shared balance in USDC or ETH. They can also manage the slot, deposit and withdraw prizes when the contract allows it. They can mint prize collection NFTs to the shared wallet or the slot, if the wallet owns the collection. Wallet ownership, collection ownership and access management stay with you.'}</p><div><button className="admin-text" disabled={busy} onClick={()=>setReview(null)}>Cancel</button><button className="admin-primary" disabled={busy} onClick={()=>void request('member',{userId:review.id,operation:review.remove?'remove':'add'})}>{busy?'Updating…':review.remove?'Confirm revoke':'Confirm authorization'}</button></div></div>}
    </>:<p className="fine-print">The owner manages access. {!account.operationsEnabled?'Operations will be enabled after the contract deploy.':''}</p>}
    {error&&<p className="admin-error" role="alert">{error}<button className="admin-text" disabled={busy} onClick={onRefresh}>Refresh status</button></p>}
  </section>;
}
