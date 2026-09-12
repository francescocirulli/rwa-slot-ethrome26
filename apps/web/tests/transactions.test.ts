import {walletAuthorizations} from '../lib/wallet-authorization';
async function transactionTestRequest(request:Request,userId:string,handle:(request:Request)=>Promise<Response>){if(!new URL(request.url).pathname.endsWith('/send'))return handle(request);const channels=walletAuthorizations(),headers=new Headers(request.headers),{id}=channels.create(userId,new URL(request.url).pathname);headers.set('X-Wallet-Authorization',id);const response=await handle(new Request(request,{headers}));if(!(await channels.poll(id,userId)).claimed)channels.cancel(id,userId);return response;}
import test from 'node:test';
import assert from 'node:assert/strict';
import {createContractApi} from '../lib/slot/transactions';
import type {SlotEngine} from '../lib/slot/engine';
import type {WalletService} from '../lib/types';
import {SlotError} from '../lib/slot/errors';
const origin='https://slot.example',address='0x0000000000000000000000000000000000000011',other='0x0000000000000000000000000000000000000022';
const contract='0x0000000000000000000000000000000000000099',hash=('0x'+'a'.repeat(64)) as `0x${string}`;
function fixture(sharedAdmin=false){
  let now=1000,released:()=>void=()=>{},confirmed=false,fail:Error|undefined,role=true,reordered=false,revoked=false;
  const gate=new Promise<void>(resolve=>{released=resolve;}),sends:unknown[]=[];
  const service={authenticate:async(token:string)=>{if(!['user','other'].includes(token))throw new Error('Auth');const wallets=[{id:token,address:token==='user'?address:other}];if(reordered&&token==='user')wallets.unshift({id:'secondary-wallet',address:other});return {userId:token,wallets};},
    verifyIdentityToken:async(token:string,userId:string)=>{if(token!==userId+'-identity')throw new Error('Identity mismatch');},
    sendOwned:async(wallet:unknown,token:string,tx:unknown,key:string,mode:string,onGas:(gas:string)=>void)=>{sends.push({wallet,token,tx,key,mode});onGas('USDC');await gate;if(fail)throw fail;return {transactionId:'provider-id',gasToken:'USDC'};},
    resolveSpin:async()=>confirmed?hash:undefined} as unknown as WalletService;
  const slot={reader:{validate:async()=>{},config:{address:contract,paymentToken:other,chainId:8453,gasMode:'usdc',confirmations:2},
    client:{simulateContract:async()=>{if(!role)throw new SlotError('Forbidden','Missing role',403);},getTransactionReceipt:async()=>({status:'success',blockNumber:10n}),getBlockNumber:async()=>11n}}} as unknown as SlotEngine;
  const resolve=async(user:{userId:string})=>{if(revoked&&user.userId==='other')throw new SlotError('AdminAccess','Revoked',403);return {wallet:{id:'shared',address:'0x0000000000000000000000000000000000000033'},role:user.userId==='user'?'owner' as const:'operator' as const,operationsEnabled:true};};
  const api=createContractApi({origin,walletService:service,getSlot:()=>slot,now:()=>now,admin:sharedAdmin?{resolve,assertAction:async(user,action)=>{const access=await resolve(user);if(access.role==='operator'&&action==='grantRole')throw new SlotError('AdminAction','Owner only',403);return access;}}:undefined});
  async function call(kind:'prepare'|'send'|'status'|'cancel',body?:unknown,token='user',requestOrigin=origin,scope:'personal'|'admin'='personal'){
    const r=await transactionTestRequest(new Request(origin+(scope==='admin'?'/api/admin/contract/':'/api/contract/')+kind+(kind==='status'?'?id='+body:''),{method:kind==='status'?'GET':'POST',headers:{Authorization:'Bearer '+token,Origin:requestOrigin,'Privy-Id-Token':token+'-identity','Content-Type':'application/json','X-Slot-Request':'1'},body:kind==='status'?undefined:JSON.stringify(body)}),token,request=>api.handle(request,kind,scope));return {status:r.status,body:await r.json()};
  }
  return {call,sends,revoke:()=>{revoked=true;},reorder:()=>{reordered=true;},release:()=>released(),finish:()=>{confirmed=true;},fail:(e:Error)=>{fail=e;},noRole:()=>{role=false;},expire:()=>{now+=300001;}};
}
const action={action:'setTicketPrice',args:['1500000']};
test('prepare is read-only; explicit confirmation uses the verified owner and immutable reviewed calldata once',async()=>{
  const f=fixture(),p=await f.call('prepare',action);assert.equal(p.status,200);assert.equal(p.body.transaction.gasMode,'usdc');assert.equal(f.sends.length,0);
  assert.equal((await f.call('send',{id:p.body.id})).status,400);
  assert.equal((await f.call('send',{id:p.body.id,confirm:true},'other')).status,404);
  f.reorder(); // A refreshed identity may list another embedded wallet first.
  const request={id:p.body.id,confirm:true,address:other,action:'withdrawNative',args:['bad'],transaction:{to:other}};
  await Promise.all([f.call('send',request),f.call('send',request)]);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.sends.length,1);
  const sent=f.sends[0] as any;assert.equal(sent.wallet.address,address);assert.equal(typeof sent.token.sign_fns[0],'function');assert.equal(sent.tx.to,contract);assert.equal(sent.tx.data,p.body.transaction.data);assert.equal(sent.mode,'usdc');
  f.release();await new Promise(resolve=>setTimeout(resolve,0));const pending=await f.call('status',p.body.id);assert.equal(pending.body.stage,'confirming');assert.equal(pending.body.hash,null);
  f.finish();const done=await f.call('status',p.body.id);assert.equal(done.body.stage,'confirmed');assert.equal(done.body.hash,hash);assert.equal(done.body.gasToken,'USDC');
  assert.equal(JSON.stringify(done.body).includes('provider-id'),false);await f.call('send',request);assert.equal(f.sends.length,1);
});
test('authentication, origin, cancellation, expiry and role recheck all prevent writes',async()=>{
  const f=fixture();assert.equal((await f.call('prepare',action,'invalid')).status,401);assert.equal((await f.call('prepare',action,'user','https://other.example')).status,403);
  const p=await f.call('prepare',action);await f.call('cancel',{id:p.body.id});await f.call('send',{id:p.body.id,confirm:true});assert.equal(f.sends.length,0);
  const expired=await f.call('prepare',action);f.expire();await f.call('send',{id:expired.body.id,confirm:true});assert.equal(f.sends.length,0);
  const next=await f.call('prepare',action);f.noRole();await f.call('send',{id:next.body.id,confirm:true});await new Promise(resolve=>setTimeout(resolve,0));assert.equal((await f.call('status',next.body.id)).body.stage,'failed');assert.equal(f.sends.length,0);
});
test('network ambiguity remains blocked: duplicate confirmation and new prepare cannot resend',async()=>{
  const f=fixture(),p=await f.call('prepare',action);f.fail(new Error('timeout'));f.release();await f.call('send',{id:p.body.id,confirm:true});await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal((await f.call('status',p.body.id)).body.stage,'uncertain');await f.call('send',{id:p.body.id,confirm:true});assert.equal(f.sends.length,1);
  assert.equal((await f.call('prepare',action)).status,409);assert.equal((await f.call('status','b'.repeat(64))).status,404);
});
test('two admins use one wallet and lock, while confirmations remain bound to the initiating identity and scope',async()=>{
  const f=fixture(true),call=(kind:'prepare'|'send'|'status'|'cancel',body:unknown,token='user')=>f.call(kind,body,token,origin,'admin');
  const p=await call('prepare',action,'other');assert.equal(p.status,200);assert.equal(p.body.address,'0x0000000000000000000000000000000000000033');
  assert.equal((await call('prepare',action)).status,409);
  assert.equal((await call('send',{id:p.body.id,confirm:true})).status,404);assert.equal((await call('cancel',{id:p.body.id})).status,404);
  assert.equal((await f.call('send',{id:p.body.id,confirm:true},'other')).status,404);
  assert.equal((await call('status',p.body.id)).body.canConfirm,false);
  await call('send',{id:p.body.id,confirm:true},'other');await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(f.sends.length,1);assert.equal((f.sends[0] as any).wallet.id,'shared');assert.equal(typeof (f.sends[0] as any).token.sign_fns[0],'function');
  const pending=await call('prepare',action);assert.equal(pending.status,409);assert.equal(pending.body.pending.id,p.body.id);
  f.release();f.finish();await new Promise(resolve=>setTimeout(resolve,0));assert.equal((await call('status',p.body.id)).body.stage,'confirmed');
  assert.equal((await call('prepare',action)).status,200);
});
test('revoked collaborators cannot confirm prepared writes; ownership operations stay owner-only',async()=>{
  const f=fixture(true),call=(kind:'prepare'|'send'|'status'|'cancel',body:unknown)=>f.call(kind,body,'other',origin,'admin');
  assert.equal((await call('prepare',{action:'grantRole',args:[]})).status,403);
  const p=await call('prepare',action);f.revoke();
  assert.equal((await call('send',{id:p.body.id,confirm:true})).status,403);assert.equal((await call('status',p.body.id)).status,403);assert.equal(f.sends.length,0);
});

test.afterEach(()=>walletAuthorizations().dispose());


test('player API cannot prepare collection mint or ownership operations',async()=>{
  const f=fixture();
  for(const action of ['mintERC1155','acceptPrizeOwnership'])assert.equal((await f.call('prepare',{action,args:[]})).status,403);
});
