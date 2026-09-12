import {testAuthorization,testSignature,authorizedTestRequest} from './helpers/wallet-authorization';
import test from 'node:test';
import assert from 'node:assert/strict';
import type {PrivyClient} from '@privy-io/node';
import {privateKeyToAccount} from 'viem/accounts';
import type {Address} from 'viem';
import {createAdminService} from '../lib/admin/service';
import {createAdminHandler} from '../lib/admin/api';
import {ADMIN_WALLET_EXTERNAL_ID} from '../lib/admin/model';
import {loadAdminWalletExternalId} from '../lib/admin/config';
import {operatorPolicy,swapOperatorPolicy,legacyOperatorPolicy,OPERATOR_ACTIONS,policyMatches} from '../lib/admin/policy';
import type {WalletService} from '../lib/types';
const owner={userId:'did:privy:owner00001',wallets:[]},operator={userId:'did:privy:operator001',wallets:[]},outsider={userId:'did:privy:outsider001',wallets:[]};
const key=privateKeyToAccount(('0x'+'1'.repeat(64)) as `0x${string}`),contract='0x0000000000000000000000000000000000000099' as Address;
const origin='https://slot.example';
function fixture(){
  let wallet:any=null,next=0,deployed:Address|null=null;
  const wallets=new Map<string,any>(),accounts=new Map<string,typeof key>(),quorums=new Map<string,any>(),policies=new Map<string,any>(),updates:any[]=[],signatures:string[]=[];
  const client={wallets:()=>({list:async(params:any)=>({data:[...wallets.values()].filter(value=>value.external_id===params.external_id),next_cursor:null}),get:async(id:string)=>structuredClone(wallets.get(id)),
    create:async(input:any)=>{const scalar=BigInt('0x'+'1'.repeat(64))+BigInt(wallets.size);const account=privateKeyToAccount(('0x'+scalar.toString(16).padStart(64,'0')) as `0x${string}`);wallet={...input,id:'wallet-shared-'+wallets.size,address:account.address,additional_signers:[],policy_ids:[]};wallets.set(wallet.id,wallet);accounts.set(wallet.id,account);return structuredClone(wallet);},
    update:async(id:string,input:any)=>{assert.equal(await input.authorization_context.sign_fns[0](Buffer.from('update')),testSignature(owner.userId));updates.push(input);const value=wallets.get(id);value.additional_signers=structuredClone(input.additional_signers);return structuredClone(value);},
    ethereum:()=>({signMessage:async(id:string,input:any)=>{signatures.push(await input.authorization_context.sign_fns[0](Buffer.from('proof')));return{signature:await accounts.get(id)!.signMessage({message:input.message})};}})}),
    keyQuorums:()=>({get:async(id:string)=>structuredClone(quorums.get(id)),create:async(input:any)=>{const value={...input,id:'quorum-'+(++next),authorization_keys:[],key_quorum_ids:[]};quorums.set(value.id,value);return value;}}),
    policies:()=>({get:async(id:string)=>structuredClone(policies.get(id)),create:async(input:any)=>{const value={...input,id:'policy-'+(++next)};policies.set(value.id,value);return value;}}),
    users:()=>({_get:async(id:string)=>({id})})} as unknown as PrivyClient;
  const service=createAdminService(client,owner.userId,()=>deployed);
  const walletService={authenticate:async(token:string)=>{if(token==='owner-token')return owner;if(token==='operator-token')return operator;if(token==='outsider-token')return outsider;throw new Error('Unauthorized');}} as unknown as WalletService;
  const handle=createAdminHandler({service,walletService,origin,readBalance:async()=>({amount:'25',stale:false,updatedAt:1000})});
  async function call(action:'account'|'create'|'member'|'proof',token='owner-token',body?:unknown,requestOrigin=origin) {
    const response=await authorizedTestRequest(new Request(origin+'/api/admin/'+action,{method:action==='account'?'GET':'POST',headers:{Authorization:'Bearer '+token,Origin:requestOrigin,'Content-Type':'application/json','X-Slot-Request':'1'},body:action==='account'?undefined:JSON.stringify(body)}),token==='owner-token'?owner.userId:token==='operator-token'?operator.userId:outsider.userId,request=>handle(request,action));
    return {status:response.status,body:await response.json()};
  }
  return {service,client,call,updates,signatures,quorums,policies,wallet:()=>wallet,deploy:()=>{deployed=contract;}};
}
test('only configured owner can create shared wallet; independent logins see identical funding address and balance',async()=>{
  const f=fixture();assert.equal((await f.call('account','invalid')).status,401);
  assert.equal((await f.call('account','operator-token')).body.state,'waiting');
  assert.equal((await f.call('create','outsider-token',{confirm:true})).status,403);
  assert.equal((await f.call('create','owner-token',{confirm:true},'https://evil.example')).status,403);
  assert.equal((await f.call('create','owner-token',{})).status,400);
  const created=await f.call('create','owner-token',{confirm:true});assert.equal(created.body.role,'owner');assert.equal(created.body.wallet.address,key.address);
  const id=f.wallet().id;await f.call('create','owner-token',{confirm:true});assert.equal(f.wallet().id,id);
  const added=await f.call('member','owner-token',{userId:operator.userId,operation:'add',confirm:true});assert.equal(added.status,200);
  const other=await f.call('account','operator-token');assert.equal(other.body.role,'operator');assert.deepEqual(other.body.wallet,created.body.wallet);assert.equal(other.body.operationsEnabled,false);
  const stranger=await f.call('account','outsider-token');assert.equal(stranger.body.state,'waiting');assert.equal(stranger.body.wallet,null);assert.deepEqual(stranger.body.members,[]);
  assert.equal((await f.call('member','operator-token',{userId:outsider.userId,operation:'add',confirm:true})).status,403);
  assert.equal((await f.call('proof','owner-token',{confirm:true})).body.verified,true);
  assert.equal((await f.call('proof','operator-token',{confirm:true})).body.verified,true);assert.deepEqual(f.signatures,[testSignature(owner.userId),testSignature(operator.userId)]);
  // Provider persists wallet and membership; process restart requires no app database.
  const restarted=createAdminService(f.client,owner.userId,()=>null);
  assert.equal((await restarted.resolve(operator)).wallet.id,id);
  await f.call('member','owner-token',{userId:operator.userId,operation:'remove',confirm:true});
  assert.equal((await f.call('account','operator-token')).body.state,'waiting');await assert.rejects(restarted.resolve(operator));
  assert.equal((await f.call('proof','operator-token',{confirm:true})).status,403);
});
test('operator policies require owner activation for deployed contract and never grant ownership actions',async()=>{
  const f=fixture();await f.service.create(owner);await f.service.setMember(owner,testAuthorization(owner.userId),operator.userId);
  await assert.rejects(f.service.assertAction(operator,'pause'));
  f.deploy();await assert.rejects(f.service.assertAction(operator,'pause'));
  await f.service.setMember(owner,testAuthorization(owner.userId),operator.userId);
  assert.equal((await f.service.assertAction(operator,'pause')).wallet.address,key.address);
  for(const action of ['grantRole','beginDefaultAdminTransfer','acceptDefaultAdminTransfer','renounceRole','approveBudget'])await assert.rejects(f.service.assertAction(operator,action));
  assert.equal((await f.service.assertAction(owner,'grantRole')).role,'owner');
  const rules=operatorPolicy(key.address,contract),slot=rules.find(rule=>rule.name==='Operate the configured slot')!;
  assert.ok(slot.conditions.some(c=>c.field==='to'&&c.value===contract));assert.ok(slot.conditions.some(c=>c.field==='chain_id'&&c.value==='8453'));assert.ok(slot.conditions.some(c=>c.field==='value'&&c.value==='0'));
  assert.equal(OPERATOR_ACTIONS.includes('grantRole'),false);assert.ok(rules.some(rule=>rule.conditions.some(c=>c.field==='transfer.to'&&c.value===contract)));
  assert.equal(policyMatches(rules.map(rule=>({...rule,id:'provider-id'})),rules),true);
  // A broader/different policy is not treated as a recognized collaborator grant.
  const policyId=f.wallet().additional_signers[0].override_policy_ids[0];f.policies.get(policyId).rules=[];
  await assert.rejects(f.service.resolve(operator));
});
test('no implicit first-login owner and ownership changes fail closed',async()=>{
  const f=fixture(),unconfigured=createAdminService(f.client,undefined,()=>null);
  assert.equal((await unconfigured.status(owner)).state,'unconfigured');await assert.rejects(unconfigured.create(owner));
  await f.service.create(owner);const quorum=f.quorums.get(f.wallet().owner_id);quorum.user_ids=[outsider.userId];
  await assert.rejects(f.service.resolve(owner));assert.equal(f.wallet().external_id,ADMIN_WALLET_EXTERNAL_ID);
});

