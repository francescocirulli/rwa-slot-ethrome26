'use client';
import {useEffect, useRef} from 'react';
import {ADMIN_ACTIONS} from './actions';
import {formatUnits} from 'viem';
import {assetByAddress} from '../assets';
import type {TransactionReview} from './use-transaction';
import './transaction-review.css';
export function TransactionConfirmation({review,onDecision}:{review:TransactionReview|null;onDecision:(accepted:boolean)=>void}) {
  const panel=useRef<HTMLElement>(null),callback=useRef(onDecision);callback.current=onDecision;
  useEffect(()=>{if(!review)return;const previous=document.activeElement as HTMLElement|null;panel.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>previous?.focus();},[review?.id]);
  if(!review)return null;
  const transfer=review.action==='transferERC20'||review.action==='transferERC1155';
  const nft=review.action==='transferERC1155';
  const asset=review.action==='fundERC20'||review.action==='transferERC20'?assetByAddress(review.args[0]):null;
  const transferFields=nft?['Collezione NFT','ID premio','Indirizzo destinatario su Base','Quantità NFT']:['Contratto token','Indirizzo destinatario su Base','Quantità token'];
  const action=ADMIN_ACTIONS.find(item=>item.name===review.action);
  return <div className="tx-review-backdrop"><section ref={panel} className="tx-review" role="dialog" aria-modal="true" aria-labelledby="tx-review-title" onKeyDown={event=>{
    if(event.key==='Escape')callback.current(false);
    if(event.key==='Tab'){const buttons=event.currentTarget.querySelectorAll<HTMLButtonElement>('button');const first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  }}><span className="tx-eyebrow">IL TUO WALLET PRIVY · BASE</span><h2 id="tx-review-title">Conferma l’operazione.</h2><h3>{review.action==='approveBudget'?'Autorizzazione budget USDC':transfer?'Trasferimento '+(nft?'premio NFT':asset?.ticker||'token'):action?.label||review.action}</h3>
    {asset&&<p><b>{formatUnits(BigInt(review.args[transfer?2:1]),asset.decimals)} {asset.ticker}</b> {transfer?'dal tuo wallet all’indirizzo esterno indicato sotto.':'dal wallet alle riserve della slot.'}</p>}
    {nft&&<p><b>{review.args[3]} NFT · ID {review.args[1]}</b> dal tuo wallet all’indirizzo esterno indicato sotto.</p>}
    <dl><dt>Wallet che firma</dt><dd><code>{review.address}</code></dd><dt>Contratto destinatario</dt><dd><code>{review.transaction.to}</code></dd>{review.args.map((arg,index)=><div key={index}><dt>{transfer?transferFields[index]:action?.fields[index]||'Budget autorizzato per le giocate'}</dt><dd>{review.action==='approveBudget'?formatUnits(BigInt(arg),6)+' USDC':transfer&&asset&&index===2?formatUnits(BigInt(arg),asset.decimals)+' '+asset.ticker:arg}</dd></div>)}</dl>
    <div className="tx-gas-note">{review.transaction.gasMode==='usdc'?<><b>Commissioni in USDC, con fallback ETH.</b><p>Privy calcola e addebita il gas al tuo wallet. Se gli USDC non bastano e la richiesta non è stata inviata, autorizzi il pagamento delle commissioni in ETH su Base.</p></>:<><b>Commissioni in ETH su Base.</b><p>Le commissioni vengono pagate dal tuo wallet.</p></>}<p>Le commissioni sono aggiuntive rispetto agli importi e al budget di gioco indicati sopra.</p></div>
    <div className="tx-review-actions"><button type="button" onClick={()=>callback.current(false)}>Annulla</button><button type="button" onClick={()=>callback.current(true)}>Conferma dal mio wallet ↗</button></div>
  </section></div>;
}
