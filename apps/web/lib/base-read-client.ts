import {createPublicClient} from 'viem';
import {base} from 'viem/chains';
import {rpcTransport} from './rpc-transport';

// Share one batched read client across admin inventory, swaps and balances.
// Fail over once per endpoint instead of retrying a throttled primary first.
export function createBaseReadClient(url=process.env.BASE_RPC_URL||'https://base-rpc.publicnode.com') {
  const urls=[url,...(process.env.BASE_RPC_FALLBACK_URLS||'').split(',')]
    .map(value=>value.trim()).filter((value,index,all)=>value&&all.indexOf(value)===index);
  return createPublicClient({chain:base,batch:{multicall:{wait:10}},transport:rpcTransport(urls)});
}

export function baseChainCheck(client:Pick<ReturnType<typeof createBaseReadClient>,'getChainId'>) {
  let checkedAt=0,pending:Promise<void>|undefined;
  return async()=>{
    if(Date.now()-checkedAt<60000)return;
    if(!pending)pending=(async()=>{if(await client.getChainId()!==8453)throw new Error('The RPC node is not on Base.');checkedAt=Date.now();})().finally(()=>{pending=undefined;});
    return pending;
  };
}
