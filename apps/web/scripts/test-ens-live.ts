/** Sepolia-only operator smoke test. Uses a synthetic attestation, never a Base voucher. */
import {createPublicClient,createWalletClient,http,keccak256,toHex,parseAbi,type Abi,type Address} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {sepolia} from 'viem/chains';
import {ENS_BACKEND,ENS_PARENT,ENS_RPC,ensContracts} from '../lib/ens/config';
import {loadBackendPrivateKey} from '../lib/slot/backend-key';
import artifacts from './ens-artifacts.json';
async function main(){
 const apply=process.argv.includes('--apply');
 const registrar=process.env.ENS_REGISTRAR_ADDRESS as Address|undefined;
 if(!registrar)throw Error('Registrar address required.');
 const transport=http(process.env.SEPOLIA_RPC_URL||ENS_RPC,{timeout:15000,retryCount:0});
 const client=createPublicClient({chain:sepolia,transport});
 const key=loadBackendPrivateKey(),account=key?privateKeyToAccount(key):undefined;
 if(await client.getChainId()!==11155111||account&&account.address.toLowerCase()!==ENS_BACKEND.toLowerCase())throw Error('Chain or backend mismatch.');
 const contract={address:registrar,abi:artifacts.SlotENSRegistrar.abi as Abi};
 if((await client.readContract({...contract,functionName:'backend'}) as Address).toLowerCase()!==ENS_BACKEND.toLowerCase())throw Error('Unexpected registrar backend.');
 const label='setup-check',name=label+'.'+ENS_PARENT;
 const id=keccak256(toHex('ENSv2 operator smoke claim v1:'+registrar.toLowerCase()));
 const source=keccak256(toHex('SYNTHETIC SEPOLIA SMOKE TEST - NO BASE VOUCHER:'+registrar.toLowerCase()));
 const wallet=account?createWalletClient({account,chain:sepolia,transport}):undefined;
 async function send(functionName:string,args:unknown[]){
  if(!apply||!account||!wallet)throw Error('Apply and existing backend key required.');
  if(await client.getTransactionCount({address:account.address,blockTag:'latest'})!==await client.getTransactionCount({address:account.address,blockTag:'pending'}))throw Error('Reconcile pending Sepolia transaction first.');
  const {request}=await client.simulateContract({...contract,functionName,args,account});
  const hash=await wallet.writeContract(request);console.log(JSON.stringify({step:functionName,hash}));
  const receipt=await client.waitForTransactionReceipt({hash,confirmations:2,timeout:120000});
  if(receipt.status!=='success')throw Error('Transaction reverted.');
 }
 console.log(JSON.stringify({mode:apply?'apply':'read-only',name,owner:ENS_BACKEND,claimId:id,syntheticSource:source}));
 if(apply){await send('reserve',[id,ENS_BACKEND,label]);await send('fulfill',[id,source]);}
 const claim=await client.readContract({...contract,functionName:'claim',args:[id]}) as {owner:Address;completed:boolean;resolver:Address;source:string};
 if(!claim.completed){console.log(JSON.stringify({completed:false}));return;}
 const registry=await client.readContract({...contract,functionName:'registry'}) as Address;
 const owner=await client.readContract({address:registry,abi:parseAbi(['function getOwner(uint256) view returns (address)']),functionName:'getOwner',args:[BigInt(keccak256(toHex(label)))]}) as Address;
 const resolved=await client.getEnsAddress({name});
 // Registry and resolver expose the same root-role inspection interface.
 const resolver={address:claim.resolver,abi:ensContracts.UserRegistryImpl.abi as Abi};
 const allRoles=BigInt('0x'+'1'.repeat(64));
 const playerHasRoles=await client.readContract({...resolver,functionName:'hasRootRoles',args:[allRoles,ENS_BACKEND]});
 const registrarHasAdminRole=await client.readContract({...resolver,functionName:'hasRootRoles',args:[1n,registrar]});
 if(owner.toLowerCase()!==ENS_BACKEND.toLowerCase()||resolved?.toLowerCase()!==owner.toLowerCase()||!playerHasRoles||registrarHasAdminRole||claim.source!==source)throw Error('Verification failed.');
 console.log(JSON.stringify({complete:true,syntheticAttestation:true,name,owner,resolved,registry,resolver:claim.resolver,playerHasRoles,registrarHasAdminRole}));
}
main().catch(()=>{console.error('ENS live smoke test stopped. Reconcile public receipts before resuming.');process.exitCode=1;});
