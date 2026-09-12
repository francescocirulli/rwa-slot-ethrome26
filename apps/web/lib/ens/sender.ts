import {createWalletClient,http,keccak256,type Address,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {sepolia} from 'viem/chains';
import {createPublicClient} from 'viem';
import {SlotError} from '../slot/errors';
// One Sepolia queue in the existing service. Pending signed bytes are reused verbatim.
// After a restart, contract idempotency plus pending-nonce checks gate new submissions.
export function createEnsSender(rpcUrl:string,key:Hex){
  const account=privateKeyToAccount(key),transport=http(rpcUrl,{timeout:12000,retryCount:0});
  const client=createPublicClient({chain:sepolia,transport}),wallet=createWalletClient({account,chain:sepolia,transport});
  let tail:Promise<unknown>=Promise.resolve();
  let pending:{raw:Hex;hash:Hex}|undefined;
  return {account,async send(to:Address,data:Hex){
    const task=tail.then(async()=>{
      if(await client.getChainId()!==11155111)throw new SlotError('EnsChain','Sepolia RPC configuration mismatch.',503);
      if(pending){
        const receipt=await client.getTransactionReceipt({hash:pending.hash}).catch(()=>null);
        if(!receipt){await client.sendRawTransaction({serializedTransaction:pending.raw}).catch(()=>{});throw new SlotError('EnsPending','A Sepolia transaction is under verification. Check again shortly.',409);}
        if((await client.getBlockNumber())<receipt.blockNumber+1n)throw new SlotError('EnsPending','Waiting for Sepolia confirmation.',409);
        pending=undefined;
      }
      const latest=await client.getTransactionCount({address:account.address,blockTag:'latest'});
      if(await client.getTransactionCount({address:account.address,blockTag:'pending'})!==latest)throw new SlotError('EnsPending','The backend has a pending Sepolia transaction. Check again shortly.',409);
      const request=await wallet.prepareTransactionRequest({to,data,value:0n,nonce:latest});
      if(request.gas*(request.maxFeePerGas??request.gasPrice??0n)>10n**16n)throw new SlotError('EnsGas','Sepolia fees exceed the configured operation limit.',503);
      const raw=await wallet.signTransaction(request),hash=keccak256(raw);pending={raw,hash};
      await client.sendRawTransaction({serializedTransaction:raw}).catch(()=>{});
      // Never forget the raw transaction after an ambiguous broadcast or receipt timeout.
      const receipt=await client.waitForTransactionReceipt({hash,confirmations:2,timeout:90000});pending=undefined;
      if(receipt.status!=='success')throw new SlotError('EnsReverted','Sepolia confirmed a failed operation. Your existing claim remains recoverable.',409);
      return hash;
    });
    tail=task.catch(()=>{});return task;
  }};
}
