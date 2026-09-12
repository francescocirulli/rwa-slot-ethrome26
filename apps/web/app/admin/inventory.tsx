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
  return <div className="inventory-balances"><div><span>Shared wallet</span><strong>{units(wallet,decimals)} <small>{ticker}</small></strong></div><div><span>Slot contract · total</span><strong>{units(reserve?.balance,decimals)} <small>{ticker}</small></strong></div><p><span>Available in the contract <b>{units(reserve?.available,decimals)}</b></span><span>Reserved for spins <b>{units(reserve?.reserved,decimals)}</b></span></p></div>;
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
    if(unavailable||!selection)throw new Error('Refresh the balances before continuing.');
    if(asset){const quantity=assetUnits(amount,asset.decimals);if(!asset.canDeposit||!asset.verified||asset.balance===null||quantity>BigInt(asset.balance))throw new Error('The wallet balance is not enough for this deposit.');await onOperation('fundERC20',[asset.address,quantity.toString()]);}
    else if(nft?.token&&nft.tokenId){
      if(!/^[1-9][0-9]{0,77}$/.test(amount)||BigInt(amount)>=2n**256n)throw new Error('Enter a whole quantity greater than zero.');
      if(selection.mode==='mint'){
        if(!inventory!.mintEnabled||!nft.canMint||destination==='slot'&&!nft.canDeposit)throw new Error('Mint unavailable: check ownership, permissions and catalog.');
        await onOperation('mintERC1155',[nft.token,nft.tokenId,amount,destination]);
      }else{if(!nft.canDeposit||nft.balance===null||BigInt(amount)>BigInt(nft.balance))throw new Error('The NFT balance is not enough for this deposit.');await onOperation('fundERC1155',[nft.token,nft.tokenId,amount]);}
    }else throw new Error('Prize unavailable. Refresh the catalog.');
    setSelection(null);
  }
  return <>
    <div className="chain-strip"><span className="real-badge">● BASE</span><span>Wallet <code>{inventory?short(inventory.address):'—'}</code></span><span>Contract <code>{inventory?.contract?short(inventory.contract):'Not linked'}</code></span><button className="admin-text" onClick={onReload}>Refresh ↻</button></div>
    {!inventory&&!loadError&&<p role="status">Reading balances on Base…</p>}
    {slot&&(!slot.funding||!slot.funding.ready)&&<div className="admin-feedback" role="status"><b>{slot.funding?'Restock needed.':'Reserves to verify.'}</b> {slot.funding?'Available reserves do not cover a new spin. Deposit the missing prizes to reopen the slot.':'New spins stay blocked until the read is available again.'}</div>}
    {inventory&&!inventory.catalogAvailable&&<p className="admin-feedback">Slot catalog unavailable. You can review balances; deposits require a verified catalog.</p>}
    {error&&<p className="admin-error" role="alert">{error}</p>}
    <div className="asset-grid">
      <article className="admin-card asset-card"><header><img className="asset-logo" src={ETH_ASSET.logo} alt=""/><div><h2>Ethereum</h2><span>ETH · BASE</span></div></header><div className="inventory-balances"><div><span>Shared wallet</span><strong>{inventory?.eth??'—'} <small>ETH</small></strong></div><div><span>Slot contract</span><strong>{inventory?.contractEth??'—'} <small>ETH</small></strong></div></div><p className="fine-print">ETH in the wallet pays for swaps and fees. Prize reserves are held in the tokens listed below.</p></article>
      {inventory?.assets.map(a=>{
        const missing=slot?.funding?.assets.find(stock=>stock.kind===1&&stock.token.toLowerCase()===a.address.toLowerCase())?.missing;
        return <article className="admin-card asset-card" key={a.id}><header><img className="asset-logo" src={a.logo} alt=""/><div><h2>{a.name}</h2><span>{a.ticker} · BASE</span></div></header><Balances wallet={a.balance} reserve={a.reserve} decimals={a.decimals} ticker={a.ticker}/><a className="asset-address" href={'https://basescan.org/token/'+a.address} target="_blank" rel="noreferrer">{short(a.address)} ↗</a>{missing&&BigInt(missing)>0n&&<p className="inventory-shortfall">{units(missing,a.decimals)} {a.ticker} missing for a new spin.</p>}<button className="admin-secondary" disabled={unavailable||!a.canDeposit||!a.verified||BigInt(a.balance||'0')===0n} onClick={()=>choose({type:'erc20',id:a.id,mode:'deposit'})}>Deposit into the slot ↗</button>{inventory.contract&&!a.canDeposit&&a.symbol!==null&&<button className="admin-text" disabled={unavailable||!slot?.permissions?.manager} onClick={()=>onConfigure(a)}>Configure prize ↗</button>}</article>;
      })}
    </div>
    <div className="card-heading inventory-heading"><h2>ERC1155 prizes</h2><span className="real-badge">WALLET + CONTRACT</span></div>
    {inventory&&<section className="admin-card collection-access"><div><span className="eyebrow">PRIZE COLLECTION</span><a className="asset-address" href={'https://basescan.org/address/'+inventory.collection.address} target="_blank" rel="noreferrer">{inventory.collection.address} ↗</a></div>{!inventory.collection.canMint&&<p>Minting requires the shared wallet to own the collection. Current owner: <code>{inventory.collection.owner||'unavailable'}</code>. The current owner must start the transfer to <code>{inventory.address}</code>; then you can accept it here.</p>}{inventory.collection.canAcceptOwnership&&inventory.canManageOwnership&&<button className="admin-secondary" disabled={unavailable} onClick={()=>void run(()=>onOperation('acceptPrizeOwnership',[inventory.collection.address]))}>Accept collection ownership with Privy ↗</button>}{!inventory.mintEnabled&&<p>To enable minting for the collaborator, the owner must update their permissions in Admin wallet.</p>}</section>}
    <div className="collectible-grid">{inventory?.nfts.map(n=>{
      const missing=slot?.funding?.assets.find(stock=>stock.kind===2&&stock.token.toLowerCase()===n.token?.toLowerCase()&&stock.tokenId===n.tokenId)?.missing;
      return <article className="admin-card collectible-card" key={n.symbol}><img src={'/symbols/symbol-'+n.symbol+'.svg'} alt=""/><h3>{n.name}</h3><span>{n.token?'ERC1155 · ID '+n.tokenId:'Token to configure'}</span><Balances wallet={n.balance} reserve={n.reserve} ticker="NFT"/>{missing&&BigInt(missing)>0n&&<p className="inventory-shortfall">{missing} NFT missing for a new spin.</p>}<div className="collectible-actions"><button className="admin-secondary" disabled={unavailable||!n.canDeposit||BigInt(n.balance||'0')===0n} onClick={()=>choose({type:'nft',id:String(n.symbol),mode:'deposit'})}>Deposit NFT ↗</button><button className="admin-secondary" disabled={unavailable||!inventory.mintEnabled||!n.canMint} onClick={()=>choose({type:'nft',id:String(n.symbol),mode:'mint'})}>Mint NFT ↗</button></div>{n.token&&!n.canDeposit&&<small>Configure symbol {n.symbol}, this collection and ID {n.tokenId} in Prizes before depositing into the slot.</small>}</article>;
    })}<article className="admin-card collectible-card free-spin-card"><img src="/symbols/symbol-1.svg" alt=""/><h3>Free spin</h3><span>{inventory?.freeSpins??'—'} for the shared wallet</span><small>Onchain counter · not transferable as a token</small></article></div>
    {selection&&(asset||nft)&&<section ref={panel} className="admin-card inventory-deposit" aria-label="Prepare deposit or mint"><div className="card-heading"><h2>{selection.mode==='mint'?'Mint':'Deposit'} {asset?.name||nft?.name}</h2><button className="admin-text" disabled={busy||working} onClick={()=>setSelection(null)}>Close ×</button></div><Balances wallet={asset?.balance??nft?.balance??null} reserve={asset?.reserve??nft?.reserve??null} ticker={asset?.ticker||'NFT'} decimals={asset?.decimals||0}/><p>{selection.mode==='mint'?'Mint new units of the existing ID. Choose where to receive them.':'Transfer from the shared wallet to the slot contract.'}</p><form onSubmit={event=>{event.preventDefault();void run(submit);}}><label>{asset?asset.ticker+' amount':'NFT quantity'}<input autoFocus inputMode={asset?'decimal':'numeric'} required value={amount} disabled={busy||working} onChange={event=>setAmount(event.target.value.replace(',','.'))}/></label>{selection.mode==='mint'&&<label>Destination<select value={destination} disabled={busy||working} onChange={event=>setDestination(event.target.value)}><option value="wallet">Shared wallet</option><option value="slot" disabled={!nft?.canDeposit}>Slot contract · mint and direct deposit</option></select></label>}<p className="fine-print">Recipient: <code>{destination==='wallet'?inventory?.address:inventory?.contract}</code>. Signed from the shared Privy wallet; gas in USDC or ETH as configured.</p><button className="admin-primary" disabled={unavailable} type="submit">Simulate and confirm {selection.mode==='mint'?'mint':'deposit'} ↗</button></form></section>}
    {inventory&&<p className="fine-print">Both balances are read at block {inventory.block}. — means the value is unavailable. “Reserved” covers spins already open.</p>}
  </>;
}
