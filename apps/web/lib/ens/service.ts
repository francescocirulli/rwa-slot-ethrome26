import {createPublicClient,http,encodeAbiParameters,encodeFunctionData,keccak256,toHex,zeroHash,namehash,type Address,type Hex} from 'viem';
import {sepolia} from 'viem/chains';
import {createBaseReadClient} from '../base-read-client';
import {BASE_PRIZE_COLLECTION,prizeCollectionAbi} from '../prize-collection';
import {SlotError} from '../slot/errors';
import {ensContracts,ENS_PARENT,ENS_BACKEND,normalizeLabel,type EnsConfig} from './config';
import {ensRegistrarAbi,ensRegistryAbi} from './abi';
import {createEnsSender} from './sender';
import {createEnsWorker} from './worker';
import {createVoucherSource,voucherTransaction} from './source';
export type EnsClaim={id:Hex;label:string;name:string;completed:boolean;stage:'voucher'|'finalizing-base'|'ready'|'registered';owner:Address;resolver:Address};
export type EnsName={name:string;owner:Address;expiry:string;resolvedAddress:Address|null};
export function createEnsService(config:EnsConfig,key?:Hex){
  const client=createPublicClient({chain:sepolia,transport:http(config.rpcUrl,{timeout:12000,retryCount:0})});
  const base=createBaseReadClient();
  const sender=key?createEnsSender(config.rpcUrl,key):undefined;
  const registrar={address:config.registrar,abi:ensRegistrarAbi};
  const registry={address:config.registry,abi:ensRegistryAbi};
  const pageBlocks=/^[1-9][0-9]*$/.test(process.env.SLOT_LOG_PAGE_BLOCKS||'')?BigInt(process.env.SLOT_LOG_PAGE_BLOCKS!):1000n;
  const source=createVoucherSource({client:base,registrar:config.registrar,fromBlock:config.sourceBlock,pageBlocks});
  const labels=new Map<string,string>();let cursor=config.deploymentBlock;let scan:Promise<void>|undefined;
  const ownerLocks=new Map<string,Promise<unknown>>();
  async function exclusive<T>(owner:Address,fn:()=>Promise<T>):Promise<T>{
    const k=owner.toLowerCase();if(ownerLocks.has(k))throw new SlotError('EnsBusy','An ENS operation is in progress. Check again shortly.',409);
    const work=Promise.resolve().then(fn);ownerLocks.set(k,work);try{return await work;}finally{ownerLocks.delete(k);}
  }
  async function check(){
    if(await client.getChainId()!==11155111||await base.getChainId()!==8453)throw new SlotError('EnsChain','ENS network configuration mismatch.',503);
    const [backend,actualRegistry,parent,subregistry]=await Promise.all([
      client.readContract({...registrar,functionName:'backend'}),client.readContract({...registrar,functionName:'registry'}),client.readContract({...registrar,functionName:'parentNode'}),
      client.readContract({address:ensContracts.ETHRegistry.address,abi:ensRegistryAbi,functionName:'getSubregistry',args:['wallstreetslot']})]);
    if(backend.toLowerCase()!==ENS_BACKEND.toLowerCase()||
       actualRegistry.toLowerCase()!==config.registry.toLowerCase()||subregistry.toLowerCase()!==config.registry.toLowerCase()||parent!==namehash(ENS_PARENT)||
       sender&&sender.account.address.toLowerCase()!==backend.toLowerCase())throw new SlotError('EnsConfig','ENS contracts or backend wallet do not match the configured deployment.',503);
  }
  async function getClaim(id:Hex,owner:Address):Promise<EnsClaim>{
    const c=await client.readContract({...registrar,functionName:'claim',args:[id]});
    if(c.owner.toLowerCase()!==owner.toLowerCase())throw new SlotError('EnsClaim','Claim unavailable for this wallet.',404);
    let stage:EnsClaim['stage']=c.completed?'registered':'voucher';
    if(!c.completed){
      const found=await source.find(id,owner,keccak256(toHex(c.label)));
      if(found)stage=found.finalized?'ready':'finalizing-base';
    }
    return {id,label:c.label,name:c.label+'.'+ENS_PARENT,owner:c.owner,resolver:c.resolver,completed:c.completed,stage};
  }
  async function claims(owner:Address){
    const count=await client.readContract({...registrar,functionName:'claimCount',args:[owner]});
    if(count>256n)throw new SlotError('EnsLimit','Claim history requires pagination.',503);
    const result:EnsClaim[]=[];
    for(let i=0n;i<count;i++){const id=await client.readContract({...registrar,functionName:'claimAt',args:[owner,i]});result.push(await getClaim(id,owner));}
    return result;
  }
  async function names(owner:Address):Promise<EnsName[]>{
    if(!scan)scan=(async()=>{
      const head=await client.getBlockNumber();const end=head>1n?head-1n:head;
      // Bounded incremental scan, replay the trailing page after every refresh for reorg safety.
      let pages=0;
      while(cursor<=end&&pages++<20){const to=cursor+1999n>end?end:cursor+1999n;
        const logs=await client.getLogs({...registry,event:ensRegistryAbi[4],fromBlock:cursor,toBlock:to});
        for(const log of logs)if(log.args.label&&log.args.labelHash)labels.set(log.args.labelHash,log.args.label);
        cursor=to+1n;
      }
      if(cursor<=end)throw new SlotError('EnsIndex','ENS history is catching up. Refresh shortly.',503);
      cursor=end>config.deploymentBlock+1999n?end-1999n:config.deploymentBlock;
    })().finally(()=>{scan=undefined;});
    await scan;
    const result:EnsName[]=[];
    for(const [hash,label] of labels){
      const state=await client.readContract({...registry,functionName:'getState',args:[BigInt(hash)]});
      if(state.status!==2||state.latestOwner.toLowerCase()!==owner.toLowerCase())continue;
      const name=label+'.'+ENS_PARENT;
      result.push({name,owner:state.latestOwner,expiry:state.expiry.toString(),resolvedAddress:await client.getEnsAddress({name})});
    }
    return result;
  }
  function signer(){if(!sender)throw new SlotError('EnsDisabled','ENS registration is not configured yet.',503);return sender;}
  const service={config,check,claims,names,getClaim,
    async available(input:unknown){const label=normalizeLabel(input);const [id,state]=await Promise.all([
      client.readContract({...registrar,functionName:'labelClaim',args:[keccak256(toHex(label))]}),
      client.readContract({...registry,functionName:'getState',args:[BigInt(keccak256(toHex(label)))]})]);return {label,name:label+'.'+ENS_PARENT,available:id===zeroHash&&state.status===0};},
    async reserve(owner:Address,input:unknown){return exclusive(owner,async()=>{
      await check();const s=signer(),label=normalizeLabel(input),existing=await claims(owner);
      const same=existing.find(c=>c.label===label);if(same)return same;
      if(existing.some(c=>!c.completed))throw new SlotError('EnsPending','Complete your existing ENS claim before starting another.',409);
      const balance=await base.readContract({address:BASE_PRIZE_COLLECTION,abi:prizeCollectionAbi,functionName:'balanceOf',args:[owner,2n]});
      if(balance<1n)throw new SlotError('EnsVoucher','You need one ENS Registration voucher on Base.',409);
      const id=keccak256(encodeAbiParameters([{type:'address'},{type:'address'},{type:'string'}],[config.registrar,owner,label]));
      await s.send(config.registrar,encodeFunctionData({abi:ensRegistrarAbi,functionName:'reserve',args:[id,owner,label]}));return getClaim(id,owner);
    });},
    async prepareVoucher(owner:Address,id:Hex){
      await check();
      const [parent,expiry]=await Promise.all([
        client.readContract({address:ensContracts.ETHRegistry.address,abi:ensRegistryAbi,functionName:'getState',args:[BigInt(keccak256(toHex('wallstreetslot')))]}),
        client.readContract({...registrar,functionName:'expiry'})]);
      if(parent.status!==2||parent.latestOwner.toLowerCase()!==ENS_BACKEND.toLowerCase()||expiry>parent.expiry||expiry<BigInt(Math.floor(Date.now()/1000)+3600))throw new SlotError('EnsExpiry','ENS registration needs operator renewal before this voucher can be consumed.',503);
      const c=await getClaim(id,owner);if(c.stage!=='voucher')throw new SlotError('EnsConsumed','Voucher already consumed. Continue registration.',409);
      signer();
      return voucherTransaction(config.registrar,owner,id,keccak256(toHex(c.label)));
    },
    async fulfill(owner:Address,id:Hex){return exclusive(owner,async()=>{
      await check();const c=await getClaim(id,owner);if(c.completed)return c;
      if(c.stage!=='ready')throw new SlotError('EnsPending',c.stage==='voucher'?'Consume your voucher first.':'Waiting for Base finality. Your voucher is recorded; do not send another.',409);
      const verified=await source.find(id,owner,keccak256(toHex(c.label)));
      if(!verified?.finalized)throw new SlotError('EnsPending','Waiting for a finalized voucher proof.',409);
      await signer().send(config.registrar,encodeFunctionData({abi:ensRegistrarAbi,functionName:'fulfill',args:[id,verified.proof.source]}));return getClaim(id,owner);
    });},
  };
  const worker=createEnsWorker({fromBlock:config.sourceBlock,pageBlocks,
    // Keep the proof index warm even before anyone opens the phone or redeems.
    head:async()=>(await source.indexFinalized()).finalizedNumber,
    events:async(fromBlock,toBlock)=>{
      const result=[];
      for(const proof of await source.events(fromBlock,toBlock)){
        const claim=await client.readContract({...registrar,functionName:'claim',args:[proof.id]});
        if(!claim.completed&&claim.owner.toLowerCase()===proof.owner.toLowerCase()&&keccak256(toHex(claim.label))===proof.labelHash)result.push({id:proof.id,owner:proof.owner});
      }
      return result;
    },
    complete:async({id,owner})=>{await service.fulfill(owner,id);},
  });
  return {...service,start(){if(sender)worker.start();},stop:worker.stop};
}
export type EnsService=ReturnType<typeof createEnsService>;
