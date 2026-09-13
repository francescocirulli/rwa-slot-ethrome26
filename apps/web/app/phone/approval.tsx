'use client';
import {useEffect,useRef,useState} from 'react';
import {useSigners} from '@privy-io/react-auth';
import {formatUnits,parseUnits,parseEther} from 'viem';
import {portfolioApprovalError,approvalFundingError} from '@/lib/approval-funding';
import type {Portfolio} from '@/lib/portfolio';
import type {SessionView} from '@/lib/types';
import type {PhoneTransaction} from './wallet';
export type PlayPermission={session:SessionView;api:(path:string,data?:unknown)=>Promise<any>;onSession:(session:SessionView)=>void};
export function PhoneApproval({portfolio,transaction,permission,reload,stale=false}:{portfolio:Portfolio|null|undefined;transaction:PhoneTransaction;permission?:PlayPermission;reload:()=>void;stale?:boolean}){
 const [budget,setBudget]=useState('5'),[consent,setConsent]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState(''),[changeLimit,setChangeLimit]=useState(false);
 const lockedRef=useRef(false),current=useRef(permission);current.current=permission;
 const {addSigners}=useSigners();
 useEffect(()=>{current.current=permission;setConsent(false);setChangeLimit(false);setError('');return()=>{current.current=undefined;};},[permission?.session.id]);
 const grant=permission?.session.playGrant,enablePlay=!!permission&&!grant?.active;
 const activateSession=enablePlay&&!changeLimit,allowance=portfolio?.allowance;
 const reuseAllowance=activateSession&&allowance!=null&&BigInt(allowance)>0n;
 const amount=reuseAllowance?formatUnits(BigInt(allowance!),6):activateSession&&grant?formatUnits(BigInt(grant.budget),6):budget;
 const locked=working||transaction.busy||transaction.pending||!!portfolio?.busy||!portfolio?.canTransact||stale;
 const fundingError=reuseAllowance?null:portfolioApprovalError(portfolio,activateSession),revokeError=portfolioApprovalError(portfolio);
 async function approve(value:string,enable:boolean,reuse=false){
  if(lockedRef.current||locked||(enable?fundingError:revokeError))return;
  lockedRef.current=true;setWorking(true);setError('');
  const expected=permission?.session.id;
  const stillLinked=()=>{if(!expected||current.current?.session.id!==expected)throw Error('The iPad link ended. Your wallet limit remains available.');};
  try{
   if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value))throw Error('Enter a USDC limit with at most 6 decimals.');
   const units=parseUnits(value,6);if(!reuse&&units.toString().length>18||enable&&units<=0n)throw Error('Enter a valid USDC limit.');
   if(enable&&permission){
    if(!consent)return;
    stillLinked();const latest=await permission.api('/phone/approval');stillLinked();
    if(!latest.configured||!latest.player||latest.player.busy)throw Error('Refresh the game state before approving.');
    const balanceError=reuse?null:approvalFundingError(latest.player.balance==null?null:BigInt(latest.player.balance),portfolio?.eth==null?null:parseEther(portfolio.eth),latest.gasMode,BigInt(latest.settings.ticketPrice));
    if(balanceError)throw Error(balanceError);
    if(latest.player.allowance==null)throw Error('USDC limit unavailable. Refresh balances before enabling this iPad.');
    if(reuse?latest.player.allowance!==allowance:BigInt(latest.player.allowance)>0n&&(!grant||latest.player.allowance!==grant.budget)){
     setConsent(false);reload();throw Error('Your USDC limit changed. Review the refreshed limit and enable this iPad again.');
    }
    const prepared:SessionView=grant&&!reuse?permission.session:await permission.api('/phone/play/prepare',{budget:units.toString(),gasConsent:'usdc-then-eth-v1',...(reuse?{reuseAllowance:true}:{})});
    stillLinked();permission.onSession(prepared);
    const next=prepared.playGrant;if(!next)throw Error('Permission unavailable.');
    if(!reuse&&latest.player.allowance!==next.budget)await transaction.execute('approveBudget',[next.budget]);
    stillLinked();await addSigners({address:permission.session.address!,signers:[{signerId:next.signerId,policyIds:[next.policyId]}]});
    stillLinked();permission.onSession(await permission.api('/phone/play/activate',{}));
   }else await transaction.execute('approveBudget',[units.toString()]);
   reload();if(!enable)setChangeLimit(false);
  }catch(cause){setError(cause instanceof Error?cause.message:'Approval not completed.');}
  finally{lockedRef.current=false;setWorking(false);}
 }
 return <section id="wallet-approval" className="phone-card phone-approval" aria-labelledby="wallet-approval-title">
  <span className="eyebrow">SPENDING ON THE SLOT</span><h2 id="wallet-approval-title">Your USDC limit.</h2>
  <div className="approval-summary"><div><span>Remaining approval</span><b>{allowance!=null?formatUnits(BigInt(allowance),6)+' USDC':'—'}</b></div><span className="approval-badge">{stale?'Needs refresh':allowance==null?'Unavailable':BigInt(allowance)>0n?'USDC limit set':'Not approved'}</span></div>
  {permission&&<p className="permission-note" role="status">{grant?.active?'Paid spins are enabled on this iPad.':allowance!=null&&BigInt(allowance)>0n?'Your USDC limit is already approved. Enable this iPad using the remaining limit; no new USDC approval transaction is needed.':'Paid spins are not enabled yet. Set a USDC limit and authorize this iPad below.'}</p>}
  <p className="small">Maximum the slot may spend. Approving does not move your USDC. Free spins need no approval.</p>
  <form onSubmit={event=>{event.preventDefault();void approve(amount,activateSession,reuseAllowance);}}>
   {reuseAllowance?<p className="small">Use the remaining <b>{amount} USDC</b> for this session.</p>:<><label htmlFor="wallet-allowance">New total USDC limit</label>
   <div className="approval-input"><input id="wallet-allowance" inputMode="decimal" autoComplete="off" value={amount} disabled={locked||activateSession&&!!grant} onChange={event=>setBudget(event.target.value.replace(',','.'))}/><span aria-hidden="true">USDC</span></div>
   <p className="small approval-hint">Replaces the remaining limit; it is not an extra deposit.</p></>}
   {activateSession&&<label className="check-row"><input type="checkbox" checked={consent} disabled={working} onChange={event=>setConsent(event.target.checked)}/><span>I authorize spins within this budget, plus my wallet fees. With USDC gas I also authorize the ETH fallback if USDC is not enough.</span></label>}
   <button className="phone-primary" disabled={locked||!!fundingError||activateSession&&!consent}>{working?reuseAllowance?'Enabling…':'Approving…':activateSession?reuseAllowance?'Enable this iPad':grant?'Complete the approval':'Approve and play':'Review approval'} <span>↗</span></button>
  </form>
  {enablePlay&&(reuseAllowance||changeLimit)&&<button className="phone-text" disabled={working||transaction.busy||transaction.pending} onClick={()=>{setChangeLimit(!changeLimit);setConsent(false);setError('');}}>{changeLimit?'Use existing USDC limit':'Change USDC limit'}</button>}
  <button className="phone-text approval-revoke" disabled={locked||!!revokeError||allowance==null||BigInt(allowance)===0n} onClick={()=>void approve('0',false)}>Revoke USDC approval</button>
  {fundingError&&<p className="permission-note">{fundingError} <a href="#wallet-funding">Fund your wallet on Base ↗</a></p>}
  {stale&&<p className="small" role="status">Showing the last verified limit. Refresh balances before making changes.</p>}
  {error&&error!==transaction.error&&<p className="phone-error" role="alert">{error}</p>}
  <details className="approval-details"><summary>How permissions and fees work</summary><p className="small">Changes and revocations require a reviewed transaction with {portfolio?.gasMode==='eth'?'ETH gas on Base':'USDC gas on Base, with ETH fallback after a definite rejection'}. Ending the iPad link does not revoke this limit.</p><p className="small">{permission?'Paid spins also need a session permission. It can only start spins on this slot and ends at logout or after 3 minutes of inactivity.':'You can manage this limit without linking an iPad. Link an iPad in Play to enable paid spins.'}</p></details>
 </section>;
}
