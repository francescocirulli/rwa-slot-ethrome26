import test from 'node:test';
import assert from 'node:assert/strict';
import {createSlotReader} from '../lib/slot/reader';
import {createSlotEngine} from '../lib/slot/engine';
import {createPortfolioReader} from '../lib/portfolio';
import {pairingSecretFromQr} from '../lib/pairing-qr';
const address='0x0000000000000000000000000000000000000011',slot='0x0000000000000000000000000000000000000099';
function fixture(){
  const reader=createSlotReader({address:slot,chainId:8453,rpcUrl:'http://localhost:1',deploymentBlock:1n,paymentToken:address,confirmations:2,gasMode:'usdc'});
  let current=0n,confirmed=0n,fail=false,logs=0;
  const blocks:bigint[]=[];
  reader.client.getChainId=async()=>8453;reader.client.getCode=async()=>'0x1234';reader.client.getBlockNumber=async()=>100000n;
  reader.client.getContractEvents=(async()=>{logs++;throw new Error('Archive requests require a personal token');}) as any;
  reader.client.readContract=(async(args:any)=>{
    if(args.functionName==='paymentToken')return address;
    if(fail)throw new Error('RPC unavailable');
    if(args.functionName==='getPlayerState'){blocks.push(args.blockNumber);return [2n,args.blockNumber===100000n?current:confirmed];}
    if(args.functionName==='allowance')return 2500000n;
    if(args.functionName==='balanceOf')return 10000000n;
    throw new Error('Unexpected call');
  }) as any;
  return {reader,blocks,set:(a:bigint,b:bigint)=>{current=a;confirmed=b;},fail:()=>{fail=true;},logs:()=>logs};
}
test('wallet allowance works when historical log queries are forbidden, including a long-idle account',async()=>{
  const f=fixture(),engine=createSlotEngine(f.reader);
  const wallet=await engine.walletView(address);
  assert.equal(wallet.allowance,'2500000');assert.equal(wallet.freeSpins,'2');assert.equal(wallet.busy,false);assert.equal(f.logs(),0);
  assert.deepEqual(f.blocks,[100000n,99999n]);
  const read=createPortfolioReader((async()=>({address,contract:slot,updatedAt:1,eth:'0',assets:[],nfts:[],freeSpins:'2'})) as any,()=>engine);
  const portfolio=await read(address);assert.equal(portfolio.canTransact,true);assert.equal(portfolio.allowance,'2500000');assert.equal(portfolio.stateUnavailable,false);assert.equal(f.logs(),0);
});
test('current pending rounds and just-settled unconfirmed rounds keep wallet writes locked without history',async()=>{
  const f=fixture();f.set(7n,0n);assert.equal((await f.reader.walletState(address)).busy,true);
  f.set(0n,7n);assert.equal((await f.reader.walletState(address)).busy,true);
  f.set(0n,0n);assert.equal((await f.reader.walletState(address)).busy,false);
  f.fail();await assert.rejects(f.reader.walletState(address),/RPC unavailable/);assert.equal(f.logs(),0);
});
test('scanner accepts only a single valid pairing secret from this origin and never navigates to QR content',()=>{
  const origin='https://slot.example',secret='a'.repeat(64);
  assert.equal(pairingSecretFromQr(origin+'/phone#pair='+secret,origin),secret);
  for(const value of ['javascript:alert(1)','/phone#pair='+secret,origin+'/phone#pair=short','https://evil.example/phone#pair='+secret,origin+'/admin#pair='+secret,origin+'/phone#pair='+secret+'&pair='+secret,'https://user:pass@slot.example/phone#pair='+secret])assert.throws(()=>pairingSecretFromQr(value,origin));
});
