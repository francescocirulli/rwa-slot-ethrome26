import test from 'node:test';
import assert from 'node:assert/strict';
import {walletAuthorizationToken} from '../lib/wallet-authorization';
import type {WalletService} from '../lib/types';
const user={userId:'did:privy:owner',wallets:[]};
test('wallet authorization requires an identity token verified against the authenticated account',async()=>{
  const service={verifyIdentityToken:async(token:string,id:string)=>{assert.equal(id,user.userId);if(token!=='owner-identity')throw new Error('Wrong account');}} as unknown as WalletService;
  const request=(token?:string)=>new Request('https://slot.example',{headers:token?{'privy-id-token':token}:{}});
  assert.equal(await walletAuthorizationToken(request('owner-identity'),user,service),'owner-identity');
  await assert.rejects(walletAuthorizationToken(request(),user,service),/identity token/);
  await assert.rejects(walletAuthorizationToken(request('another-identity'),user,service),/non corrisponde/);
  await assert.rejects(walletAuthorizationToken(request('a'.repeat(32001)),user,service));
});
