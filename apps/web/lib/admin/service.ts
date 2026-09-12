import {createHash} from 'node:crypto';
import type {PrivyClient} from '@privy-io/node';
import type {Wallet as PrivyWallet, KeyQuorum} from '@privy-io/node/resources';
import {verifyMessage, type Address} from 'viem';
import type {Identity, Wallet, WalletAuthorization} from '../types';
import {BASE_PRIZE_COLLECTION} from '../prize-collection';
import {SlotError} from '../slot/errors';
import {ADMIN_WALLET_EXTERNAL_ID,adminProofMessage,type AdminRole} from './model';
import {OPERATOR_ACTIONS,operatorPolicy,swapOperatorPolicy,legacyOperatorPolicy,policyMatches} from './policy';

export type AdminAccess={wallet:Wallet;role:AdminRole;operationsEnabled:boolean;swapEnabled?:boolean;mintEnabled?:boolean};
export interface AdminAccessService {
  resolve(user:Identity):Promise<AdminAccess>;
  assertAction(user:Identity,action:string):Promise<AdminAccess>;
}
export function createAdminService(client:PrivyClient,ownerId:string|undefined,contract:()=>Address|null,externalId=ADMIN_WALLET_EXTERNAL_ID,collection:Address=BASE_PRIZE_COLLECTION) {
  let walletId:string|undefined,mutating=false;
  function requireOwner(user:Identity) {if(!ownerId||user.userId!==ownerId)throw new SlotError('AdminOwner','Only the owner can manage the shared wallet.',403);}
  function singleUser(quorum:KeyQuorum):string|null {
    return quorum.authorization_threshold===1&&!quorum.authorization_keys.length&&!quorum.key_quorum_ids?.length&&quorum.user_ids?.length===1?quorum.user_ids[0]:null;
  }
  async function wallet():Promise<PrivyWallet|null> {
    if(!ownerId)return null;
    if(!walletId){
      const page=await client.wallets().list({external_id:externalId,limit:2,include_archived:true});
      if(page.data.length>1||page.next_cursor)throw new SlotError('AdminConfig','Multiple admin wallets found. Check the Privy configuration.',503);
      if(!page.data.length)return null;
      walletId=page.data[0].id;
    }
    // Fresh provider state on every access: revocation must never rely on an allowlist cache.
    const value=await client.wallets().get(walletId);
    if(value.external_id!==externalId||value.chain_type!=='ethereum'||value.archived_at||!value.owner_id)throw new SlotError('AdminConfig','Shared wallet unavailable.',503);
    if(singleUser(await client.keyQuorums().get(value.owner_id))!==ownerId)throw new SlotError('AdminOwnerChanged','The shared wallet ownership changed. Check the configuration.',403);
    return value;
  }
  async function members(value:PrivyWallet) {
    if(value.additional_signers.length>8)throw new SlotError('AdminConfig','Collaborator configuration not supported.',503);
    return Promise.all(value.additional_signers.map(async signer=>{
      const userId=singleUser(await client.keyQuorums().get(signer.signer_id));
      const policy=signer.override_policy_ids?.length===1?await client.policies().get(signer.override_policy_ids[0]):null;
      const expected=operatorPolicy(value.address as Address,contract(),collection);
      const controlled=policy?.owner_id===value.owner_id;
      const enabled=!!controlled&&!!policy&&policyMatches(policy.rules,expected);
      // Recognize previous exact policies without silently broadening their permissions.
      const matches=(rules:ReturnType<typeof operatorPolicy>)=>!!controlled&&!!policy&&policyMatches(policy.rules,rules);
      const previousEnabled=matches(swapOperatorPolicy(value.address as Address,contract()));
      const swapEnabled=enabled||previousEnabled||matches(swapOperatorPolicy(value.address as Address,null));
      const legacyEnabled=matches(legacyOperatorPolicy(value.address as Address,contract()));
      const proofOnly=matches(legacyOperatorPolicy(value.address as Address,null));
      return {userId,signer,policy,enabled,swapEnabled,contractEnabled:enabled||previousEnabled||legacyEnabled,recognized:swapEnabled||legacyEnabled||proofOnly};
    }));
  }
  async function resolve(user:Identity):Promise<AdminAccess> {
    const value=await wallet();
    if(!value)throw new SlotError('AdminNotReady','The shared wallet has not been created yet.',403);
    const selected={id:value.id,address:value.address};
    if(user.userId===ownerId)return {wallet:selected,role:'owner',operationsEnabled:true,swapEnabled:true,mintEnabled:true};
    const member=(await members(value)).find(item=>item.userId===user.userId&&item.recognized);
    if(!member)throw new SlotError('AdminAccess','Your account is not authorized on the shared wallet.',403);
    return {wallet:selected,role:'operator',operationsEnabled:!!contract()&&member.contractEnabled,swapEnabled:member.swapEnabled,mintEnabled:!!contract()&&member.enabled};
  }
  async function exclusive<T>(work:()=>Promise<T>) {
    if(mutating)throw new SlotError('AdminBusy','An access change is already in progress. Refresh shortly.');
    mutating=true;try{return await work();}finally{mutating=false;}
  }
  return {
    resolve,
    async assertAction(user:Identity,action:string) {
      const access=await resolve(user);
      if(action==='approveBudget'||action==='mintERC1155'&&!access.mintEnabled||!access.operationsEnabled||access.role==='operator'&&!OPERATOR_ACTIONS.includes(action))throw new SlotError('AdminAction','Questa operazione richiede il proprietario o l’aggiornamento dei permessi.',403);
      return access;
    },
    async status(user:Identity) {
      if(!ownerId)return {state:'unconfigured' as const,role:null,wallet:null,members:[],operationsEnabled:false};
      const value=await wallet();
      if(!value)return {state:user.userId===ownerId?'create' as const:'waiting' as const,role:user.userId===ownerId?'owner' as const:null,wallet:null,members:[],operationsEnabled:false};
      try {
        const access=await resolve(user);
        const list=access.role==='owner'?(await members(value)).filter(item=>item.userId).map(item=>({userId:item.userId!,enabled:item.enabled})):[];
        return {state:'ready' as const,...access,members:list};
      }catch(error){if(error instanceof SlotError&&error.code==='AdminAccess')return {state:'waiting' as const,role:null,wallet:null,members:[],operationsEnabled:false};throw error;}
    },
    async create(user:Identity) {
      requireOwner(user);
      return exclusive(async()=>{
        if(await wallet())return;
        const quorum=await client.keyQuorums().create({display_name:'Lucky Signal admin owner',user_ids:[ownerId!],authorization_threshold:1});
        const value=await client.wallets().create({chain_type:'ethereum',display_name:'Lucky Signal shared admin',external_id:externalId,owner_id:quorum.id,
          idempotency_key:createHash('sha256').update(externalId+':'+ownerId).digest('hex')});
        walletId=value.id;await wallet();
      });
    },
    async setMember(user:Identity,authorization:WalletAuthorization,memberId:string,remove=false) {
      requireOwner(user);
      if(!/^did:privy:[a-zA-Z0-9_-]{5,100}$/.test(memberId)||memberId===ownerId)throw new SlotError('AdminMember','Enter the collaborator Privy account code.',400);
      await exclusive(async()=>{
        const value=await wallet();if(!value)throw new SlotError('AdminNotReady','Create the shared wallet first.');
        const list=await members(value),matches=list.filter(item=>item.userId===memberId);
        if(remove){
          if(!matches.length)return;
          await client.wallets().update(value.id,{additional_signers:value.additional_signers.filter(signer=>!matches.some(item=>item.signer.signer_id===signer.signer_id)),request_expiry:Date.now()+90000,authorization_context:authorization});
          return;
        }
        if(matches.length>1)throw new SlotError('AdminConfig','Remove duplicate access entries before authorizing this account again.');
        if(matches[0]?.enabled)return;
        if(value.additional_signers.length>=4&&!matches.length)throw new SlotError('AdminMembers','There are already four collaborators.');
        const member=await client.users()._get(memberId);if(member.id!==memberId)throw new SlotError('AdminMember','Account not found in this app.',400);
        const rules=operatorPolicy(value.address as Address,contract(),collection);
        const policy=await client.policies().create({name:'Lucky Signal admin operator',version:'1.0',chain_type:'ethereum',owner_id:value.owner_id!,rules});
        // A fresh policy is attached by the owner; collaborators never own their policy.
        const signerId=matches[0]?.signer.signer_id||(await client.keyQuorums().create({display_name:'Lucky Signal admin operator',user_ids:[memberId],authorization_threshold:1})).id;
        await client.wallets().update(value.id,{additional_signers:[...value.additional_signers.filter(signer=>signer.signer_id!==signerId),{signer_id:signerId,override_policy_ids:[policy.id]}],request_expiry:Date.now()+90000,authorization_context:authorization});
      });
    },
    async proof(user:Identity,authorization:WalletAuthorization) {
      const access=await resolve(user),message=adminProofMessage(access.wallet.address);
      const result=await client.wallets().ethereum().signMessage(access.wallet.id,{message,request_expiry:Date.now()+90000,authorization_context:authorization});
      if(!await verifyMessage({address:access.wallet.address as Address,message,signature:result.signature as `0x${string}`}))throw new SlotError('AdminProof','Invalid signature.',503);
      await resolve(user);
      return {verified:true,address:access.wallet.address};
    },
  };
}
export type AdminService=ReturnType<typeof createAdminService>;
