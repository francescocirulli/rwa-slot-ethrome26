import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData,erc20Abi} from 'viem';
import {createContractApi} from '../lib/slot/transactions';
import {createSlotEngine,type SlotEngine} from '../lib/slot/engine';
import {createWriteCoordinator} from '../lib/admin/write-coordinator';
import {createPortfolioReader} from '../lib/portfolio';
import {createAccountHandler} from '../lib/account';
import {RWA_ASSETS} from '../lib/assets';
import {BASE_PRIZE_COLLECTION,prizeCollectionAbi} from '../lib/prize-collection';
import {walletAuthorizations} from '../lib/wallet-authorization';
import type {WalletService} from '../lib/types';
const origin='https://slot.example',address='0x0000000000000000000000000000000000000011',recipient='0x0000000000000000000000000000000000000022',contract='0x0000000000000000000000000000000000000099';
function fixture() {
  let pending=false,unconfirmed=false,decimals=8,balance=100000000n,fail=false;
  const sends:any[]=[],writes=createWriteCoordinator();
  const reader={config:{address:contract,paymentToken:recipient,chainId:8453,gasMode:'usdc',confirmations:2},validate:async()=>{},catalog:async()=>[],
    player:async()=>({historyReady:true,game:{pending,hasResult:unconfirmed,confirmed:!unconfirmed}}),
    client:{simulateContract:async()=>{},readContract:async({functionName}:any)=>functionName==='decimals'?decimals:balance}} as any;
  const service={authenticate:async(token:string)=>{if(!['owner','other'].includes(token))throw new Error();return {userId:token,wallets:[{id:token,address:token==='owner'?address:recipient}]};},
    sendOwned:async(wallet:any,authorization:any,transaction:any)=>{if(fail)throw new Error('network timeout');sends.push({wallet,authorization,transaction});return {transactionId:'pending-provider'};}} as unknown as WalletService;
  const api=createContractApi({walletService:service,origin,getSlot:()=>({reader}) as SlotEngine,personalCoordinator:writes});
  async function call(kind:'prepare'|'send'|'status'|'cancel',body:any,token='owner',requestOrigin=origin){
    const path='/api/contract/'+kind,headers:Record<string,string>={Authorization:'Bearer '+token,Origin:requestOrigin,'Content-Type':'application/json','X-Slot-Request':'1'};
    if(kind==='send')headers['X-Wallet-Authorization']=walletAuthorizations().create(token,path).id;
    const response=await api.handle(new Request(origin+path+(kind==='status'?'?id='+body:''),{method:kind==='status'?'GET':'POST',headers,body:kind==='status'?undefined:JSON.stringify(body)}),kind);
    await new Promise(resolve=>setTimeout(resolve,0));return {status:response.status,body:await response.json()};
  }
  return {reader,service,writes,call,sends,pending:(value:boolean)=>{pending=value;},unconfirmed:(value:boolean)=>{unconfirmed=value;},decimals:(value:number)=>{decimals=value;},balance:(value:bigint)=>{balance=value;},fail:()=>{fail=true;}};
}
const token=RWA_ASSETS[0],transfer={action:'transferERC20',args:[token.address,recipient,'50000']};
test('unpaired owner reviews exact token units; cross-account, origin and duplicate sends cannot redirect funds',async()=>{
  const f=fixture();assert.equal((await f.call('prepare',transfer,'bad')).status,401);assert.equal((await f.call('prepare',transfer,'owner','https://bad.example')).status,403);
  const prepared=await f.call('prepare',transfer);assert.equal(prepared.status,200);assert.equal(f.sends.length,0);
  assert.deepEqual(decodeFunctionData({abi:erc20Abi,data:prepared.body.transaction.data}).args,[recipient,50000n]);
  assert.equal((await f.call('send',{id:prepared.body.id,confirm:true},'other')).status,404);
  assert.equal((await f.call('send',{id:prepared.body.id})).status,400);
  await f.call('send',{id:prepared.body.id,confirm:true,args:[token.address,address,'999999'],transaction:{to:address}});
  await f.call('send',{id:prepared.body.id,confirm:true});assert.equal(f.sends.length,1);assert.equal(f.sends[0].wallet.address,address);assert.equal(f.sends[0].transaction.data,prepared.body.transaction.data);
  assert.equal(typeof f.sends[0].authorization.sign_fns[0],'function');
});
test('known assets, verified decimals, current balances and whole NFT quantities are enforced',async()=>{
  const f=fixture();
  for(const input of [
    {action:'transferERC20',args:[recipient,address,'1']},
    {action:'transferERC20',args:[token.address,address,'1']},
    {action:'transferERC20',args:[token.address,recipient,'0']},
    {action:'transferERC20',args:[token.address,recipient,'100000001']},
    {action:'transferERC1155',args:[BASE_PRIZE_COLLECTION,'999',recipient,'1']},
    {action:'transferERC1155',args:[BASE_PRIZE_COLLECTION,'5',recipient,'1.5']},
  ]) assert.notEqual((await f.call('prepare',input)).status,200);
  f.reader.client.simulateContract=async()=>({result:false});assert.equal((await f.call('prepare',transfer)).status,409);f.reader.client.simulateContract=async()=>({result:true});
  f.decimals(18);assert.equal((await f.call('prepare',transfer)).status,503);f.decimals(8);
  const nft=await f.call('prepare',{action:'transferERC1155',args:[BASE_PRIZE_COLLECTION,'5',recipient,'2']});assert.equal(nft.status,200);
  assert.deepEqual(decodeFunctionData({abi:prizeCollectionAbi,data:nft.body.transaction.data}).args,[address,recipient,5n,2n,'0x']);
  f.balance(1n);await f.call('send',{id:nft.body.id,confirm:true});assert.equal(f.sends.length,0);assert.equal((await f.call('status',nft.body.id)).body.stage,'failed');
});
test('wallet review blocks a lever pull; a pending round blocks prepare and a new external round blocks send',async()=>{
  const f=fixture(),prepared=await f.call('prepare',transfer);
  const engine=createSlotEngine(f.reader,undefined,f.writes);
  await assert.rejects(engine.start(address,0n,'free',{assertSession:()=>{}}),/operation in progress/);
  await f.call('cancel',{id:prepared.body.id});f.pending(true);
  assert.equal((await f.call('prepare',transfer)).status,409);
  f.pending(false);f.unconfirmed(true);assert.equal((await f.call('prepare',transfer)).status,409);f.unconfirmed(false);const next=await f.call('prepare',transfer);f.pending(true);
  await f.call('send',{id:next.body.id,confirm:true});assert.equal(f.sends.length,0);
  f.pending(false);await f.writes.acquire(address,'spin-fixture',async()=>false);
  assert.equal((await f.call('prepare',transfer)).status,409);
});
test('finite allowance replacement and revocation are reviewed onchain actions; ambiguous submission stays locked',async()=>{
  const f=fixture();
  assert.equal((await f.call('prepare',{action:'approveBudget',args:[(2n**256n-1n).toString()]})).status,400);
  for(const amount of ['5000000','0']){
    const p=await f.call('prepare',{action:'approveBudget',args:[amount]});assert.equal(p.status,200);
    assert.deepEqual(decodeFunctionData({abi:erc20Abi,data:p.body.transaction.data}).args,[contract,BigInt(amount)]);
    await f.call('cancel',{id:p.body.id});
  }
  const p=await f.call('prepare',transfer);f.fail();await f.call('send',{id:p.body.id,confirm:true});
  assert.equal((await f.call('status',p.body.id)).body.stage,'uncertain');assert.equal((await f.call('prepare',transfer)).status,409);
});
test('account portfolio uses verified ownership without a pairing cookie and preserves wallet access on RPC failure',async()=>{
  const f=fixture(),addresses:string[]=[];
  const handler=createAccountHandler(f.service,async()=>({amount:'2',stale:false,updatedAt:1}),async(address)=>{addresses.push(address);throw new Error('RPC');});
  const response=await handler(new Request(origin+'/api/account?address='+recipient,{headers:{Authorization:'Bearer owner'}}));
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.wallet.address,address);assert.equal(data.wallet.portfolio,null);assert.deepEqual(addresses,[address]);
});
test('portfolio coalesces reads and distinguishes zero allowance, busy rounds and unavailable chain state',async()=>{
  let reads=0;
  const inventory=async()=>{reads++;return {address,contract,updatedAt:1,eth:'0',assets:[],nfts:[],freeSpins:'2'};} ;
  const slot={reader:{config:{address:contract,gasMode:'usdc'},settings:async()=>({ticketPrice:50000n})},playerView:async()=>({allowance:'0',historyReady:true,game:{id:'1',pending:true},operation:null})};
  const read=createPortfolioReader(inventory as any,()=>slot as unknown as SlotEngine);
  const [a,b]=await Promise.all([read(address),read(address)]);assert.equal(reads,1);assert.equal(a,b);assert.equal(a.allowance,'0');assert.equal(a.busy,true);assert.equal(a.canTransact,false);
  const unavailable=createPortfolioReader(inventory as any,()=>({...slot,playerView:async()=>{throw new Error();}}) as unknown as SlotEngine);
  const value=await unavailable(address);assert.equal(value.allowance,null);assert.equal(value.canTransact,false);
});
test.afterEach(()=>walletAuthorizations().dispose());
