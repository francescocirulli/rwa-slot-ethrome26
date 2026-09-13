import test from 'node:test';
import assert from 'node:assert/strict';
import {APIError} from '@privy-io/node';
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
 const api=createEnsApi({service,walletService,origin,writes,retrySecret:'test-only-stable-retry-secret'});
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

test('funding after a cached rejection uses a signed retry cursor and recovers across server restart',async()=>{
 const f=fixture();let funded=false,actualTransfers=0;
 const provider=new Map<string,{transactionId:string}|APIError>(),keys:string[]=[];
 f.walletService.sendOwned=async(_wallet,_authorization,_transaction,key)=>{
  keys.push(key);
  if(!provider.has(key)){provider.set(key,funded?{transactionId:'funded-transfer'}:new APIError(400,{error:'Insufficient USDC balance'},'Rejected',new Headers()));if(funded)actualTransfers++;}
  const result=provider.get(key)!;if(result instanceof APIError)throw result;return result;
 };
 const first=await f.call({action:'prepare',claimId});
 const rejected=await f.call({action:'send',id:first.body.id,confirm:true});
 assert.equal(rejected.body.stage,'failed');assert.ok(rejected.body.retryToken);
 assert.equal((await f.call({action:'status',id:first.body.id})).body.retryToken,rejected.body.retryToken);
 funded=true;
 // Losing the cursor replays the old rejected key and recovers the same cursor.
 const old=await f.call({action:'prepare',claimId});
 const cached=await f.call({action:'send',id:old.body.id,confirm:true});
 assert.equal(cached.body.retryToken,rejected.body.retryToken);assert.equal(keys[0],keys[2]);assert.equal(keys[1],keys[3]);
 const api=createEnsApi({service:f.service,walletService:f.walletService,origin,writes:createWriteCoordinator(),retrySecret:'test-only-stable-retry-secret'});
 async function call(body:object){
  const req=new Request(origin+'/api/ens',{method:'POST',headers:{Authorization:'Bearer player-a',Origin:origin,'Content-Type':'application/json','X-Slot-Request':'1'},body:JSON.stringify(body)});
  const response=await authorizedTestRequest(req,'did:privy:player-a',api);return {status:response.status,body:await response.json()};
 }
 const next=await call({action:'prepare',claimId,retryToken:rejected.body.retryToken});assert.equal(next.status,200);
 const sent=await call({action:'send',id:next.body.id,confirm:true});assert.equal(sent.body.stage,'submitted');
 assert.notEqual(keys[3],keys[4]);assert.equal(actualTransfers,1);
 await call({action:'send',id:next.body.id,confirm:true});assert.equal(keys.length,5);
 assert.equal((await call({action:'prepare',claimId,retryToken:rejected.body.retryToken})).status,409);
});

test('ENS retry cursors cannot be forged, used by another wallet, or minted for uncertain sends',async()=>{
 const f=fixture();
 assert.equal((await f.call({action:'prepare',claimId,retryToken:'1.'+'A'.repeat(43)})).status,400);
 f.walletService.sendOwned=async()=>{throw new APIError(400,{error:'Insufficient USDC balance'},'Rejected',new Headers());};
 const prepared=await f.call({action:'prepare',claimId});
 const failed=await f.call({action:'send',id:prepared.body.id,confirm:true});
 assert.equal((await f.call({action:'prepare',claimId,retryToken:failed.body.retryToken},'player-b')).status,400);
 for(const [error,stage] of [
  [new APIError(500,{error:'Unknown provider result'},'Unknown',new Headers()),'uncertain'],
  [new APIError(400,{error:'Idempotency key reused with different parameters'},'Conflict',new Headers()),'uncertain'],
  [new APIError(400,{error:'Insufficient USDC balance',transaction_id:'pending'},'Pending',new Headers()),'uncertain'],
  [new APIError(401,{error:'Authentication expired'},'Auth',new Headers()),'failed'],
 ] as const){
  const g=fixture();g.walletService.sendOwned=async()=>{throw error;};
  const p=await g.call({action:'prepare',claimId}),r=await g.call({action:'send',id:p.body.id,confirm:true});
  assert.equal(r.body.stage,stage);assert.equal(r.body.retryToken,undefined);
  if(stage==='uncertain')assert.equal((await g.call({action:'prepare',claimId})).status,409);
 }
});

test('a funded wallet escapes the legacy cached rejection within one confirmation',async()=>{
 const f=fixture();const keys:string[]=[];let transfers=0,signatures=0;
 f.walletService.sendOwned=async(_wallet,authorization,_transaction,key)=>{
  keys.push(key);await authorization.sign_fns[0](new Uint8Array([1,2,3]));signatures++;
  if(key==='ens-voucher:'+claimId)throw new APIError(400,{error:'Insufficient USDC balance'},'Cached rejection',new Headers());
  transfers++;return {transactionId:'funded-transfer'};
 };
 const p=await f.call({action:'prepare',claimId});
 const r=await f.call({action:'send',id:p.body.id,confirm:true});
 assert.equal(r.body.stage,'submitted');assert.equal(transfers,1);assert.equal(signatures,2);
 assert.deepEqual(keys,['ens-voucher:'+claimId,'ens-voucher:'+claimId+':retry:1']);
 await f.call({action:'send',id:p.body.id,confirm:true});assert.equal(transfers,1);
});

