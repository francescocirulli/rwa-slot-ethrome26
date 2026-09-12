import test from 'node:test';
import assert from 'node:assert/strict';
import {zeroAddress,type Address,type Hex} from 'viem';
import {createEnsApi} from '../lib/ens/api';
import {ensConfig,normalizeLabel} from '../lib/ens/config';
import type {EnsService,EnsClaim} from '../lib/ens/service';
import {walletFixture,testAccount} from './fixtures';
import {createWriteCoordinator} from '../lib/admin/write-coordinator';
import {authorizedTestRequest} from './helpers/wallet-authorization';
const origin='https://slot.example',claimId=('0x'+'1'.repeat(64)) as Hex;
function fixture(){
 const f=walletFixture(),writes=createWriteCoordinator();let sends=0,reserves=0,completed=0;
 const c:EnsClaim={id:claimId,label:'frank',name:'frank.wallstreetslot.eth',owner:testAccount.address,resolver:zeroAddress,completed:false,stage:'voucher'};
 const service={names:async(owner:Address)=>{assert.equal(owner,testAccount.address);return [];},claims:async()=>[c],getClaim:async()=>c,
 available:async()=>({available:true}),reserve:async(owner:Address)=>{assert.equal(owner,testAccount.address);reserves++;return c;},
 prepareVoucher:async()=>{if(c.stage!=='voucher')throw Error('Already consumed');return {to:zeroAddress,data:'0x1234',chainId:8453};},fulfill:async()=>{completed++;return c;}} as unknown as EnsService;
 service.prepareReview=async(owner,id)=>({claim:await service.getClaim(id,owner),transaction:await service.prepareVoucher(owner,id)});
 const walletService={...f.service,sendOwned:async(_wallet:unknown,authorization:any,transaction:any,_key:string,mode:string)=>{assert.equal(transaction.chainId,8453);assert.equal(mode,'usdc');sends++;await authorization.sign_fns[0](new Uint8Array([1,2,3]));return {transactionId:'test-transaction'};}};
 const api=createEnsApi({service,walletService,origin,writes});
 async function call(body?:unknown,token='player-a',headers:Record<string,string>={}){
   const req=new Request(origin+'/api/ens?address='+zeroAddress,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json','X-Slot-Request':'1',...headers},body:body?JSON.stringify(body):undefined});
   const response=(body as any)?.action==='send'?await authorizedTestRequest(req,'did:privy:'+token,api):await api(req);
   return {status:response.status,body:await response.json()};
 }
 return {call,writes,c,service,walletService,counts:()=>({sends,reserves,completed}),api};
}
test('ENS names are scoped to verified personal wallets; auth/origin/consent fail closed',async()=>{
 const f=fixture();assert.equal((await f.call(undefined,'invalid')).status,401);
 assert.equal((await f.call(undefined,'no-wallet')).status,409);
 assert.equal((await f.call()).status,200);
 assert.equal((await f.call({action:'reserve',label:'frank',confirm:true},'player-a',{Origin:'https://evil.example'})).status,403);
 assert.equal((await f.call({action:'reserve',label:'frank'})).status,400);
 assert.equal((await f.call({action:'reserve',label:'frank',confirm:true,address:zeroAddress})).status,200);
 assert.equal(f.counts().reserves,1);
});
test('ENS review shares the spin/transfer lock by lowercase address and cancellation releases it',async()=>{
 const f=fixture(),p=await f.call({action:'prepare',claimId});assert.equal(p.status,200);assert.equal(p.body.registrationPayer,'backend');assert.equal(p.body.gasMode,'usdc');
 await assert.rejects(f.writes.acquire(testAccount.address.toLowerCase(),'spin',async()=>false),/operation in progress/);
 const recovered=await f.call({action:'prepare',claimId});assert.equal(recovered.status,200);assert.equal(recovered.body.id,p.body.id);
 assert.equal((await f.call({action:'cancel',id:p.body.id})).status,200);
 await f.writes.acquire(testAccount.address.toLowerCase(),'spin',async()=>false);
 assert.equal((await f.call({action:'prepare',claimId})).status,409);
});
test('cross-account review theft and duplicate confirms cannot cause additional voucher sends',async()=>{
 const f=fixture(),p=await f.call({action:'prepare',claimId});
 assert.equal((await f.call({action:'send',id:p.body.id,confirm:true},'player-b')).status,404);
 assert.equal((await f.call({action:'send',id:p.body.id})).status,400);
 assert.equal((await f.call({action:'send',id:p.body.id,confirm:true,transaction:{to:zeroAddress}})).status,200);
 assert.equal((await f.call({action:'send',id:p.body.id,confirm:true})).status,200);
 assert.equal(f.counts().sends,1);
 f.c.stage='finalizing-base';await f.call({action:'status',id:p.body.id});
 await f.writes.acquire(testAccount.address.toLowerCase(),'spin',async()=>false);
});
test('ENS source consumption releases the shared lock even without a status poll',async()=>{
 const f=fixture();await f.call({action:'prepare',claimId});f.c.stage='ready';
 await f.writes.acquire(testAccount.address.toLowerCase(),'spin',async()=>false);
});
test('disabled ENS does not break authenticated wallet reads',async()=>{
 const f=walletFixture(),api=createEnsApi({service:null,walletService:f.service,origin});
 const r=await api(new Request(origin+'/api/ens',{headers:{Authorization:'Bearer player-a'}}));
 assert.equal((await r.json()).configured,false);
});
test('name policy and network config reject malformed/partial deployments',()=>{
 assert.equal(normalizeLabel(' Frank '),'frank');
 for(const v of ['aa','a.b','-frank','frank-','fränk','a b','a'.repeat(33)])assert.throws(()=>normalizeLabel(v));
 assert.equal(ensConfig({}),null);assert.throws(()=>ensConfig({ENS_REGISTRAR_ADDRESS:testAccount.address}));
});

test('worker retries failed fulfillment and rebuilds from finalized source events after restart',async()=>{
 const {createEnsWorker}=await import('../lib/ens/worker');
 const done=new Set<string>();let attempts=0,fail=true,head=12n;const pages:Array<[bigint,bigint]>=[];
 const deps={fromBlock:10n,pageBlocks:2n,head:async()=>head,events:async(from:bigint,to:bigint)=>{pages.push([from,to]);return from===10n?[{id:claimId,owner:testAccount.address}]:[];},complete:async({id}:{id:Hex})=>{if(done.has(id))return;attempts++;if(fail)throw Error('RPC');done.add(id);}};
 const first=createEnsWorker(deps);await first.tick();assert.equal(first.state().pending,1);assert.deepEqual(pages,[[10n,11n],[12n,12n]]);
 fail=false;await first.tick();assert.equal(first.state().pending,0);assert.equal(attempts,2);
 first.stop();const second=createEnsWorker(deps);await second.tick();assert.equal(attempts,2);assert.equal(second.state().pending,0);second.stop();
});

test('provider error payloads never appear in ENS responses',async()=>{
 const f=walletFixture();
 const api=createEnsApi({service:{names:async()=>{throw Error('private-rpc-payload');},claims:async()=>[]} as unknown as EnsService,walletService:f.service,origin});
 const response=await api(new Request(origin+'/api/ens',{headers:{Authorization:'Bearer player-a'}}));
 assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private-rpc-payload/);
});