test('wallet selection preserves the existing default and rejects malformed configuration',()=>{
  for(const value of [undefined,''])assert.equal(loadAdminWalletExternalId(value),ADMIN_WALLET_EXTERNAL_ID);
  assert.equal(loadAdminWalletExternalId('rwa_slot_admin_production_v1'),'rwa_slot_admin_production_v1');
  for(const value of [' ',' wallet','wallet\n','wallet/id','x'.repeat(129)]){
    assert.throws(()=>loadAdminWalletExternalId(value),{message:'Invalid ADMIN_WALLET_EXTERNAL_ID'});
  }
});

test('a new owner can initialize an explicitly selected wallet without taking over the previous wallet',async()=>{
  const f=fixture();
  const previous=createAdminService(f.client,outsider.userId,()=>null);
  await previous.create(outsider);
  const originalWallet=structuredClone(f.wallet());
  const originalQuorum=structuredClone(f.quorums.get(originalWallet.owner_id));
  // Reconfiguring only the owner must neither grant access nor create a replacement.
  await assert.rejects(f.service.status(owner),{code:'AdminOwnerChanged'});
  await assert.rejects(f.service.create(owner),{code:'AdminOwnerChanged'});
  assert.deepEqual(f.wallet(),originalWallet);

  const externalId=loadAdminWalletExternalId('rwa_slot_admin_production_v1');
  const selected=createAdminService(f.client,owner.userId,()=>null,externalId);
  assert.equal((await selected.status(owner)).state,'create');
  assert.equal((await selected.status(operator)).state,'waiting');
  await assert.rejects(selected.create(operator),{code:'AdminOwner'});
  await selected.create(owner);
  const current=await selected.resolve(owner);
  assert.equal(current.role,'owner');
  assert.notEqual(current.wallet.id,originalWallet.id);
  assert.notEqual(current.wallet.address,originalWallet.address);
  assert.deepEqual(f.quorums.get(f.wallet().owner_id).user_ids,[owner.userId]);
  assert.equal((await selected.status(operator)).state,'waiting');
  await selected.setMember(owner,testAuthorization(owner.userId),operator.userId);
  assert.deepEqual((await selected.resolve(operator)).wallet,current.wallet);
  assert.equal((await selected.proof(owner,testAuthorization(owner.userId))).address,current.wallet.address);
  assert.equal((await selected.proof(operator,testAuthorization(operator.userId))).address,current.wallet.address);
  const restarted=createAdminService(f.client,owner.userId,()=>null,externalId);
  await restarted.create(owner);
  assert.deepEqual((await restarted.resolve(operator)).wallet,current.wallet);
  assert.equal((await restarted.status(outsider)).state,'waiting');
  assert.deepEqual(await f.client.wallets().get(originalWallet.id),originalWallet);
  assert.deepEqual(f.quorums.get(originalWallet.owner_id),originalQuorum);
  assert.equal((await previous.resolve(outsider)).wallet.id,originalWallet.id);
  await selected.setMember(owner,testAuthorization(owner.userId),operator.userId,true);
  await assert.rejects(restarted.resolve(operator),{code:'AdminAccess'});
});

