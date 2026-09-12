'use client';
import {useState} from 'react';
import {formatUnits, isAddress, parseUnits, zeroAddress} from 'viem';
import type {AccountView} from '@/lib/account';
import {assetUnits} from '@/lib/assets';
import type {useContractTransaction} from '@/lib/slot/use-transaction';
export type PhoneTransaction=ReturnType<typeof useContractTransaction>;
type Holding={key:string;name:string;balance:string|null;formatted:string|null;decimals:number;token:string;tokenId?:string;logo?:string};
export function PhoneWallet({wallet,transaction,paired,reload,loading=false}:{wallet:NonNullable<AccountView['wallet']>;transaction:PhoneTransaction;paired:boolean;reload:()=>void;loading?:boolean}) {
  const [budget,setBudget]=useState('5'),[selection,setSelection]=useState<Holding|null>(null),[recipient,setRecipient]=useState(''),[amount,setAmount]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const portfolio=wallet.portfolio;
  const locked=transaction.busy||transaction.pending||!portfolio?.canTransact;
  const holdings:Holding[]=[...(portfolio?.assets||[]).map(asset=>({key:asset.id,name:asset.id==='gold'?'GOLD · '+asset.ticker:asset.name+' · '+asset.ticker,balance:asset.balance,formatted:asset.formatted,decimals:asset.decimals,token:asset.address,logo:asset.logo})),
    ...(portfolio?.nfts||[]).filter(nft=>nft.token&&nft.tokenId).map(nft=>({key:nft.key,name:nft.name,balance:nft.balance,formatted:nft.balance,decimals:0,token:nft.token!,tokenId:nft.tokenId!}))];
  async function approve(value:string) {
    setError('');
    try {
      if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value))throw new Error('Inserisci un limite USDC con massimo 6 decimali.');
      const units=parseUnits(value,6);if(units.toString().length>18)throw new Error('Limite troppo alto.');
      await transaction.execute('approveBudget',[units.toString()]);reload();
    }catch(cause){setError(cause instanceof Error?cause.message:'Autorizzazione non completata.');}
  }
  async function transfer() {
    if(!selection||locked)return;
    setError('');
    try {
      if(!isAddress(recipient)||recipient.toLowerCase()===wallet.address.toLowerCase()||recipient===zeroAddress||recipient.toLowerCase()===portfolio?.contract?.toLowerCase()||recipient.toLowerCase()===selection.token.toLowerCase())throw new Error('Inserisci un indirizzo esterno valido sulla rete Base.');
      const units=selection.decimals?assetUnits(amount,selection.decimals):/^[1-9][0-9]*$/.test(amount)?BigInt(amount):0n;
      if(units<=0n||selection.balance===null||units>BigInt(selection.balance))throw new Error('Quantità superiore al saldo disponibile o non valida.');
      await transaction.execute(selection.tokenId?'transferERC1155':'transferERC20',selection.tokenId?[selection.token,selection.tokenId,recipient,units.toString()]:[selection.token,recipient,units.toString()]);
      setSelection(null);setAmount('');setRecipient('');reload();
    }catch(cause){setError(cause instanceof Error?cause.message:'Trasferimento non completato.');}
  }
  return <>
    <section className="phone-card"><div className="wallet-heading"><span className="eyebrow">IL TUO WALLET</span><span className="base-badge">● BASE</span></div>
      <div className="phone-balance">{wallet.balance.amount??'—'} <span>USDC</span></div>
      <p className="small">{wallet.balance.stale?'Saldo da aggiornare. ':''}ETH per il gas: {portfolio?.eth??'—'}</p>
      <button className="phone-text" disabled={loading} onClick={reload}>{loading?'Aggiornamento…':'Aggiorna saldi ↻'}</button>
      <details className="wallet-receive"><summary>Ricevi sul tuo wallet ↙</summary><div className="receive-box"><img src={wallet.depositQr} width="180" height="180" alt="Indirizzo wallet su Base"/><code>{wallet.address}</code><button className="phone-secondary" onClick={async()=>{try{await navigator.clipboard.writeText(wallet.address);setCopied(true);}catch{setError('Copia l’indirizzo mostrato sopra.');}}}>{copied?'Indirizzo copiato ✓':'Copia indirizzo'}</button><p className="small">Invia fondi a questo indirizzo sulla rete Base.</p></div></details>
    </section>
    {portfolio?.busy&&<div className="phone-progress" role="status">Giocata in corso{portfolio.gameId?' #'+portfolio.gameId:''}. Puoi vedere i saldi; modifiche e trasferimenti riprendono dopo il risultato.</div>}
    {!portfolio&&<div className="phone-error" role="alert">Saldi premi e autorizzazione non disponibili. Aggiorna per riprovare.</div>}
    {portfolio&&!portfolio.canTransact&&!portfolio.busy&&<p className="phone-progress" role="status">{portfolio.contract?'Verifichiamo lo stato onchain prima di abilitare le operazioni.':'La slot non è ancora configurata. Il wallet può ricevere fondi.'}</p>}
    <section className="phone-card"><span className="eyebrow">SPESA SULLA SLOT</span><h2>Il tuo limite USDC.</h2>
      <div className="play-facts"><span>Autorizzazione residua<b>{portfolio?.allowance!=null?formatUnits(BigInt(portfolio.allowance),6)+' USDC':'—'}</b></span><span>Free spin<b>{portfolio?.freeSpins??'—'}</b></span></div>
      <p>Questo è l’importo che il contratto può spendere per le giocate. L’approve non trasferisce USDC e non collega un iPad.</p>
      {paired&&<p className="permission-note">Se le giocate sono abilitate, l’iPad può utilizzare il nuovo limite durante questa sessione.</p>}
      <form onSubmit={event=>{event.preventDefault();if(!locked)void approve(budget);}}><label htmlFor="wallet-allowance">Nuovo limite totale in USDC</label><input id="wallet-allowance" inputMode="decimal" value={budget} onChange={event=>setBudget(event.target.value.replace(',','.'))} disabled={locked}/><button className="phone-primary" disabled={locked}>Rivedi autorizzazione ↗</button></form>
      <button className="phone-text" disabled={locked||portfolio?.allowance==null||portfolio.allowance==='0'} onClick={()=>void approve('0')}>Revoca autorizzazione USDC</button>
      <p className="small">Il nuovo limite sostituisce quello residuo. Modifica e revoca richiedono una transazione con gas. Terminare il collegamento all’iPad lascia invariata questa autorizzazione.</p>
    </section>
    <section className="phone-card"><span className="eyebrow">TOKEN E PREMI</span><h2>Le tue vincite.</h2><p className="small">Quantità onchain su Base. I free spin si usano nella slot e non sono trasferibili.</p>
      <div className="wallet-holdings">{holdings.map(holding=><div className="holding" key={holding.key}>{holding.logo?<img src={holding.logo} width="30" height="30" alt=""/>:<span className="holding-nft" aria-hidden="true">✦</span>}<div><b>{holding.name}</b><span>{holding.formatted??'Non disponibile'}{holding.tokenId?' · NFT #'+holding.tokenId:''}</span></div><button className="phone-text" disabled={locked||holding.balance===null||BigInt(holding.balance)<=0n} onClick={()=>{setSelection(holding);setAmount('');setRecipient('');setError('');}}>Invia<span className="sr-only"> {holding.name}</span> ↗</button></div>)}</div>
      {selection&&<form className="wallet-send" onSubmit={event=>{event.preventDefault();void transfer();}}><h3>Invia {selection.name}</h3><p className="small">Disponibili: {holdings.find(item=>item.key===selection.key)?.formatted??'—'} · rete Base</p><label htmlFor="send-address">Indirizzo esterno destinatario</label><input id="send-address" autoComplete="off" spellCheck={false} value={recipient} onChange={event=>setRecipient(event.target.value.trim())} placeholder="0x…" disabled={locked} required/><label htmlFor="send-amount">{selection.tokenId?'Quantità NFT (intera)':'Quantità token'}</label><input id="send-amount" inputMode={selection.tokenId?'numeric':'decimal'} value={amount} onChange={event=>setAmount(event.target.value.replace(',','.'))} disabled={locked} required/><p className="small">Controlla la rete del destinatario: il trasferimento avviene su Base. Prima della firma vedrai quantità, indirizzo e modalità di pagamento del gas.</p><button className="phone-primary" disabled={locked}>Rivedi trasferimento ↗</button><button type="button" className="phone-text" disabled={transaction.busy} onClick={()=>setSelection(null)}>Chiudi trasferimento</button></form>}
    </section>
    {transaction.confirmed>0&&!transaction.busy&&!transaction.pending&&<div className="ready-card" role="status">Transazione confermata su Base. I saldi si aggiornano automaticamente.</div>}
    {transaction.pending&&<div className="phone-progress" role="status">Transazione in verifica. Non inviarla di nuovo.<button className="phone-text" disabled={transaction.busy} onClick={()=>void transaction.check()}>Verifica transazione</button></div>}
    {(error||transaction.error)&&<p className="phone-error" role="alert">{error||transaction.error}</p>}
    {transaction.hash&&<a className="phone-chain-link" href={'https://basescan.org/tx/'+transaction.hash} target="_blank" rel="noreferrer">Vedi transazione su Base ↗</a>}
  </>;
}
