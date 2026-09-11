import type {PrivyClient} from '@privy-io/node';
import type {Address} from 'viem';
export function spinPolicy(address: Address, chainId: number): Parameters<ReturnType<PrivyClient['policies']>['create']>[0]['rules'] {
  return [{name: 'Only startSpin on this slot', method: 'eth_sendTransaction', action: 'ALLOW', conditions: [
    {field_source: 'ethereum_transaction', field: 'chain_id', operator: 'eq', value: String(chainId)},
    {field_source: 'ethereum_transaction', field: 'to', operator: 'eq', value: address},
    {field_source: 'ethereum_transaction', field: 'value', operator: 'eq', value: '0'},
    {field_source: 'ethereum_calldata', field: 'function_name', operator: 'eq', value: 'startSpin',
      abi: [{type: 'function', name: 'startSpin', inputs: [], outputs: [{name: 'gameId', type: 'uint256'}], stateMutability: 'nonpayable'}]},
  ]}];
}