test('legacy collaborators retain visibility and contract rights while LI.FI requires an explicit owner upgrade',async()=>{
  const f=fixture();await f.service.create(owner);await f.service.setMember(owner,testAuthorization(owner.userId),operator.userId);
  const policyId=f.wallet().additional_signers[0].override_policy_ids[0];
  assert.equal((await f.service.resolve(operator)).swapEnabled,true);
  assert.equal((await f.service.status(owner)).members[0].enabled,true);
  f.policies.get(policyId).rules=legacyOperatorPolicy(key.address,null);
  assert.equal((await f.service.resolve(operator)).swapEnabled,false);
  assert.equal((await f.service.status(owner)).members[0].enabled,false);
  await f.service.setMember(owner,testAuthorization(owner.userId),operator.userId);
  assert.equal((await f.service.resolve(operator)).swapEnabled,true);
  f.deploy();assert.equal((await f.service.resolve(operator)).swapEnabled,true);
  await f.service.setMember(owner,testAuthorization(owner.userId),operator.userId);
  const active=f.wallet().additional_signers[0].override_policy_ids[0];
  f.policies.get(active).rules=legacyOperatorPolicy(key.address,contract);
  assert.equal((await f.service.resolve(operator)).swapEnabled,false);
  assert.equal((await f.service.assertAction(operator,'pause')).operationsEnabled,true);
});
test('LI.FI permissions constrain destination, function, chain and value for USDC and native ETH before slot deployment',()=>{
  const rules=operatorPolicy(key.address,null),swaps=rules.filter(r=>r.name.startsWith('LI.FI '));
  assert.equal(swaps.length,4);
  for(const rule of swaps){assert.equal(rule.method,'eth_sendTransaction');assert.ok(rule.conditions.some(c=>c.field==='chain_id'&&c.value==='8453'));assert.ok(rule.conditions.some(c=>c.field.endsWith('._receiver')&&c.value===key.address));assert.ok(rule.conditions.some(c=>c.field==='function_name'));assert.ok(rule.conditions.some(c=>c.field==='value'&&c.operator===(rule.name.endsWith('NativeToERC20')?'gt':'eq')));}
  assert.ok(rules.some(r=>r.name==='Approve USDC for LI.FI'));
  assert.ok(!rules.some(r=>['*','exportPrivateKey','eth_signTypedData_v4'].includes(r.method)));
});

