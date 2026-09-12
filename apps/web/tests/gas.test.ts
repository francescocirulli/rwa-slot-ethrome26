import test from 'node:test';
import assert from 'node:assert/strict';
import {APIError} from '@privy-io/node';
import {sendWithGas,insufficientTokenGas,definiteSendFailure,transactionError,type GasOptions} from '../lib/slot/gas';
import {SlotError} from '../lib/slot/errors';
import {loadSlotConfig} from '../lib/slot/config';
const rejected=(body:object,status=400)=>new APIError(status,body,'Provider response',new Headers());
const shortage=()=>rejected({error:'Insufficient USDC balance to cover gas',code:'insufficient_balance'});
test('user pays requests USDC explicitly; no ETH attempt after a successful pending submission',async()=>{
  const calls:GasOptions[]=[];
  const result=await sendWithGas({mode:'usdc',key:'operation',send:async options=>{calls.push(options);return {hash:'',transactionId:'pending-id'};}});
  assert.equal(result.gasToken,'USDC');assert.equal(result.transactionId,'pending-id');
  assert.equal(calls.length,1);assert.equal(calls[0].sponsor,true);assert.deepEqual(calls[0].sponsor_options,{asset:'usdc'});
});
test('explicit insufficient-token rejection falls back once with a distinct stable ETH idempotency key',async()=>{
  const calls:GasOptions[]=[];
  async function run(){return sendWithGas({mode:'usdc',key:'same-operation',send:async options=>{calls.push(options);if(options.sponsor)throw shortage();return {hash:'0xconfirmed'};}});}
  assert.equal((await run()).gasToken,'ETH');assert.equal(calls.length,2);assert.equal(calls[1].sponsor,false);assert.equal(calls[1].sponsor_options,undefined);assert.notEqual(calls[0].idempotency_key,calls[1].idempotency_key);
  await run();assert.equal(calls[0].idempotency_key,calls[2].idempotency_key);assert.equal(calls[1].idempotency_key,calls[3].idempotency_key);
});
test('uncertain sends, configuration, policy, revert and native errors never trigger fallback',async()=>{
  for(const error of [new Error('Insufficient USDC balance'),rejected({error:'Insufficient USDC balance'},500),rejected({error:'Insufficient USDC balance'},403),
    rejected({error:'asset not configured'}),rejected({error:'execution reverted: insufficient balance'}),rejected({error:'insufficient ETH balance'}),rejected({error:'insufficient allowance'}),
    rejected({error:'Insufficient USDC balance',transaction_id:'already-submitted'}),rejected({error:'Insufficient USDC balance',hash:'0xabc'}),rejected({error:'Insufficient USDC balance',detail:'x'.repeat(9000)})]){
    let count=0;await assert.rejects(sendWithGas({mode:'usdc',key:'ambiguous',send:async()=>{count++;throw error;}}));assert.equal(count,1);assert.equal(insufficientTokenGas(error),false);
  }
});
test('logout between USDC rejection and fallback prevents the ETH transaction',async()=>{
  let active=true,count=0;
  await assert.rejects(sendWithGas({mode:'usdc',key:'session',assertValid:()=>{if(!active)throw new SlotError('SessionClosed','Expired');},send:async()=>{count++;active=false;throw shortage();}}),/Expired/);
  assert.equal(count,1);
});
test('asynchronous membership revocation between fee attempts prevents ETH fallback',async()=>{
  let checks=0,sends=0;
  await assert.rejects(sendWithGas({mode:'usdc',key:'admin-revoked',assertValid:async()=>{await Promise.resolve();if(++checks===2)throw new SlotError('AdminAccess','Revoked',403);},send:async()=>{sends++;throw shortage();}}),/Revoked/);
  assert.equal(sends,1);assert.equal(checks,2);
});
test('both currencies insufficient produces a terminal error without more retries',async()=>{
  let count=0;
  await assert.rejects(sendWithGas({mode:'usdc',key:'empty',send:async gas=>{count++;throw gas.sponsor?shortage():rejected({error:'insufficient funds for gas'});}}),error=>{
    assert.equal(definiteSendFailure(error),true);assert.match(transactionError(error),/Top up USDC or ETH/);return true;
  });assert.equal(count,2);
});
test('ETH-only requests omit token sponsorship and config defaults to the authorized user-pays mode',async()=>{
  const result=await sendWithGas({mode:'eth',key:'eth-only',send:async gas=>{assert.equal(gas.sponsor,false);assert.equal(gas.sponsor_options,undefined);return {};}});assert.equal(result.gasToken,'ETH');
  const env={NODE_ENV:'test' as const,SLOT_CONTRACT_ADDRESS:'0x0000000000000000000000000000000000000099',SLOT_DEPLOYMENT_BLOCK:'1'};
  assert.equal(loadSlotConfig(env)?.gasMode,'usdc');assert.equal(loadSlotConfig({...env,PRIVY_GAS_MODE:'eth'})?.gasMode,'eth');
  assert.throws(()=>loadSlotConfig({...env,PRIVY_GAS_MODE:'wrong'}));
});