test('ENS retries temporary voucher reads under the same review and sends only once',async()=>{
 const f=fixture(),prepare=f.service.prepareReview,voucher=f.service.prepareVoucher;
 let reviews=0,checks=0;
 const unavailable=()=>Object.assign(new Error('private-provider-payload'),{name:'HttpRequestError',status:503});
 f.service.prepareReview=async(...args)=>{if(++reviews===1)throw unavailable();return prepare(...args);};
 const p=await f.call({action:'prepare',claimId});assert.equal(p.status,200);assert.equal(reviews,2);assert.equal(f.counts().sends,0);
 f.service.prepareVoucher=async(...args)=>{if(++checks===1)throw unavailable();return voucher(...args);};
 const sent=await f.call({action:'send',id:p.body.id,confirm:true});assert.equal(sent.status,200);assert.equal(sent.body.stage,'submitted');assert.equal(checks,2);assert.equal(f.counts().sends,1);
});

test('a voucher consumed while a read retries still blocks transfer and releases the lease',async()=>{
 const f=fixture(),p=await f.call({action:'prepare',claimId});let checks=0;
 f.service.prepareVoucher=async()=>{checks++;if(checks===1)throw Object.assign(new Error('temporary'),{name:'TimeoutError'});throw new (await import('../lib/slot/errors')).SlotError('EnsConsumed','Voucher already consumed.',409);};
 const sent=await f.call({action:'send',id:p.body.id,confirm:true});assert.equal(sent.status,409);assert.equal(sent.body.stage,'failed');assert.equal(f.counts().sends,0);assert.equal(checks,2);
 await f.writes.acquire(testAccount.address.toLowerCase(),'next-write',async()=>false);
});

test('an expired review cannot submit after a successful slow voucher check',async()=>{
 const f=fixture(),p=await f.call({action:'prepare',claimId}),voucher=f.service.prepareVoucher;const realNow=Date.now;
 f.service.prepareVoucher=async(...args)=>{const result=await voucher(...args);Date.now=()=>p.body.expires+1;return result;};
 try{const sent=await f.call({action:'send',id:p.body.id,confirm:true});assert.equal(sent.status,409);assert.equal(sent.body.stage,'failed');assert.equal(sent.body.code,'EnsReview');assert.equal(f.counts().sends,0);}finally{Date.now=realNow;}
 await f.writes.acquire(testAccount.address.toLowerCase(),'next-write',async()=>false);
});

test('ENS read recovery is bounded and does not retry auth, semantic or unknown errors',async()=>{
 const {retryEnsRead}=await import('../lib/ens/read-check');const {SlotError}=await import('../lib/slot/errors');
 let attempts=0;const waits:number[]=[];
 await assert.rejects(retryEnsRead('review',async()=>{attempts++;throw {cause:{name:'HttpRequestError',status:429}};},async ms=>{waits.push(ms);}));
 assert.equal(attempts,3);assert.deepEqual(waits,[1000,5000]);
 for(const error of [new SlotError('EnsConsumed','Consumed'),new SlotError('EnsConfig','Mismatch',503),{cause:{name:'HttpRequestError',status:401}},{cause:{name:'ContractFunctionRevertedError'}},new Error('unknown')]){
  attempts=0;await assert.rejects(retryEnsRead('send-check',async()=>{attempts++;throw error;},async()=>{throw Error('Must not wait');}));assert.equal(attempts,1);
 }
 attempts=0;assert.equal(await retryEnsRead('review',async()=>{if(++attempts===1)throw {cause:{message:'RPC providers are temporarily unavailable.'}};return 'verified';},async()=>{}),'verified');
});


test('Sepolia name reads are independent of Base claim checks and remain wallet-scoped',async()=>{
 const f=fixture();let claims=0;
 f.service.claims=async()=>{claims++;throw Error('private-base-provider-payload');};
 f.service.names=async(owner)=>{assert.equal(owner,testAccount.address);return [{name:'frank.wallstreetslot.eth',owner,expiry:'1900000000',resolvedAddress:owner}];};
 const read=(view:string)=>f.api(new Request(origin+'/api/ens?view='+view+'&address='+zeroAddress,{headers:{Authorization:'Bearer player-a'}}));
 const names=await read('names');assert.equal(names.status,200);assert.equal((await names.json()).names[0].owner,testAccount.address);assert.equal(claims,0);
 const failed=await read('claims');assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/private-base-provider-payload/);
 assert.equal(claims,1);assert.equal(f.counts().sends,0);
});

test('claim status reads do not require successful name indexing on Sepolia',async()=>{
 const f=fixture();f.service.names=async()=>{throw Error('history unavailable');};f.c.stage='finalizing-base';
 const response=await f.api(new Request(origin+'/api/ens?view=claims',{headers:{Authorization:'Bearer player-a'}}));
 assert.equal(response.status,200);assert.equal((await response.json()).claims[0].stage,'finalizing-base');
});
