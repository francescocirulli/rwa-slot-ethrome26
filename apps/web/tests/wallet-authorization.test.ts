import test from 'node:test';
import assert from 'node:assert/strict';
import {PrivyClient,generateAuthorizationSignature} from '@privy-io/node';
import {generateKeyPairSync} from 'node:crypto';
import {createWalletAuthorizations,walletAuthorizations,withWalletAuthorization} from '../lib/wallet-authorization';
import {createWalletAuthorizationHandler} from '../lib/wallet-authorization-api';
import {runWalletRequest} from '../lib/wallet-authorization-flow';
import {testSignature} from './helpers/wallet-authorization';
import type {WalletService} from '../lib/types';
const owner='did:privy:owner',other='did:privy:other',path='/api/admin/proof',origin='https://slot.example';
const bytes=new TextEncoder().encode('exact provider payload');

test('authorization channels bind account and endpoint, reject reuse and cancel pending signatures',async()=>{
 const channels=createWalletAuthorizations();
 try{
  const {id}=channels.create(owner,path);
  await assert.rejects(channels.poll(id,other),{code:'WalletAuthorization'});
  await assert.rejects(channels.run(id,other,path,async()=>{}),{code:'WalletAuthorization'});
  await assert.rejects(channels.run(id,owner,'/api/admin/member',async()=>{}),{code:'Cancelled'});
  const operation=channels.run(id,owner,path,async authorization=>authorization.sign_fns[0](bytes));
  const waiting=await channels.poll(id,owner);assert.equal(waiting.state,'sign');assert.equal(waiting.challenge?.payload,Buffer.from(bytes).toString('base64'));
  assert.throws(()=>channels.sign(id,other,waiting.challenge!.id,testSignature(owner)),{code:'WalletAuthorization'});
  assert.throws(()=>channels.sign(id,owner,'wrong',testSignature(owner)),{code:'Cancelled'});
  assert.throws(()=>channels.sign(id,owner,waiting.challenge!.id,'bad'),{code:'Input'});
  channels.sign(id,owner,waiting.challenge!.id,testSignature(owner));assert.equal(await operation,testSignature(owner));
  assert.throws(()=>channels.sign(id,owner,waiting.challenge!.id,testSignature(owner)),{code:'Cancelled'});
  await assert.rejects(channels.run(id,owner,path,async()=>{}),{code:'Cancelled'});
  const next=channels.create(owner,path);const pending=channels.run(next.id,owner,path,async a=>a.sign_fns[0](bytes));
  const rejection=assert.rejects(pending,{code:'Cancelled'});channels.cancel(next.id,owner);await rejection;
 }finally{channels.dispose();}
});

test('authorization expires before signing and resource limits fail closed',async()=>{
 const channels=createWalletAuthorizations(20);
 try{
  const {id}=channels.create(owner,path);channels.create(owner,path);
  assert.throws(()=>channels.create(owner,path),{code:'WalletBusy'});
  assert.throws(()=>channels.create(other,'https://evil.example'),{code:'Input'});
  const pending=channels.run(id,owner,path,async a=>a.sign_fns[0](bytes));
  const rejected=assert.rejects(pending,{code:'Cancelled'});
  await new Promise(resolve=>setTimeout(resolve,30));await rejected;
  await assert.rejects(channels.poll(id,owner),{code:'WalletAuthorization'});
 }finally{channels.dispose();}
});

