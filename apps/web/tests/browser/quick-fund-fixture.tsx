// Isolated browser fixture: real AdminAssets with local balances, mock Privy and no live RPC.
// The quick-fund sequence must buy the NVIDIA shortfall with USDC, then deposit both prizes.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AdminAssets} from '../../app/admin/assets';
import {RWA_ASSETS} from '../../lib/assets';
const address='0x0000000000000000000000000000000000000011';
const nvidia=RWA_ASSETS.find(asset=>asset.id==='nvidia')!;
const spacex=RWA_ASSETS.find(asset=>asset.id==='spacex')!;
function Fixture(){
  const [submitted,setSubmitted]=useState<string[]>([]);
  const slot={funding:{ready:false,assets:[
    {kind:1,token:nvidia.address,tokenId:'0',required:'10000000000',available:'0',balance:'0',reserved:'0',missing:'10000000000'},
    {kind:1,token:spacex.address,tokenId:'0',required:'5000000000',available:'0',balance:'0',reserved:'0',missing:'5000000000'},
  ]}} as never;
  return <main className="admin-main" style={{margin:0,padding:24}}>
    <output data-testid="submitted">{submitted.join('\n')}</output>
    <AdminAssets tab="swap" address={address} userId="did:privy:test" slot={slot} contractBusy={false} canDeposit onDeposit={async(action,args)=>{setSubmitted(previous=>[...previous,JSON.stringify({action,args})]);}} onRefresh={()=>{}} onSwapBusy={()=>{}} onConfigure={()=>{}}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
