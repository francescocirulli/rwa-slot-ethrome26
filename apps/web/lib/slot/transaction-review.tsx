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
  const transferFields=nft?['Collezione NFT','Prize ID','Recipient address on Base','NFT quantity']:['Contratto token','Recipient address on Base','Token amount'];
  const action=ADMIN_ACTIONS.find(item=>item.name===review.action);
  return <div className="tx-review-backdrop"><section ref={panel} className="tx-review" role="dialog" aria-modal="true" aria-labelledby="tx-review-title" onKeyDown={event=>{
    if(event.key==='Escape')callback.current(false);
    if(event.key==='Tab'){const buttons=event.currentTarget.querySelectorAll<HTMLButtonElement>('button');const first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  }}><span className="tx-eyebrow">YOUR PRIVY WALLET · BASE</span><h2 id="tx-review-title">Confirm the operation.</h2><h3>{review.action==='approveBudget'?'USDC budget approval':transfer?(nft?'NFT prize':asset?.ticker||'Token')+' transfer':action?.label||review.action}</h3>
    {asset&&<p><b>{formatUnits(BigInt(review.args[transfer?2:1]),asset.decimals)} {asset.ticker}</b> {transfer?'from your wallet to the external address below.':'from the wallet to the slot reserves.'}</p>}
    {nft&&<p><b>{review.args[3]} NFT · ID {review.args[1]}</b> from your wallet to the external address below.</p>}
    <dl><dt>Signing wallet</dt><dd><code>{review.address}</code></dd><dt>Target contract</dt><dd><code>{review.transaction.to}</code></dd>{review.args.map((arg,index)=><div key={index}><dt>{transfer?transferFields[index]:action?.fields[index]||'Budget approved for spins'}</dt><dd>{review.action==='approveBudget'?formatUnits(BigInt(arg),6)+' USDC':transfer&&asset&&index===2?formatUnits(BigInt(arg),asset.decimals)+' '+asset.ticker:arg}</dd></div>)}</dl>
    <div className="tx-gas-note">{review.transaction.gasMode==='usdc'?<><b>Fees in USDC, with ETH fallback.</b><p>Privy calculates and charges gas to your wallet. If USDC is not enough and the request was not sent, you authorize paying fees in ETH on Base.</p></>:<><b>Fees in ETH on Base.</b><p>Fees are paid from your wallet.</p></>}<p>Fees are in addition to the amounts and the play budget shown above.</p></div>
    <div className="tx-review-actions"><button type="button" onClick={()=>callback.current(false)}>Cancel</button><button type="button" onClick={()=>callback.current(true)}>Confirm from my wallet ↗</button></div>
  </section></div>;
}