function fixture(){
 const walletService={authenticate:async(token:string)=>{if(![owner,other].includes(token))throw new Error('Invalid');return {userId:token,wallets:[]};}} as unknown as WalletService;
 const handle=createWalletAuthorizationHandler({walletService,origin});
 const call=(input:object,headers:Record<string,string>={})=>handle(new Request(origin+'/api/wallet-authorization',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+owner,'Content-Type':'application/json','X-Slot-Request':'1',...headers},body:JSON.stringify(input)}));
 return {handle,call};
}
test('authorization API enforces authentication, origin, request size and isolation',async()=>{
 const {call}=fixture();
 assert.equal((await call({action:'create',path},{Authorization:''})).status,401);
 assert.equal((await call({action:'create',path},{Origin:'https://evil.example'})).status,403);
 assert.equal((await call({action:'create',path},{'X-Slot-Request':''})).status,403);
 assert.equal((await call({action:'create',path},{'Content-Type':'text/plain'})).status,415);
 assert.equal((await call({action:'create',path,padding:'x'.repeat(2048)})).status,413);
 const {id}=await(await call({action:'create',path})).json();
 assert.equal((await call({action:'poll',id},{Authorization:'Bearer '+other})).status,404);
 assert.equal((await call({action:'sign',id,signature:testSignature(owner)})).status,409);
 assert.equal((await call({action:'cancel',id})).status,200);
});

test('browser flow signs exact real SDK requests, including a second gas request; JWT exchange is never used',async()=>{
 const {handle}=fixture();let submitted=0,signed=0;
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const privateKey=pair.privateKey.export({type:'pkcs8',format:'der'}).toString('base64');
 const client=new PrivyClient({appId:'test-app',appSecret:'test-secret',maxRetries:0,fetch:async(input,init)=>{
  assert.equal(new URL(String(input)).pathname,'/v1/wallets/test-wallet/rpc');
  const body=JSON.parse(String(init?.body));const headers=new Headers(init?.headers);
  const expected=generateAuthorizationSignature({authorizationPrivateKey:privateKey,input:{version:1,method:'POST',url:String(input),body,headers:{'privy-app-id':'test-app','privy-request-expiry':headers.get('privy-request-expiry')!}}});
  assert.equal(headers.get('privy-authorization-signature'),expected);submitted++;
  return Response.json({method:'personal_sign',data:{signature:'0x'+'1'.repeat(130)},encoding:'hex'});
 }});
 const response=await runWalletRequest(path,{method:'POST'},{getAccessToken:async()=>owner,valid:()=>{},sign:async payload=>{
  signed++;return {signature:generateAuthorizationSignature({authorizationPrivateKey:privateKey,input:payload})};
 },fetch:async(input,init)=>{
  const request=new Request(origin+input,{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),Origin:origin}});
  if(input==='/api/wallet-authorization')return handle(request);
  return withWalletAuthorization(request,{userId:owner,wallets:[]},async authorization=>{
   for(const message of ['USDC request','ETH request'])await client.wallets().ethereum().signMessage('test-wallet',{message,authorization_context:authorization});
   return Response.json({ok:true});
  });
 }});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});assert.equal(submitted,2);assert.equal(signed,2);
});

test('browser cancellation never returns a signature to the SDK',async()=>{
 const {handle}=fixture();let completed=false;
 await assert.rejects(runWalletRequest(path,{method:'POST'},{getAccessToken:async()=>owner,valid:()=>{},sign:async()=>{throw new Error('User cancelled');},fetch:async(input,init)=>{
  const request=new Request(origin+input,{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),Origin:origin}});
  if(input==='/api/wallet-authorization')return handle(request);
  return withWalletAuthorization(request,{userId:owner,wallets:[]},async authorization=>{await authorization.sign_fns[0](bytes);completed=true;return Response.json({ok:true});});
 }}),/Privy authorization not completed/);
 assert.equal(completed,false);
});

test('the response body stays readable after the authorization controller closes',async()=>{
 const {handle}=fixture();
 const response=await runWalletRequest(path,{method:'POST'},{getAccessToken:async()=>owner,valid:()=>{},sign:async()=>{throw new Error('No signature needed');},fetch:async(input,init)=>{
  const request=new Request(origin+input,{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),Origin:origin}});
  if(input==='/api/wallet-authorization')return handle(request);
  return new Response(new ReadableStream({start(controller){init?.signal?.addEventListener('abort',()=>controller.error(new Error('Body aborted')),{once:true});controller.enqueue(new TextEncoder().encode('{"ok":true}'));},pull(controller){controller.close();}}),{headers:{'Content-Type':'application/json'}});
 }});
 assert.deepEqual(await response.json(),{ok:true});
});

test.after(()=>walletAuthorizations().dispose());