test('generated ENS deployment artifacts match Solidity sources',async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
 const artifacts=JSON.parse(await readFile(new URL('../scripts/ens-artifacts.json',import.meta.url),'utf8'));
 for(const name of ['SlotENSRegistrar']){
  const source=await readFile(new URL('../../../contracts/src/'+name+'.sol',import.meta.url));
  assert.equal(artifacts[name].sourceHash,createHash('sha256').update(source).digest('hex'));
  assert.ok(artifacts[name].bytecode.startsWith('0x'));
 }
});

test('a voucher consumed after review cannot be sent again and a failed preflight releases the lock',async()=>{
 const f=fixture(),p=await f.call({action:'prepare',claimId});f.c.stage='ready';
 assert.equal((await f.call({action:'send',id:p.body.id,confirm:true})).status,503);
 assert.equal(f.counts().sends,0);await f.writes.acquire(testAccount.address.toLowerCase(),'spin',async()=>false);
});

test('a submission reference survives an unfinalized reorg and cannot prepare a second voucher transfer',async()=>{
 const f=fixture(),p=await f.call({action:'prepare',claimId});await f.call({action:'send',id:p.body.id,confirm:true});
 f.c.stage='finalizing-base';await f.call({action:'status',id:p.body.id});f.c.stage='voucher';
 assert.equal((await f.call({action:'prepare',claimId})).status,409);
 assert.equal((await f.call({action:'status',id:p.body.id})).status,200);assert.equal(f.counts().sends,1);
});


