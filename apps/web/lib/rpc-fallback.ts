import {shouldThrow} from 'viem';

// QuickNode uses the transaction-rejected code for exhausted read quotas too.
// Preserve viem's terminal transaction/revert errors, except this provider limit.
export function shouldThrowRpcError(error:Error) {
  const rpc=error as Error & {code?:number;details?:string};
  if(rpc.code===-32003&&/daily request limit reached/i.test(rpc.details||rpc.message))return false;
  return shouldThrow(error);
}
