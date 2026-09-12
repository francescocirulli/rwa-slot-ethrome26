'use client';
import {useState} from 'react';
import {formatUnits, isAddress, parseUnits, zeroAddress} from 'viem';
import type {AccountView} from '@/lib/account';
import {portfolioApprovalError} from '@/lib/approval-funding';
import {assetUnits} from '@/lib/assets';
import type {useContractTransaction} from '@/lib/slot/use-transaction';
export type PhoneTransaction=ReturnType<typeof useContractTransaction>;
type Holding={key:string;name:string;balance:string|null;formatted:string|null;decimals:number;token:string;tokenId?:string;logo?:string};
export function PhoneWallet({wallet,transaction,paired,reload,loading=false,showApproval=true}:{wallet:NonNullable<AccountView['wallet']>;transaction:PhoneTransaction;paired:boolean;reload:()=>void;loading?:boolean;showApproval?:boolean}) {
  const [budget,setBudget]=useState('5'),[selection,setSelection]=useState<Holding|null>(null),[recipient,setRecipient]=useState(''),[amount,setAmount]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState('');
  const portfolio=wallet.portfolio;
  const fundingError=portfolioApprovalError(portfolio);
  const locked=transaction.busy||transaction.pending||!portfolio?.canTransact;
  const holdings:Holding[]=[...(portfolio?.assets||[]).map(asset=>({key:asset.id,name:asset.id==='gold'?'GOLD · '+asset.ticker:asset.name+' · '+asset.ticker,balance:asset.balance,formatted:asset.formatted,decimals:asset.decimals,token:asset.address,logo:asset.logo})),
    ...(portfolio?.nfts||[]).filter(nft=>nft.token&&nft.tokenId).map(nft=>({key:nft.key,name:nft.name,balance:nft.balance,formatted:nft.balance,decimals:0,token:nft.token!,tokenId:nft.tokenId!}))];
  async function approve(value:string) {
    if(locked || fundingError)return;
    setError('');
    try {
      if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value))throw new Error('Enter a USDC limit with at most 6 decimals.');
      const units=parseUnits(value,6);if(units.toString().length>18)throw new Error('Limit too high.');
      await transaction.execute('approveBudget',[units.toString()]);reload();
    }catch(cause){setError(cause instanceof Error?cause.message:'Approval not completed.');}
  }
  async function transfer() {
    if(!selection||locked)return;
    setError('');
    try {
      if(!isAddress(recipient)||recipient.toLowerCase()===wallet.address.toLowerCase()||recipient===zeroAddress||recipient.toLowerCase()===portfolio?.contract?.toLowerCase()||recipient.toLowerCase()===selection.token.toLowerCase())throw new Error('Enter a valid external address on the Base network.');
      const units=selection.decimals?assetUnits(amount,selection.decimals):/^[1-9][0-9]*$/.test(amount)?BigInt(amount):0n;
      if(units<=0n||selection.balance===null||units>BigInt(selection.balance))throw new Error('Amount above the available balance or invalid.');
      await transaction.execute(selection.tokenId?'transferERC1155':'transferERC20',selection.tokenId?[selection.token,selection.tokenId,recipient,units.toString()]:[selection.token,recipient,units.toString()]);
      setSelection(null);setAmount('');setRecipient('');reload();
    }catch(cause){setError(cause instanceof Error?cause.message:'Transfer not completed.');}
  }
  return <>
    <section id="wallet-funding" className="phone-card"><div className="wallet-heading"><span className="eyebrow">YOUR WALLET</span><span className="base-badge">● BASE</span></div>
      <div className="phone-balance">{wallet.balance.amount??'—'} <span>USDC</span></div>
      <div className="phone-wallet-address"><span className="eyebrow">YOUR ADDRESS ON BASE</span><code aria-label="Wallet address">{wallet.address}</code><button className="phone-secondary" onClick={async()=>{try{await navigator.clipboard.writeText(wallet.address);setCopied(wallet.address);}catch{setError('Copy the address shown above.');}}}>{copied===wallet.address?'Address copied ✓':'Copy address'}</button></div>
      <p className="small">{wallet.balance.stale?'Balance pending update. ':''}ETH for gas: {portfolio?.eth??'—'}</p>
      <button className="phone-text" disabled={loading} onClick={reload}>{loading?'Refreshing…':'Refresh balances ↻'}</button>
      <details className="wallet-receive" open={!!portfolioApprovalError(portfolio,true)}><summary>Receive on your wallet ↙</summary><div className="receive-box"><img src={wallet.depositQr} width="180" height="180" alt="Wallet address on Base"/><p className="small">Add USDC on Base to this address for paid spins. {portfolio?.gasMode==='eth'?'Keep ETH on Base for transaction fees.':'Keep extra USDC or ETH on Base for transaction fees.'} Refresh balances after funding.</p></div></details>
    </section>
    {portfolio?.busy&&<div className="phone-progress" role="status">Spin in progress{portfolio.gameId?' #'+portfolio.gameId:''}. You can see balances; changes and transfers resume after the result.</div>}
    {!portfolio&&<div className="phone-error" role="alert">Prize balances and approval unavailable. Refresh to retry.</div>}
    {portfolio&&!portfolio.canTransact&&!portfolio.busy&&<p className="phone-progress" role="status">{portfolio.contract?'Wallet connected. Onchain reads are unavailable: press “Refresh balances” to retry. An iPad connection is not required.':'The slot is not configured yet. The wallet can receive funds.'}</p>}
    {showApproval&&<section className="phone-card"><span className="eyebrow">SPENDING ON THE SLOT</span><h2>Your USDC limit.</h2>
      <div className="play-facts"><span>Remaining approval<b>{portfolio?.allowance!=null?formatUnits(BigInt(portfolio.allowance),6)+' USDC':'—'}</b></span><span>Free spins<b>{portfolio?.freeSpins??'—'}</b></span></div>
      <p>This is the amount the contract may spend on spins. The approval does not transfer USDC and does not link an iPad.</p>
      {paired&&<p className="permission-note">If spins are enabled, the iPad can use the new limit during this session.</p>}
      {fundingError&&<p className="permission-note">{fundingError} <a href="#wallet-funding">Fund your wallet on Base ↗</a></p>}
      <form onSubmit={event=>{event.preventDefault();if(!locked)void approve(budget);}}><label htmlFor="wallet-allowance">New total USDC limit</label><input id="wallet-allowance" inputMode="decimal" value={budget} onChange={event=>setBudget(event.target.value.replace(',','.'))} disabled={locked}/><button className="phone-primary" disabled={locked||!!fundingError}>Review approval ↗</button></form>
      <button className="phone-text" disabled={locked||!!fundingError||portfolio?.allowance==null||portfolio.allowance==='0'} onClick={()=>void approve('0')}>Revoke USDC approval</button>
      <p className="small">The new limit replaces the remaining one. Changing and revoking need a transaction with gas. Ending the iPad link leaves this approval unchanged.</p>
    </section>}
    <section className="phone-card"><span className="eyebrow">TOKENS AND PRIZES</span><h2>Your winnings.</h2><p className="small">Onchain amounts on Base. Free spins are used in the slot and cannot be transferred.</p>
      <div className="wallet-holdings">{holdings.map(holding=><div className="holding" key={holding.key}>{holding.logo?<img src={holding.logo} width="30" height="30" alt=""/>:<span className="holding-nft" aria-hidden="true">✦</span>}<div><b>{holding.name}</b><span>{holding.formatted??'Unavailable'}{holding.tokenId?' · NFT #'+holding.tokenId:''}</span></div><button className="phone-text" disabled={locked||holding.balance===null||BigInt(holding.balance)<=0n} onClick={()=>{setSelection(holding);setAmount('');setRecipient('');setError('');}}>Send<span className="sr-only"> {holding.name}</span> ↗</button></div>)}</div>
      {selection&&<form className="wallet-send" onSubmit={event=>{event.preventDefault();void transfer();}}><h3>Send {selection.name}</h3><p className="small">Available: {holdings.find(item=>item.key===selection.key)?.formatted??'—'} · Base network</p><label htmlFor="send-address">External recipient address</label><input id="send-address" autoComplete="off" spellCheck={false} value={recipient} onChange={event=>setRecipient(event.target.value.trim())} placeholder="0x…" disabled={locked} required/><label htmlFor="send-amount">{selection.tokenId?'NFT quantity (whole)':'Token amount'}</label><input id="send-amount" inputMode={selection.tokenId?'numeric':'decimal'} value={amount} onChange={event=>setAmount(event.target.value.replace(',','.'))} disabled={locked} required/><p className="small">Check the recipient network: the transfer happens on Base. Before signing you will see amount, address and how gas is paid.</p><button className="phone-primary" disabled={locked}>Review transfer ↗</button><button type="button" className="phone-text" disabled={transaction.busy} onClick={()=>setSelection(null)}>Close transfer</button></form>}
    </section>
    {transaction.confirmed>0&&!transaction.busy&&!transaction.pending&&<div className="ready-card" role="status">Transaction confirmed on Base. Balances refresh automatically.</div>}
    {transaction.pending&&<div className="phone-progress" role="status">Transaction under verification. Do not send it again.<button className="phone-text" disabled={transaction.busy} onClick={()=>void transaction.check()}>Check transaction</button></div>}
    {transaction.unrecoverable&&<div className="phone-error" role="alert">The service restarted and no longer knows this request. Verify it on BaseScan, then discard it to continue.<button className="phone-text" disabled={transaction.busy} onClick={()=>transaction.discard()}>Discard request</button></div>}
    {(error||transaction.error)&&<p className="phone-error" role="alert">{error||transaction.error}</p>}
    {transaction.hash&&<a className="phone-chain-link" href={'https://basescan.org/tx/'+transaction.hash} target="_blank" rel="noreferrer">View transaction on Base ↗</a>}
  </>;
}
