// Local admin UI fixture: real operation flow with mocked HTTP and Privy hooks.
import {createRoot} from 'react-dom/client';
import {AdminWorkspace} from '../../app/admin/workspace';
const address='0x0000000000000000000000000000000000000011';
const account={userId:'fixture-owner',role:new URLSearchParams(location.search).has('operator')?'operator':'owner',operationsEnabled:true,mintEnabled:true,swapEnabled:true,wallet:{id:'shared',address,balance:{amount:'100'}}} as never;
createRoot(document.getElementById('root')!).render(<AdminWorkspace account={account} identity="fixture-owner" error="" busy={false} onRefresh={()=>{}} onLogout={()=>{}}/>);
