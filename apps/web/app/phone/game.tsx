'use client';
import {formatUnits} from 'viem';
import type {Portfolio} from '@/lib/portfolio';
import type {SessionView} from '@/lib/types';
export function PhoneGame({session,portfolio,onWallet}:{session:SessionView;portfolio:Portfolio|null|undefined;onWallet:()=>void}){
 return <section className="phone-card phone-play-card"><span className="eyebrow">THE SLOT IS LINKED · BASE</span><h2>Ready at the iPad.</h2>
  <div className="play-facts"><span>Current spin<b>{portfolio?.ticketPrice!=null?formatUnits(BigInt(portfolio.ticketPrice),6)+' USDC':'—'}</b></span><span>Free spins available<b>{portfolio?.freeSpins??'—'}</b></span></div>
  {portfolio?.freeSpins&&BigInt(portfolio.freeSpins)>0n&&<p>You can already play for free on the iPad. Pull the lever or press FREE SPIN. Gas is included.</p>}
  <p>{session.playGrant?.active?'Paid spins are enabled for this iPad session.':'Set up paid spins from Wallet when you are ready.'}</p>
  {portfolio?.busy&&<p className="small">Your spin is waiting for its result. The keeper settles it even if you leave.</p>}
  <button className="phone-secondary" onClick={onWallet}>Manage spending in Wallet ↗</button>
 </section>;
}
