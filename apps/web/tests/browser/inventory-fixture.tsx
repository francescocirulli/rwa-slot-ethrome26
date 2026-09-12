// Isolated browser fixture: local balances and callbacks, no Privy or live RPC.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AdminInventory,type AdminInventoryData} from '../../app/admin/inventory';
import {PAYMENT_ASSET,RWA_ASSETS,NFT_PRIZES} from '../../lib/assets';
import {BASE_PRIZE_COLLECTION,BASE_PRIZE_IDS} from '../../lib/prize-collection';
const address='0x0000000000000000000000000000000000000011',contract='0x0000000000000000000000000000000000000099';
const reserve={balance:'10',reserved:'8',available:'2'};
function Fixture(){
  const [locked,setLocked]=useState(false),[last,setLast]=useState('');
  const inventory:AdminInventoryData={address,contract,block:'100',updatedAt:Date.now(),eth:'0.1',contractEth:'0.02',catalogAvailable:true,freeSpins:'0',mintEnabled:!locked,swapEnabled:true,canManageOwnership:true,
    collection:{address:BASE_PRIZE_COLLECTION,owner:locked?contract:address,pendingOwner:address,canMint:!locked,canAcceptOwnership:locked},
    assets:[PAYMENT_ASSET,...RWA_ASSETS].map(a=>({...a,balance:'100000000',formatted:'100',verified:true,canDeposit:true,reserve:{balance:'50000000',reserved:'20000000',available:'30000000'}})),
    nfts:NFT_PRIZES.map(n=>({...n,token:BASE_PRIZE_COLLECTION,tokenId:BASE_PRIZE_IDS[n.symbol],balance:'7',reserve,canDeposit:true,canMint:!locked})),
  };
  return <main className="admin-main" style={{margin:0,padding:24}}><button onClick={()=>setLocked(!locked)}>Toggle owner</button><output data-testid="submitted">{last}</output><h1>Wallet and reserves</h1><AdminInventory inventory={inventory} slot={null} busy={false} loadError="" canDeposit onReload={()=>{}} onConfigure={()=>{}} onOperation={async(action,args)=>{setLast(JSON.stringify({action,args}));}}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
