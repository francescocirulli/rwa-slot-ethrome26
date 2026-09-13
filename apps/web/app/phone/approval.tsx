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
 const [budget,setBudget]=useState('5'),[consent,setConsent]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState('');
 const lockedRef=useRef(false),current=useRef(permission);current.current=permission;
 const {addSigners}=useSigners();
 useEffect(()=>{current.current=permission;setConsent(false);setError('');return()=>{current.current=undefined;};},[permission?.session.id]);
 const grant=permission?.session.playGrant,enablePlay=!!permission&&!grant?.active;
 const amount=enablePlay&&grant?formatUnits(BigInt(grant.budget),6):budget;
 const locked=working||transaction.busy||transaction.pending||!!portfolio?.busy||!portfolio?.canTransact||stale;
 const fundingError=portfolioApprovalError(portfolio,enablePlay),revokeError=portfolioApprovalError(portfolio);
 const allowance=portfolio?.allowance;
 async function approve(value:string,enable:boolean){
  if(lockedRef.current||locked||(enable?fundingError:revokeError))return;
  lockedRef.current=true;setWorking(true);setError('');
  const expected=permission?.session.id;
  const stillLinked=()=>{if(!expected||current.current?.session.id!==expected)throw Error('The iPad link ended. Your wallet limit remains available.');};
  try{
   if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value))throw Error('Enter a USDC limit with at most 6 decimals.');
   const units=parseUnits(value,6);if(units.toString().length>18||enable&&units<=0n)throw Error('Enter a valid USDC limit.');
   if(enable&&permission){
    if(!consent)return;
    stillLinked();const latest=await permission.api('/phone/approval');stillLinked();
    if(!latest.configured||!latest.player||latest.player.busy)throw Error('Refresh the game state before approving.');
    const balanceError=approvalFundingError(latest.player.balance==null?null:BigInt(latest.player.balance),portfolio?.eth==null?null:parseEther(portfolio.eth),latest.gasMode,BigInt(latest.settings.ticketPrice));
    if(balanceError)throw Error(balanceError);
    const prepared:SessionView=grant?permission.session:await permission.api('/phone/play/prepare',{budget:units.toString(),gasConsent:'usdc-then-eth-v1'});
    stillLinked();permission.onSession(prepared);
    const next=prepared.playGrant;if(!next)throw Error('Permission unavailable.');
    if(latest.player.allowance!==next.budget)await transaction.execute('approveBudget',[next.budget]);
    stillLinked();await addSigners({address:permission.session.address!,signers:[{signerId:next.signerId,policyIds:[next.policyId]}]});
    stillLinked();permission.onSession(await permission.api('/phone/play/activate',{}));
   }else await transaction.execute('approveBudget',[units.toString()]);
   reload();
  }catch(cause){setError(cause instanceof Error?cause.message:'Approval not completed.');}
  finally{lockedRef.current=false;setWorking(false);}
 }
 return <section id="wallet-approval" className="phone-card phone-approval" aria-labelledby="wallet-approval-title">
  <span className="eyebrow">SPENDING ON THE SLOT</span><h2 id="wallet-approval-title">Your USDC limit.</h2>
  <div className="approval-summary"><div><span>Remaining approval</span><b>{allowance!=null?formatUnits(BigInt(allowance),6)+' USDC':'—'}</b></div><span className="approval-badge">{stale?'Needs refresh':allowance==null?'Unavailable':BigInt(allowance)>0n?'Approved':'Not approved'}</span></div>
  <p className="small">Maximum the slot may spend. Approving does not move your USDC. Free spins need no approval.</p>
  <form onSubmit={event=>{event.preventDefault();void approve(amount,enablePlay);}}>
   <label htmlFor="wallet-allowance">New total USDC limit</label>
   <div className="approval-input"><input id="wallet-allowance" inputMode="decimal" autoComplete="off" value={amount} disabled={locked||enablePlay&&!!grant} onChange={event=>setBudget(event.target.value.replace(',','.'))}/><span aria-hidden="true">USDC</span></div>
   <p className="small approval-hint">Replaces the remaining limit; it is not an extra deposit.</p>
   {enablePlay&&<label className="check-row"><input type="checkbox" checked={consent} disabled={working} onChange={event=>setConsent(event.target.checked)}/><span>I authorize spins within this budget, plus my wallet fees. With USDC gas I also authorize the ETH fallback if USDC is not enough.</span></label>}
   <button className="phone-primary" disabled={locked||!!fundingError||enablePlay&&!consent}>{working?'Approving…':enablePlay?grant?'Complete the approval':'Approve and play':'Review approval'} <span>↗</span></button>
  </form>
  <button className="phone-text approval-revoke" disabled={locked||!!revokeError||allowance==null||BigInt(allowance)===0n} onClick={()=>void approve('0',false)}>Revoke USDC approval</button>
  {fundingError&&<p className="permission-note">{fundingError} <a href="#wallet-funding">Fund your wallet on Base ↗</a></p>}
  {stale&&<p className="small" role="status">Showing the last verified limit. Refresh balances before making changes.</p>}
  {error&&error!==transaction.error&&<p className="phone-error" role="alert">{error}</p>}
  <details className="approval-details"><summary>How permissions and fees work</summary><p className="small">Changes and revocations require a reviewed transaction with {portfolio?.gasMode==='eth'?'ETH gas on Base':'USDC gas on Base, with ETH fallback after a definite rejection'}. Ending the iPad link does not revoke this limit.</p><p className="small">{permission?'Paid spins also need a session permission. It can only start spins on this slot and ends at logout or after 3 minutes of inactivity.':'You can manage this limit without linking an iPad. Link an iPad in Play to enable paid spins.'}</p></details>
 </section>;
}