test('every parameter condition uses an argument declared in its policy ABI',()=>{
  for(const rule of operatorPolicy(key.address,contract))for(const condition of rule.conditions){
    if(condition.field_source!=='ethereum_calldata'||condition.field==='function_name')continue;
    const [name,arg]=condition.field.split('.');const fn=(condition.abi as any[]).find(f=>f.type==='function'&&f.name===name);
    assert.ok(fn?.inputs.some((input:any)=>input.name===arg),condition.field+' must exist in the supplied ABI');
  }
});


test('previous swap policies preserve access without gaining mint; owner updates enable limited mint only',async()=>{
  const f=fixture();await f.service.create(owner);f.deploy();await f.service.setMember(owner,testAuthorization(owner.userId),operator.userId);
  const id=f.wallet().additional_signers[0].override_policy_ids[0];
  f.policies.get(id).rules=swapOperatorPolicy(key.address,contract);
  const access=await f.service.resolve(operator);assert.equal(access.operationsEnabled,true);assert.equal(access.swapEnabled,true);assert.equal(access.mintEnabled,false);
  await assert.rejects(f.service.assertAction(operator,'mintERC1155'));
  await f.service.setMember(owner,testAuthorization(owner.userId),operator.userId);
  assert.equal((await f.service.assertAction(operator,'mintERC1155')).mintEnabled,true);
  await assert.rejects(f.service.assertAction(operator,'acceptPrizeOwnership'));
  const mint=operatorPolicy(key.address,contract).find(rule=>rule.name==='Mint prizes to shared wallet or slot')!;
  assert.ok(mint.conditions.some(c=>c.field==='to'));
  assert.ok(mint.conditions.some(c=>c.field==='function_name'&&c.value==='mint'));
  assert.deepEqual(mint.conditions.find(c=>c.field==='mint.recipient')?.value,[key.address,contract]);
});
