'use client';
import {useEffect,useRef} from 'react';
import {formatUnits} from 'viem';
import {RWA_ASSETS} from '@/lib/assets';
import type {SwapView} from '@/lib/admin/swaps';
import '@/lib/slot/transaction-review.css';

export function FundingConfirmation({review,onDecision}:{review:SwapView|null;onDecision:(accepted:boolean)=>void}) {
  const panel=useRef<HTMLElement>(null);
  useEffect(()=>{if(!review)return;const previous=document.activeElement as HTMLElement|null;panel.current?.querySelector('button')?.focus();return()=>previous?.focus();},[review?.id]);
  if(!review)return null;
  const asset=RWA_ASSETS.find(item=>item.id===review.assetId)!;
  return <div className="tx-review-backdrop"><section ref={panel} className="tx-review" role="dialog" aria-modal="true" aria-labelledby="fund-review-title" onKeyDown={event=>{
    if(event.key==='Escape')onDecision(false);
    if(event.key==='Tab'){const buttons=event.currentTarget.querySelectorAll('button'),first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  }}>
    <span className="tx-eyebrow">RIFORNIMENTO · BASE · PRIVY</span>
    <h2 id="fund-review-title">{review.step==='approval'?'Autorizza USDC':'Acquista '+asset.ticker}</h2>
    <dl><dt>{review.step==='approval'?'Importo autorizzato':'Spendi'}</dt><dd>{formatUnits(BigInt(review.input),6)} USDC</dd><dt>Ricevi almeno con lo swap</dt><dd>{formatUnits(BigInt(review.minimum),asset.decimals)} {asset.ticker}</dd><dt>Wallet</dt><dd><code>{review.address}</code></dd></dl>
    <p>{review.step==='approval'?'Questa firma autorizza solo l’importo indicato. La firma per l’acquisto seguirà automaticamente.':'Dopo la conferma su Base, seguirà la firma per il deposito nella slot.'}</p>
    <div className="tx-gas-note">Gas aggiuntivo in USDC, con fallback in ETH se gli USDC non bastano. Ogni transazione viene confermata separatamente.</div>
    <div className="tx-review-actions"><button onClick={()=>onDecision(false)}>Interrompi</button><button onClick={()=>onDecision(true)}>Firma con Privy ↗</button></div>
  </section></div>;
}
