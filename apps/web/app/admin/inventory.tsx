'use client';
import {useEffect,useRef,useState} from 'react';
import {formatUnits} from 'viem';
import {assetUnits,ETH_ASSET,type Asset} from '@/lib/assets';
import type {Inventory} from '@/lib/admin/inventory';
import type {SlotSnapshot} from '@/lib/slot/reader';
export type AdminInventoryData=Inventory&{swapEnabled:boolean;mintEnabled:boolean;canManageOwnership:boolean};
const short=(address:string)=>address.slice(0,6)+'…'+address.slice(-4);
const units=(value:string|null|undefined,decimals=0)=>value==null?'—':formatUnits(BigInt(value),decimals);
function Balances({wallet,reserve,ticker,decimals=0}:{wallet:string|null;reserve:{balance:string;reserved:string;available:string}|null;ticker:string;decimals?:number}) {
  return <div className="inventory-balances"><div><span>Wallet condiviso</span><strong>{units(wallet,decimals)} <small>{ticker}</small></strong></div><div><span>Contratto slot · totale</span><strong>{units(reserve?.balance,decimals)} <small>{ticker}</small></strong></div><p><span>Disponibile nel contratto <b>{units(reserve?.available,decimals)}</b></span><span>Impegnato in giocate <b>{units(reserve?.reserved,decimals)}</b></span></p></div>;
}
export function AdminInventory({inventory,slot,busy,loadError,canDeposit,onOperation,onReload,onConfigure}:{inventory:AdminInventoryData|null;slot:SlotSnapshot|null;busy:boolean;loadError:string;canDeposit:boolean;onOperation:(action:string,args:string[])=>Promise<void>;onReload:()=>void;onConfigure:(asset:Asset)=>void}) {
  const [selection,setSelection]=useState<{type:'erc20'|'nft';id:string;mode:'deposit'|'mint'}|null>(null),[amount,setAmount]=useState(''),[destination,setDestination]=useState('slot'),[error,setError]=useState(''),[working,setWorking]=useState(false);
  const lock=useRef(false),panel=useRef<HTMLElement>(null);
  useEffect(()=>{if(selection)panel.current?.scrollIntoView({behavior:'smooth',block:'center'});},[selection]);
  const unavailable=busy||working||!!loadError||!inventory||!canDeposit;
  const asset=selection?.type==='erc20'?inventory?.assets.find(a=>a.id===selection.id):null;
  const nft=selection?.type==='nft'?inventory?.nfts.find(n=>String(n.symbol)===selection.id):null;
  function choose(value:NonNullable<typeof selection>){setSelection(value);setAmount('');setError('');setDestination(value.mode==='mint'?'wallet':'slot');}
  async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setWorking(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{lock.current=false;setWorking(false);}}
  async function submit(){
    if(unavailable||!selection)throw new Error('Aggiorna i saldi prima di procedere.');
    if(asset){const quantity=assetUnits(amount,asset.decimals);if(!asset.canDeposit||!asset.verified||asset.balance===null||quantity>BigInt(asset.balance))throw new Error('Il saldo del wallet non basta per questo deposito.');await onOperation('fundERC20',[asset.address,quantity.toString()]);}
    else if(nft?.token&&nft.tokenId){
      if(!/^[1-9][0-9]{0,77}$/.test(amount)||BigInt(amount)>=2n**256n)throw new Error('Inserisci una quantità intera maggiore di zero.');
      if(selection.mode==='mint'){
        if(!inventory!.mintEnabled||!nft.canMint||destination==='slot'&&!nft.canDeposit)throw new Error('Mint non disponibile: verifica proprietà, permessi e catalogo.');
        await onOperation('mintERC1155',[nft.token,nft.tokenId,amount,destination]);
      }else{if(!nft.canDeposit||nft.balance===null||BigInt(amount)>BigInt(nft.balance))throw new Error('Il saldo NFT non basta per questo deposito.');await onOperation('fundERC1155',[nft.token,nft.tokenId,amount]);}
    }else throw new Error('Premio non disponibile. Aggiorna il catalogo.');
    setSelection(null);
  }
  return <>
    <div className="chain-strip"><span className="real-badge">● BASE</span><span>Wallet <code>{inventory?short(inventory.address):'—'}</code></span><span>Contratto <code>{inventory?.contract?short(inventory.contract):'Da collegare'}</code></span><button className="admin-text" onClick={onReload}>Aggiorna ↻</button></div>
    {!inventory&&!loadError&&<p role="status">Lettura dei saldi su Base…</p>}
    {slot&&(!slot.funding||!slot.funding.ready)&&<div className="admin-feedback" role="status"><b>{slot.funding?'Rifornimento necessario.':'Riserve da verificare.'}</b> {slot.funding?'Le riserve disponibili non coprono una nuova giocata. Deposita i premi mancanti per riaprire la slot.':'Le nuove giocate restano bloccate finché la lettura non torna disponibile.'}</div>}
    {inventory&&!inventory.catalogAvailable&&<p className="admin-feedback">Catalogo slot non disponibile. Puoi consultare i saldi; i depositi richiedono un catalogo verificato.</p>}
    {error&&<p className="admin-error" role="alert">{error}</p>}
    <div className="asset-grid">
      <article className="admin-card asset-card"><header><img className="asset-logo" src={ETH_ASSET.logo} alt=""/><div><h2>Ethereum</h2><span>ETH · BASE</span></div></header><div className="inventory-balances"><div><span>Wallet condiviso</span><strong>{inventory?.eth??'—'} <small>ETH</small></strong></div><div><span>Contratto slot</span><strong>{inventory?.contractEth??'—'} <small>ETH</small></strong></div></div><p className="fine-print">Gli ETH nel wallet pagano swap e commissioni. Le riserve dei premi sono nei token indicati sotto.</p></article>
      {inventory?.assets.map(a=>{
        const missing=slot?.funding?.assets.find(stock=>stock.kind===1&&stock.token.toLowerCase()===a.address.toLowerCase())?.missing;
        return <article className="admin-card asset-card" key={a.id}><header><img className="asset-logo" src={a.logo} alt=""/><div><h2>{a.name}</h2><span>{a.ticker} · BASE</span></div></header><Balances wallet={a.balance} reserve={a.reserve} decimals={a.decimals} ticker={a.ticker}/><a className="asset-address" href={'https://basescan.org/token/'+a.address} target="_blank" rel="noreferrer">{short(a.address)} ↗</a>{missing&&BigInt(missing)>0n&&<p className="inventory-shortfall">Mancano {units(missing,a.decimals)} {a.ticker} per una nuova giocata.</p>}<button className="admin-secondary" disabled={unavailable||!a.canDeposit||!a.verified||BigInt(a.balance||'0')===0n} onClick={()=>choose({type:'erc20',id:a.id,mode:'deposit'})}>Deposita nella slot ↗</button>{inventory.contract&&!a.canDeposit&&a.symbol!==null&&<button className="admin-text" disabled={unavailable||!slot?.permissions?.manager} onClick={()=>onConfigure(a)}>Configura premio ↗</button>}</article>;
      })}
    </div>
    <div className="card-heading inventory-heading"><h2>Premi ERC1155</h2><span className="real-badge">WALLET + CONTRATTO</span></div>
    {inventory&&<section className="admin-card collection-access"><div><span className="eyebrow">COLLEZIONE PREMI</span><a className="asset-address" href={'https://basescan.org/address/'+inventory.collection.address} target="_blank" rel="noreferrer">{inventory.collection.address} ↗</a></div>{!inventory.collection.canMint&&<p>Il mint richiede che il wallet condiviso sia owner della collezione. Owner attuale: <code>{inventory.collection.owner||'non disponibile'}</code>. Il proprietario attuale deve avviare il trasferimento verso <code>{inventory.address}</code>; poi puoi accettarlo qui.</p>}{inventory.collection.canAcceptOwnership&&inventory.canManageOwnership&&<button className="admin-secondary" disabled={unavailable} onClick={()=>void run(()=>onOperation('acceptPrizeOwnership',[inventory.collection.address]))}>Accetta proprietà collezione con Privy ↗</button>}{!inventory.mintEnabled&&<p>Per abilitare il mint al collaboratore, il proprietario deve aggiornare i suoi permessi in Wallet admin.</p>}</section>}
    <div className="collectible-grid">{inventory?.nfts.map(n=>{
      const missing=slot?.funding?.assets.find(stock=>stock.kind===2&&stock.token.toLowerCase()===n.token?.toLowerCase()&&stock.tokenId===n.tokenId)?.missing;
      return <article className="admin-card collectible-card" key={n.symbol}><img src={'/symbols/symbol-'+n.symbol+'.svg'} alt=""/><h3>{n.name}</h3><span>{n.token?'ERC1155 · ID '+n.tokenId:'Token da configurare'}</span><Balances wallet={n.balance} reserve={n.reserve} ticker="NFT"/>{missing&&BigInt(missing)>0n&&<p className="inventory-shortfall">Mancano {missing} NFT per una nuova giocata.</p>}<div className="collectible-actions"><button className="admin-secondary" disabled={unavailable||!n.canDeposit||BigInt(n.balance||'0')===0n} onClick={()=>choose({type:'nft',id:String(n.symbol),mode:'deposit'})}>Deposita NFT ↗</button><button className="admin-secondary" disabled={unavailable||!inventory.mintEnabled||!n.canMint} onClick={()=>choose({type:'nft',id:String(n.symbol),mode:'mint'})}>Mint NFT ↗</button></div>{n.token&&!n.canDeposit&&<small>Configura il simbolo {n.symbol}, questa collezione e l’ID {n.tokenId} in Premi prima di depositare nella slot.</small>}</article>;
    })}<article className="admin-card collectible-card free-spin-card"><img src="/symbols/symbol-1.svg" alt=""/><h3>Free spin</h3><span>{inventory?.freeSpins??'—'} per il wallet condiviso</span><small>Contatore onchain · non trasferibile come token</small></article></div>
    {selection&&(asset||nft)&&<section ref={panel} className="admin-card inventory-deposit" aria-label="Prepara deposito o mint"><div className="card-heading"><h2>{selection.mode==='mint'?'Mint':'Deposita'} {asset?.name||nft?.name}</h2><button className="admin-text" disabled={busy||working} onClick={()=>setSelection(null)}>Chiudi ×</button></div><Balances wallet={asset?.balance??nft?.balance??null} reserve={asset?.reserve??nft?.reserve??null} ticker={asset?.ticker||'NFT'} decimals={asset?.decimals||0}/><p>{selection.mode==='mint'?'Crea nuove unità dell’ID esistente. Seleziona dove riceverle.':'Trasferisci dal wallet condiviso al contratto slot.'}</p><form onSubmit={event=>{event.preventDefault();void run(submit);}}><label>{asset?'Importo '+asset.ticker:'Quantità NFT'}<input autoFocus inputMode={asset?'decimal':'numeric'} required value={amount} disabled={busy||working} onChange={event=>setAmount(event.target.value.replace(',','.'))}/></label>{selection.mode==='mint'&&<label>Destinazione<select value={destination} disabled={busy||working} onChange={event=>setDestination(event.target.value)}><option value="wallet">Wallet condiviso</option><option value="slot" disabled={!nft?.canDeposit}>Contratto slot · mint e deposito diretto</option></select></label>}<p className="fine-print">Destinatario: <code>{destination==='wallet'?inventory?.address:inventory?.contract}</code>. Firma dal wallet Privy condiviso; gas in USDC o ETH secondo la configurazione.</p><button className="admin-primary" disabled={unavailable} type="submit">Simula e conferma {selection.mode==='mint'?'mint':'deposito'} ↗</button></form></section>}
    {inventory&&<p className="fine-print">Entrambi i saldi sono letti al blocco {inventory.block}. — indica un dato non disponibile. “Impegnato” copre le giocate già aperte.</p>}
  </>;
}
