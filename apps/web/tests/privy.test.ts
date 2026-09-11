import {test, mock} from 'node:test';
import {PrivyClient} from '@privy-io/node';
import assert from 'node:assert/strict';
import {generateKeyPair, exportSPKI, SignJWT} from 'jose';
import {createWalletService} from '../lib/privy';

test('real Privy verifier enforces signature, audience, issuer, expiry and embedded wallet ownership', async () => {
  const {privateKey, publicKey} = await generateKeyPair('ES256');
  const other = await generateKeyPair('ES256');
  const pem = await exportSPKI(publicKey);
  const appId = 'test-app';
  let owner = 'did:privy:verified';
  const fetchMock = mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('auth.privy.io/api/v1/apps/')) return Response.json({verification_key: pem});
    if (url.includes('/v1/users/')) return Response.json({id: owner, linked_accounts: [
      {type: 'email', address: 'fixture@example.com'},
      {type: 'wallet', address: '0x0000000000000000000000000000000000000001', chain_type: 'ethereum', wallet_client_type: 'metamask'},
      {id: 'embedded-1', type: 'wallet', address: '0x0000000000000000000000000000000000000002', chain_type: 'ethereum', wallet_client_type: 'privy'},
    ]});
    throw new Error('Unexpected URL');
  });
  try {
    const service = createWalletService(appId, 'test-secret');
    const token = (options: {aud?: string; iss?: string; expired?: boolean; wrongKey?: boolean} = {}) => new SignJWT({sid: 'test-session'})
      .setProtectedHeader({alg: 'ES256'}).setSubject('did:privy:verified').setIssuedAt()
      .setIssuer(options.iss || 'privy.io').setAudience(options.aud || appId)
      .setExpirationTime(options.expired ? Math.floor(Date.now() / 1000) - 10 : '1h')
      .sign(options.wrongKey ? other.privateKey : privateKey);
    const result = await service.authenticate(await token());
    assert.equal(result.userId, 'did:privy:verified');
    assert.deepEqual(result.wallets, [{id: 'embedded-1', address: '0x0000000000000000000000000000000000000002'}]);
    for (const options of [{aud: 'wrong'}, {iss: 'wrong'}, {expired: true}, {wrongKey: true}]) {
      await assert.rejects(service.authenticate(await token(options)));
    }
    owner = 'did:privy:another-user';
    await assert.rejects(service.authenticate(await token()));
  } finally {fetchMock.mock.restore();}
});

test('Privy transaction payload preserves native ETH input, USDC gas and the individual signer JWT',async()=>{
  const requests:any[]=[];
  const rpc=mock.method(PrivyClient.prototype,'wallets',()=>({ethereum:()=>({sendTransaction:async(id:string,body:any)=>{requests.push({id,body});return {hash:'',user_operation_hash:'0x'+'7'.repeat(64)};}})}) as any);
  try{
    const service=createWalletService('test-app','test-secret');
    const result=await service.sendOwned!({id:'shared-wallet',address:'0x0000000000000000000000000000000000000099'},'individual-identity-token',{to:'0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',data:'0x12345678',chainId:8453,value:'0xe35fa931a0000'},'native-swap','usdc',()=>{});
    assert.equal(requests.length,1);const req=requests[0];assert.equal(req.id,'shared-wallet');assert.equal(req.body.params.transaction.value,'0xe35fa931a0000');assert.equal(req.body.params.transaction.chain_id,8453);assert.equal(req.body.sponsor,true);assert.deepEqual(req.body.sponsor_options,{asset:'usdc'});assert.deepEqual(req.body.authorization_context,{user_jwts:['individual-identity-token']});assert.equal(result.userOperationHash,'0x'+'7'.repeat(64));assert.equal(result.hash,undefined);
  }finally{rpc.mock.restore();}
});
