import {SlotError} from './slot/errors';
import {generateKeyPairSync, randomBytes} from 'node:crypto';
import {PrivyClient} from '@privy-io/node';
import {importSPKI, jwtVerify} from 'jose';
import {verifyMessage, encodeFunctionData, type Hash} from 'viem';
import {spinPolicy} from './slot/policy';
import {slotAbi} from './slot/abi';
import {sendWithGas} from './slot/gas';
import type {Grant, WalletService} from './types';
import {ADMIN_WALLET_EXTERNAL_ID} from './admin/model';

type Rules = Parameters<ReturnType<PrivyClient['policies']>['create']>[0]['rules'];

// The user's policy cannot be broadened by the app or delegated key. All other
// RPC methods (including transactions and typed-data signatures) are denied.
export function proofPolicy(message: string): Rules {
  return [{name: 'Only this session proof', method: 'personal_sign', action: 'ALLOW',
    conditions: [{field_source: 'message', field: 'content', operator: 'eq', value: message}]}];
}

export function createWalletService(appId: string, appSecret: string, excludeSharedAdmin:boolean|string=!!process.env.ADMIN_OWNER_USER_ID): WalletService {
  const client = new PrivyClient({appId, appSecret, maxRetries: 0, timeout: 20_000});
  const keys = new Map<string, string>();
  let publicKey: Awaited<ReturnType<typeof importSPKI>> | undefined;
  let keyFetchedAt = 0;

  return {
    async verifyIdentityToken(token,userId) {
      const user=await client.users().get({id_token:token});
      if(user.id!==userId)throw new Error('Wallet identity mismatch');
    },
    async authenticate(token) {
      if (!publicKey || Date.now() - keyFetchedAt > 300_000) {
        const response = await fetch(`https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}`, {
          headers: {'privy-app-id': appId}, signal: AbortSignal.timeout(10_000), cache: 'no-store',
        });
        if (!response.ok) throw new Error('Identity unavailable');
        const config = await response.json();
        publicKey = await importSPKI(config.verification_key, 'ES256');
        keyFetchedAt = Date.now();
      }
      const {payload} = await jwtVerify(token, publicKey, {
        algorithms: ['ES256'], issuer: 'privy.io', audience: appId,
        requiredClaims: ['sub', 'sid', 'iat', 'exp'],
      });
      if (!payload.sub?.startsWith('did:privy:')) throw new Error('Invalid identity');
      const user = await client.users()._get(payload.sub);
      if (user.id !== payload.sub) throw new Error('Identity mismatch');
      const wallets = user.linked_accounts.flatMap((account) => {
        if (account.type !== 'wallet' || account.chain_type !== 'ethereum' ||
          account.wallet_client_type !== 'privy' || !('id' in account) || !account.id) return [];
        return [{id: account.id, address: account.address,
          ...('wallet_index' in account && typeof account.wallet_index === 'number' ? {index: account.wallet_index} : {})}];
      });
      // Shared treasury access is resolved separately, never paired to a player/iPad.
      const shared=excludeSharedAdmin&&wallets.length?await client.wallets().list({external_id:typeof excludeSharedAdmin==='string'?excludeSharedAdmin:ADMIN_WALLET_EXTERNAL_ID,limit:10,include_archived:true}):null;
      if(shared?.next_cursor)throw new Error('Shared wallet configuration ambiguous');
      return {userId: user.id, wallets:wallets.filter(wallet=>!shared?.data.some(item=>item.id===wallet.id))};
    },
    async welcomeWallet(user) {
      const first = user.wallets.filter(wallet => wallet.index === 0);
      if (first.length !== 1) return null;
      const wallet = first[0], actual = await client.wallets().get(wallet.id);
      if (actual.chain_type !== 'ethereum' || actual.address.toLowerCase() !== wallet.address.toLowerCase() ||
          actual.imported_at || actual.archived_at || !Number.isSafeInteger(actual.created_at) || actual.created_at <= 0 || actual.created_at > Date.now() + 60000) return null;
      return {wallet, createdAt: actual.created_at};
    },
    async prepare(wallet, userId, sessionId, code) {
      const actual = await client.wallets().get(wallet.id);
      if (actual.address.toLowerCase() !== wallet.address.toLowerCase() || actual.chain_type !== 'ethereum') {
        throw new Error('Wallet mismatch');
      }
      const {privateKey, publicKey: signerPublicKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
      const key = privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64');
      const quorum = await client.keyQuorums().create({
        display_name: `Lucky Signal ${code}`, authorization_threshold: 1,
        public_keys: [signerPublicKey.export({type: 'spki', format: 'der'}).toString('base64')],
      });
      const message = `Wall Street Slot — link proof.\nWallet: ${wallet.address}\nSession: ${sessionId}\nNonce: ${randomBytes(16).toString('hex')}\nQuesta firma dimostra il funzionamento del signer. Non autorizza accessi, acquisti, puntate o trasferimenti.`;
      try {
        const policy = await client.policies().create({
          name: `Lucky Signal proof ${code}`, version: '1.0', chain_type: 'ethereum',
          owner: {user_id: userId}, rules: proofPolicy(message),
        });
        const grant: Grant = {id: sessionId, signerId: quorum.id, policyId: policy.id,
          walletId: wallet.id, address: wallet.address, message, active: false};
        keys.set(grant.id, key);
        return grant;
      } catch {
        await client.keyQuorums().delete(quorum.id, {authorization_context: {authorization_private_keys: [key]}}).catch(() => {});
        throw new Error('Signer unavailable');
      }
    },
    async activate(grant) {
      if (!keys.has(grant.id)) throw new Error('Signer revoked');
      const wallet = await client.wallets().get(grant.walletId);
      const signer = wallet.additional_signers.find((item) => item.signer_id === grant.signerId);
      if (wallet.address.toLowerCase() !== grant.address.toLowerCase() ||
        signer?.override_policy_ids?.length !== 1 || signer.override_policy_ids[0] !== grant.policyId) {
        throw new Error('Signer not authorized');
      }
      // A concurrent logout may have destroyed the key during the network call.
      if (!keys.has(grant.id)) throw new Error('Signer revoked');
      grant.active = true;
    },
    async sign(grant) {
      const key = keys.get(grant.id);
      if (!key || !grant.active) throw new SlotError('SessionClosed', 'The session permission has ended.');
      const result = await client.wallets().ethereum().signMessage(grant.walletId, {
        message: grant.message, idempotency_key: `${grant.id}-proof`,
        authorization_context: {authorization_private_keys: [key]},
      });
      if (!await verifyMessage({address: grant.address as `0x${string}`, message: grant.message, signature: result.signature as `0x${string}`})) {
        throw new Error('Invalid signature');
      }
      return result.signature;
    },
    async preparePlay(wallet, userId, sessionId, code, contract, chainId, budget) {
      const actual = await client.wallets().get(wallet.id);
      if (actual.address.toLowerCase() !== wallet.address.toLowerCase() || actual.chain_type !== 'ethereum') throw new Error('Wallet mismatch');
      const {privateKey, publicKey: signerPublicKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
      const key = privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64');
      const quorum = await client.keyQuorums().create({display_name: `Lucky Signal play ${code}`, authorization_threshold: 1,
        public_keys: [signerPublicKey.export({type: 'spki', format: 'der'}).toString('base64')]});
      try {
        const policy = await client.policies().create({name: `Lucky Signal play ${code}`, version: '1.0', chain_type: 'ethereum',
          owner: {user_id: userId}, rules: spinPolicy(contract, chainId)});
        const id = `${sessionId}-play`;
        keys.set(id, key);
        return {id, signerId: quorum.id, policyId: policy.id, walletId: wallet.id, address: wallet.address,
          active: false, message: '', contract, chainId, budget};
      } catch {
        await client.keyQuorums().delete(quorum.id, {authorization_context: {authorization_private_keys: [key]}}).catch(() => {});
        throw new Error('Signer unavailable');
      }
    },
    async sendSpin(grant, idempotencyKey, mode, assertValid) {
      const key = keys.get(grant.id);
      if (!key || !grant.active) throw new SlotError('SessionClosed', 'The session permission has ended.');
      const result = await sendWithGas({mode, key:idempotencyKey, assertValid:()=>{assertValid();if(!keys.has(grant.id)||!grant.active)throw new SlotError('SessionClosed','The session has ended.');}, send: gas => client.wallets().ethereum().sendTransaction(grant.walletId, {
        caip2: `eip155:${grant.chainId}` as 'eip155:8453', ...gas,
        params: {transaction: {to: grant.contract, chain_id: grant.chainId, value: '0x0', data: encodeFunctionData({abi: slotAbi, functionName: 'startSpin'})}},
        authorization_context: {authorization_private_keys: [key]},
      })});
      return {hash: /^0x[0-9a-fA-F]{64}$/.test(result.hash) ? result.hash as Hash : undefined, transactionId: result.transaction_id, gasToken:result.gasToken};
    },
    async sendOwned(wallet, authorization, transaction, idempotencyKey, mode, onGasToken, assertValid) {
      const result = await sendWithGas({mode, key:idempotencyKey, onGasToken, assertValid, send: gas => client.wallets().ethereum().sendTransaction(wallet.id, {
        caip2:`eip155:${transaction.chainId}` as 'eip155:8453', ...gas,
        params:{transaction:{to:transaction.to,data:transaction.data,chain_id:transaction.chainId,value:transaction.value||'0x0'}},
        request_expiry:Date.now()+90000,
        authorization_context:{sign_fns:[async payload=>{const signature=await authorization.sign_fns[0](payload);await assertValid?.();return signature;}]},
      })});
      return {hash:/^0x[0-9a-fA-F]{64}$/.test(result.hash)?result.hash as Hash:undefined,transactionId:result.transaction_id,userOperationHash:result.user_operation_hash&&/^0x[0-9a-fA-F]{64}$/.test(result.user_operation_hash)?result.user_operation_hash as Hash:undefined,gasToken:result.gasToken};
    },
    async resolveSpin(submission) {
      if (submission.hash) return submission.hash;
      if (!submission.transactionId) return undefined;
      const transaction = await client.transactions().get(submission.transactionId);
      if (transaction.status === 'execution_reverted' || transaction.status === 'failed') throw new SlotError('TransactionFailed', 'Privy confirmed the transaction failed. You can try again.');
      return transaction.transaction_hash && /^0x[0-9a-fA-F]{64}$/.test(transaction.transaction_hash) ? transaction.transaction_hash as Hash : undefined;
    },
    revoke(grant) {
      const key = keys.get(grant.id);
      keys.delete(grant.id); grant.active = false;
      if (key) void client.keyQuorums().delete(grant.signerId, {
        authorization_context: {authorization_private_keys: [key]},
      }).catch(() => { /* Local key destruction is immediate, remote cleanup best effort. */ });
    },
  };
}