test('ENS preparation failures explain that no transfer was submitted and release the lease',async()=>{
 const f=fixture();f.service.prepareVoucher=async()=>{throw Error('private-rpc-url-and-signature');};
 const result=await f.call({action:'prepare',claimId});
 assert.equal(result.status,503);assert.equal(result.body.code,'EnsPrepareUnavailable');
 assert.match(result.body.error,/did not submit a transfer/);assert.doesNotMatch(JSON.stringify(result.body),/private-rpc|signature/);
 assert.equal(f.counts().sends,0);await f.writes.acquire(testAccount.address.toLowerCase(),'spin',async()=>false);
});

test('concurrent Continue requests cannot create two reviews or bypass the wallet lease',async()=>{
 const f=fixture();let release!:()=>void;
 const original=f.service.prepareVoucher;
 f.service.prepareVoucher=async(...args)=>{await new Promise<void>(resolve=>{release=resolve;});return original(...args);};
 const first=f.call({action:'prepare',claimId});
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 const second=await f.call({action:'prepare',claimId});assert.equal(second.status,409);assert.equal(second.body.code,'EnsBusy');
 await assert.rejects(f.writes.acquire(testAccount.address.toLowerCase(),'spin',async()=>false),/operation in progress/);
 release();assert.equal((await first).status,200);assert.equal(f.counts().sends,0);
});

test('expired ENS sends report definite failure so a phone can recover without an endless pending marker',async(t)=>{
 const f=fixture(),prepared=await f.call({action:'prepare',claimId});
 t.mock.method(Date,'now',()=>prepared.body.expires+1);
 const result=await f.call({action:'send',id:prepared.body.id,confirm:true});
 assert.equal(result.status,409);assert.equal(result.body.stage,'failed');assert.equal(f.counts().sends,0);
 assert.equal((await f.call({action:'status',id:prepared.body.id})).body.stage,'failed');
 await f.writes.acquire(testAccount.address.toLowerCase(),'spin',async()=>false);
});

test('failed preflight is distinguishable from an ambiguous ENS submission',async()=>{
 const f=fixture(),prepared=await f.call({action:'prepare',claimId});
 f.service.prepareVoucher=async()=>{throw Error('RPC unavailable');};
 const result=await f.call({action:'send',id:prepared.body.id,confirm:true});
 assert.equal(result.body.stage,'failed');assert.equal(f.counts().sends,0);
 const g=fixture(),second=await g.call({action:'prepare',claimId});
 g.walletService.sendOwned=async()=>{throw Error('unknown provider result with private payload');};
 const ambiguous=await g.call({action:'send',id:second.body.id,confirm:true});
 assert.equal(ambiguous.body.stage,'uncertain');assert.doesNotMatch(JSON.stringify(ambiguous.body),/private payload/);
 assert.equal((await g.call({action:'prepare',claimId})).body.code,'EnsPending');
 await assert.rejects(g.writes.acquire(testAccount.address.toLowerCase(),'spin',async()=>false),/operation in progress/);
});

test('ENS catch-up drains bounded pages promptly and backs off after a read failure',async()=>{
 const {createEnsWorker}=await import('../lib/ens/worker');let fail=false;
 const worker=createEnsWorker({fromBlock:0n,pageBlocks:5n,head:async()=>{if(fail)throw Error('RPC');return 199n;},events:async()=>[],complete:async()=>{}});
 await worker.tick();assert.deepEqual(worker.state(),{cursor:100n,pending:0,catchingUp:true});
 fail=true;await assert.rejects(worker.tick());assert.equal(worker.state().catchingUp,false);assert.equal(worker.state().cursor,100n);
 fail=false;await worker.tick();assert.deepEqual(worker.state(),{cursor:200n,pending:0,catchingUp:false});worker.stop();
});
