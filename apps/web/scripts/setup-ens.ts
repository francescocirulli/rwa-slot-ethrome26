/** Sepolia-only setup, read-only unless --apply. Never starts the Base keeper. */
import {createPublicClient,createWalletClient,http,keccak256,toHex,namehash,zeroAddress,zeroHash,encodeFunctionData,parseEventLogs,formatEther,type Abi,type Address,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {sepolia} from 'viem/chains';
import {ensContracts,ENS_BACKEND,ENS_PARENT,ENS_RPC} from '../lib/ens/config';
import artifacts from './ens-artifacts.json';
import {loadBackendPrivateKey} from '../lib/slot/backend-key';
const apply=process.argv.includes('--apply');
const transport=http(process.env.SEPOLIA_RPC_URL||ENS_RPC,{timeout:15000,retryCount:0});
const client=createPublicClient({chain:sepolia,transport});
const key=loadBackendPrivateKey(),account=key?privateKeyToAccount(key):undefined;
const owner=account?.address||ENS_BACKEND;
const wallet=account?createWalletClient({account,chain:sepolia,transport}):undefined;
type Contract={address:Address;abi:Abi};
const eth=ensContracts.ETHRegistry as Contract,registrar=ensContracts.ETHRegistrar as Contract,factory=ensContracts.VerifiableFactory as Contract;
const resolverAbi=ensContracts.PermissionedResolverImpl.abi as Abi,registryAbi=ensContracts.UserRegistryImpl.abi as Abi;
const allRoles=BigInt('0x'+'1'.repeat(64)),label='wallstreetslot',labelHash=BigInt(keccak256(toHex(label))),duration=31536000n;
async function read(c:Contract,functionName:string,args:unknown[]=[]){return client.readContract({...c,functionName,args});}
async function send(c:Contract,functionName:string,args:unknown[]=[]){
  if(!wallet||!account||!apply)throw Error('Live setup requires --apply and the existing backend key.');
  if(await client.getTransactionCount({address:owner,blockTag:'latest'})!==await client.getTransactionCount({address:owner,blockTag:'pending'}))throw Error('Reconcile the pending Sepolia transaction first.');
  const {request}=await client.simulateContract({...c,functionName,args,account});
  const hash=await wallet.writeContract(request);console.log(JSON.stringify({step:functionName,hash}));
  const receipt=await client.waitForTransactionReceipt({hash,confirmations:2,timeout:120000});
  if(receipt.status!=='success')throw Error('Sepolia transaction reverted.');return receipt;
}
async function proxy(implementation:Address,abi:Abi,args:unknown[],saltLabel:string){
  const receipt=await send(factory,'deployProxy',[implementation,BigInt(keccak256(toHex(saltLabel))),encodeFunctionData({abi,functionName:'initialize',args})]);
  const logs=parseEventLogs({abi:factory.abi,eventName:'ProxyDeployed',logs:receipt.logs});
  const deployed=(logs[0]?.args as {proxyAddress?:Address})?.proxyAddress;
  if(!deployed)throw Error('Missing proxy event.');console.log(JSON.stringify({proxy:deployed,saltLabel}));return deployed;
}
async function main(){
  if(await client.getChainId()!==11155111)throw Error('RPC must be Sepolia.');
  if(owner.toLowerCase()!==ENS_BACKEND.toLowerCase())throw Error('Key does not match the existing backend wallet.');
  for(const c of [eth,registrar,factory])if(!await client.getBytecode({address:c.address}))throw Error('Missing ENSv2 contract.');
  let current=await read(eth,'getOwner',[labelHash]) as Address;
  const available=await read(registrar,'isAvailable',[label]) as boolean;
  console.log(JSON.stringify({mode:apply?'apply':'read-only',chainId:11155111,owner,balanceETH:formatEther(await client.getBalance({address:owner})),name:ENS_PARENT,currentOwner:current,available}));
  if(!apply)return;
  if(!account)throw Error('Backend key unavailable.');
  if(current!==zeroAddress&&current.toLowerCase()!==owner.toLowerCase())throw Error('Parent belongs to another wallet.');
  if(current===zeroAddress){
    if(!available)throw Error('Parent unavailable.');
    const secret=keccak256(await account.signMessage({message:'Wall Street Slot ENSv2 Sepolia parent registration v1'}));
    const commitment=await read(registrar,'makeCommitment',[label,owner,secret,zeroAddress,zeroAddress,duration,zeroHash]) as Hex;
    const committed=await read(registrar,'commitmentAt',[commitment]) as bigint;
    const maxAge=await read(registrar,'MAX_COMMITMENT_AGE') as bigint;
    if(committed===0n||(await client.getBlock()).timestamp>=committed+maxAge)await send(registrar,'commit',[commitment]);
    const committedAt=await read(registrar,'commitmentAt',[commitment]) as bigint;
    const minAge=await read(registrar,'MIN_COMMITMENT_AGE') as bigint;
    if((await client.getBlock()).timestamp<committedAt+minAge){console.log(JSON.stringify({step:'commitment-maturing',resumeAfter:Number(committedAt+minAge)}));return;}
    const token=ensContracts.MockUSDC as Contract;
    const [base,premium]=await read(registrar,'getRegisterPrice',[label,duration,token.address]) as [bigint,bigint];
    const price=base+premium;if(price>1000_000000n)throw Error('Unexpected price above 1000 test USDC.');
    const balance=await read(token,'balanceOf',[owner]) as bigint;
    if(balance<price)await send(token,'mint',[owner,price-balance]);
    if((await read(token,'allowance',[owner,registrar.address]) as bigint)<price)await send(token,'approve',[registrar.address,price]);
    await send(registrar,'register',[label,owner,secret,zeroAddress,zeroAddress,duration,token.address,zeroHash]);
    current=await read(eth,'getOwner',[labelHash]) as Address;
    if(current.toLowerCase()!==owner.toLowerCase())throw Error('Ownership verification failed.');
  }
  let registry=await read(eth,'getSubregistry',[label]) as Address;
  if(registry===zeroAddress){registry=(process.env.ENS_SUBREGISTRY_ADDRESS as Address)||await proxy(ensContracts.UserRegistryImpl.address,registryAbi,[owner,allRoles],'wallstreetslot.eth registry v1');await send(eth,'setSubregistry',[labelHash,registry]);}
  let resolver=await read(eth,'getResolver',[label]) as Address;
  if(resolver===zeroAddress){resolver=(process.env.ENS_PARENT_RESOLVER as Address)||await proxy(ensContracts.PermissionedResolverImpl.address,resolverAbi,[owner,allRoles,[]],'wallstreetslot.eth resolver v1');await send(eth,'setResolver',[labelHash,resolver]);}
  const target=await read({address:resolver,abi:resolverAbi},'addr',[namehash(ENS_PARENT)]) as Address;
  if(target.toLowerCase()!==owner.toLowerCase())await send({address:resolver,abi:resolverAbi},'setAddr',[namehash(ENS_PARENT),owner]);
  const resolved=await client.getEnsAddress({name:ENS_PARENT});
  if(resolved?.toLowerCase()!==owner.toLowerCase())throw Error('Universal Resolver verification failed.');
  let claimRegistrar=process.env.ENS_REGISTRAR_ADDRESS as Address|undefined;
  let deploymentBlock:string|undefined;
  const artifact=artifacts.SlotENSRegistrar;
  if(!claimRegistrar){
    const state=await read(eth,'getState',[labelHash]) as {expiry:bigint};
    if(await client.getTransactionCount({address:owner,blockTag:'latest'})!==await client.getTransactionCount({address:owner,blockTag:'pending'}))throw Error('Pending Sepolia transaction.');
    const hash=await wallet!.deployContract({abi:artifact.abi as Abi,bytecode:artifact.bytecode as Hex,args:[owner,registry,factory.address,ensContracts.PermissionedResolverImpl.address,namehash(ENS_PARENT),state.expiry]});
    console.log(JSON.stringify({step:'deploy-claim-registrar',hash}));
    const receipt=await client.waitForTransactionReceipt({hash,confirmations:2,timeout:120000});
    if(receipt.status!=='success'||!receipt.contractAddress)throw Error('Registrar deployment failed.');
    claimRegistrar=receipt.contractAddress;deploymentBlock=receipt.blockNumber.toString();
    console.log(JSON.stringify({ENS_REGISTRAR_ADDRESS:claimRegistrar,ENS_DEPLOYMENT_BLOCK:deploymentBlock}));
  }
  const claimContract={address:claimRegistrar,abi:artifact.abi as Abi};
  if((await read(claimContract,'backend') as Address).toLowerCase()!==owner.toLowerCase()||(await read(claimContract,'registry') as Address).toLowerCase()!==registry.toLowerCase())throw Error('Registrar configuration mismatch.');
  if(!await read({address:registry,abi:registryAbi},'hasRootRoles',[1n,claimRegistrar]))await send({address:registry,abi:registryAbi},'grantRootRoles',[1n,claimRegistrar]);
  console.log(JSON.stringify({complete:true,name:ENS_PARENT,owner,registry,resolver,resolved,ENS_REGISTRAR_ADDRESS:claimRegistrar,ENS_DEPLOYMENT_BLOCK:deploymentBlock,ENS_SUBREGISTRY_ADDRESS:registry}));
}
main().catch(()=>{console.error('ENS setup stopped. Verify public transaction hashes and configuration before resuming. No automatic resend.');process.exitCode=1;});
