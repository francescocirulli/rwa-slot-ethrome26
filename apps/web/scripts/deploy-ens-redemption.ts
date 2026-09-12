/** Base deployment only after explicit maintenance coordination; does not stop/start a keeper. */
import {createPublicClient,createWalletClient,http,parseAbi,formatEther,type Abi,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {base} from 'viem/chains';
import {BASE_PRIZE_COLLECTION} from '../lib/prize-collection';
import {ENS_BACKEND} from '../lib/ens/config';
import {loadBackendPrivateKey} from '../lib/slot/backend-key';
import artifacts from './ens-artifacts.json';
async function main(){
 const apply=process.argv.includes('--apply'),key=loadBackendPrivateKey(),account=key?privateKeyToAccount(key):undefined;
 const transport=http(process.env.BASE_RPC_URL||'https://base-rpc.publicnode.com',{timeout:12000,retryCount:0});
 const client=createPublicClient({chain:base,transport});
 if(await client.getChainId()!==8453)throw Error('RPC must be Base.');
 if(account&&account.address.toLowerCase()!==ENS_BACKEND.toLowerCase())throw Error('Backend identity mismatch.');
 console.log(JSON.stringify({mode:apply?'apply':'read-only',chainId:8453,backend:ENS_BACKEND,collection:BASE_PRIZE_COLLECTION,balanceETH:formatEther(await client.getBalance({address:ENS_BACKEND}))}));
 if(!apply)return;
 if(!process.argv.includes('--keeper-stopped')||!account)throw Error('Coordinate maintenance: pause the slot, drain games, stop keeper writes, then pass --keeper-stopped.');
 const slot=process.env.SLOT_CONTRACT_ADDRESS as Hex|undefined;if(!slot)throw Error('Slot address required for maintenance checks.');
 const abi=parseAbi(['function paused() view returns(bool)','function getActiveGameIds(uint256 offset,uint256 limit) view returns(uint256[],uint256)']);
 if(!await client.readContract({address:slot,abi,functionName:'paused'})||(await client.readContract({address:slot,abi,functionName:'getActiveGameIds',args:[0n,1n]}))[1]!==0n)throw Error('Slot must be paused and all games drained.');
 if(await client.getTransactionCount({address:account.address,blockTag:'pending'})!==await client.getTransactionCount({address:account.address,blockTag:'latest'}))throw Error('Reconcile pending Base transactions first.');
 const wallet=createWalletClient({account,chain:base,transport}),artifact=artifacts.ENSVoucherRedemption;
 const hash=await wallet.deployContract({abi:artifact.abi as Abi,bytecode:artifact.bytecode as Hex,args:[BASE_PRIZE_COLLECTION,ENS_BACKEND]});
 console.log(JSON.stringify({step:'deploy-base-redemption',hash}));
 const receipt=await client.waitForTransactionReceipt({hash,confirmations:2,timeout:120000});
 if(receipt.status!=='success'||!receipt.contractAddress)throw Error('Deployment did not succeed.');
 console.log(JSON.stringify({ENS_REDEMPTION_ADDRESS:receipt.contractAddress,ENS_REDEMPTION_BLOCK:receipt.blockNumber.toString()}));
}
main().catch(error=>{console.error(error instanceof Error&&error.message.startsWith('Coordinate maintenance:')?error.message:'Base redemption setup stopped. Verify public transaction receipts and maintenance prerequisites before resuming.');process.exitCode=1;});
