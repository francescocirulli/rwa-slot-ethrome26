import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createPublicClient, createWalletClient, defineChain, http, erc20Abi, keccak256, toHex, zeroAddress, type Address, type Hex, type Abi} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import {slotAbi} from '../lib/slot/abi';
import {createSlotReader} from '../lib/slot/reader';
import {createSlotEngine} from '../lib/slot/engine';
import {buildAction, prepareAction} from '../lib/slot/actions';
import {spinPolicy} from '../lib/slot/policy';
const rpc = 'http://127.0.0.1:8547';
const chain = defineChain({id:31337,name:'Anvil',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const mnemonic = 'test test test test test test test test test test test junk';
const owner = mnemonicToAccount(mnemonic, {addressIndex:0}), player = mnemonicToAccount(mnemonic, {addressIndex:1}), keeper = mnemonicToAccount(mnemonic, {addressIndex:2});
const client = createPublicClient({chain,transport:http(rpc,{retryCount:0})});
const adminWallet = createWalletClient({account:owner,chain,transport:http(rpc)}), userWallet = createWalletClient({account:player,chain,transport:http(rpc)});
async function mine(blocks=1) {await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'anvil_mine',params:['0x'+blocks.toString(16)]})});}
async function until<T>(check:()=>Promise<T | null>, message:string): Promise<T> {for(let attempt=0;attempt<100;attempt++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw new Error(message);}
test('contract integration on Anvil: wallets, two-phase spins, restart recovery, payouts, expiry, admin writes', {timeout:120000}, async t => {
  const process = spawn('anvil',['--host','127.0.0.1','--port','8547','--silent'],{stdio:'ignore'});
  let engine: ReturnType<typeof createSlotEngine> | undefined;
  try {
    await until(async()=>client.getChainId().catch(()=>null),'Anvil did not start');
    const fixtures=JSON.parse(await readFile(new URL('./contracts/artifacts.json',import.meta.url),'utf8'));
    async function deploy(abi: Abi, bytecode: Hex, args: unknown[]) {const hash=await adminWallet.deployContract({abi,bytecode,args});const receipt=await client.waitForTransactionReceipt({hash});return receipt.contractAddress!;}
    const payment=await deploy(fixtures.MockERC20.abi,fixtures.MockERC20.bytecode,['USDC test','USDC',6]);
    const prize=await deploy(fixtures.MockERC20.abi,fixtures.MockERC20.bytecode,['Stock test','STOCK',18]);
    const nft=await deploy(fixtures.MockERC1155.abi,fixtures.MockERC1155.bytecode,[]);
    const slot=await deploy(slotAbi,fixtures.slotBytecode,[owner.address,payment,1000000n]);
    const deployed=await client.getBlockNumber({cacheTime:0});
    async function write(functionName: string,args: unknown[]=[]) {const hash=await adminWallet.writeContract({address:slot,abi:slotAbi as Abi,functionName,args});const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return r;}
    const config={address:slot,deploymentBlock:deployed,chainId:31337,rpcUrl:rpc,paymentToken:payment,gasMode:'eth' as const,confirmations:2};
    const reader=createSlotReader(config);
    engine=createSlotEngine(reader,toHex(keeper.getHdKey().privateKey!) as Hex);
    await write('setNoWinWeight',[0]);
    for (let symbol=0;symbol<3;symbol++) await write('configurePrize',[symbol,1,prize,0n,BigInt((symbol+1)*200),0,symbol===2?400:300]);
    await adminWallet.writeContract({address:prize,abi:fixtures.MockERC20.abi,functionName:'mint',args:[slot,100000n]});
    await adminWallet.writeContract({address:payment,abi:fixtures.MockERC20.abi,functionName:'mint',args:[player.address,20000000n]});
    await userWallet.writeContract({address:payment,abi:erc20Abi,functionName:'approve',args:[slot,10000000n]});
    await write('grantRole',[keccak256(toHex('GAME_MANAGER_ROLE')),keeper.address]);
    await engine.tick();
    let sends=0;
    const paid={assertSession:()=>{},maxPrice:1000000n,sendPaid:async()=>{sends++;return {hash:await userWallet.writeContract({address:slot,abi:slotAbi,functionName:'startSpin'})};}};
    let firstId=0n;
    await t.test('paid transaction belongs to player and duplicate requests do not buy two tickets',async()=>{
      const first=await engine!.start(player.address,0n,'paid',paid);
      const duplicate=await engine!.start(player.address,0n,'free',{assertSession:()=>{}});
      assert.equal(duplicate.key,first.key);
      const state=await until(async()=>{const s=await engine!.playerView(player.address);return s.game?.pending?s:null;},'Spin not recorded');
      firstId=BigInt(state.game!.id);assert.equal(state.game!.player,player.address);assert.equal(state.game!.freeSpin,false);assert.equal(state.game!.status,'waiting');
      assert.equal(sends,1);
      assert.equal(await client.readContract({address:payment,abi:erc20Abi,functionName:'balanceOf',args:[player.address]}),19000000n);
    });
    await t.test('waiting lasts through target block; a restarted keeper reveals without a browser session',async()=>{
      const pending=await reader.game(firstId);const head=await client.getBlockNumber({cacheTime:0});
      await mine(Number(pending.targetBlock-head));await engine!.tick();assert.equal((await reader.game(firstId)).status,'waiting');
      engine!.stop();engine=createSlotEngine(createSlotReader(config),toHex(keeper.getHdKey().privateKey!) as Hex);
      await mine();await engine.tick();
      await until(async()=>{const g=await reader.game(firstId);return g.hasResult?g:null;},'Keeper did not reveal');
      await mine();const result=await reader.game(firstId);assert.equal(result.confirmed,true);assert.equal(result.status,'won');assert.equal(result.symbols.length,15);assert.ok(result.payout);assert.equal(result.payout.kind,1);
      assert.equal(await client.readContract({address:prize,abi:erc20Abi,functionName:'balanceOf',args:[player.address]}),result.payout.amount);
      for(let column=0;column<5;column++)assert.equal(new Set([result.symbols[column],result.symbols[column+5],result.symbols[column+10]]).size,3);
    });
    await t.test('historical reward uses the event after prize configuration changes',async()=>{
      const before=await reader.game(firstId);
      const symbol=before.winningSymbol;
      await write('configurePrize',[symbol,1,prize,0n,9998n,0,symbol===2?400:300]);
      const after=await createSlotReader(config).player(player.address);
      assert.equal(after.latestGameId,firstId);assert.equal(after.game!.payout!.amount,before.payout!.amount);assert.notEqual(after.game!.payout!.amount,9998n);
      const duplicate=await engine!.start(player.address,0n,'paid',paid);assert.equal(duplicate.gameId,firstId.toString());assert.equal(sends,1);
    });
    let freeId=0n;
    await t.test('free spin is sent by backend for player and does not debit USDC',async()=>{
      await write('grantFreeSpins',[player.address,2n]);await engine!.tick();
      const balance=await client.readContract({address:payment,abi:erc20Abi,functionName:'balanceOf',args:[player.address]});
      await engine!.start(player.address,firstId,'free',{assertSession:()=>{}});
      const next=await until(async()=>{const state=await reader.player(player.address);return state.game?.pending?state:null;},'Free spin missing');
      freeId=next.latestGameId;assert.equal(next.game!.freeSpin,true);assert.equal(next.game!.player,player.address);assert.equal(next.freeSpins,1n);
      assert.equal(await client.readContract({address:payment,abi:erc20Abi,functionName:'balanceOf',args:[player.address]}),balance);
      const logs=await client.getContractEvents({address:slot,abi:slotAbi,eventName:'SpinStarted',args:{gameId:freeId},fromBlock:deployed});
      const tx=await client.getTransaction({hash:logs[0].transactionHash});assert.equal(tx.from.toLowerCase(),keeper.address.toLowerCase());
    });
    await t.test('missed reveal expires onchain, releases inventory, and never reports a made-up result',async()=>{
      const game=await reader.game(freeId);const head=await client.getBlockNumber({cacheTime:0});await mine(Number(game.revealDeadline-head+1n));
      assert.equal((await reader.game(freeId)).status,'expired');await engine!.tick();
      await until(async()=>{const g=await reader.game(freeId);return g.invalidated?g:null;},'Expired round not cleaned');
      const final=await reader.game(freeId);assert.equal(final.hasResult,false);assert.equal(final.status,'invalidated');assert.equal((await reader.activeGames()).length,0);
    });
    await t.test('admin preflights enforce onchain roles and transaction targets',async()=>{
      await assert.rejects(prepareAction(reader,player.address,'pause',[]));
      const tx=await prepareAction(reader,owner.address,'pause',[]);assert.equal(tx.to,slot);assert.equal(tx.value,'0x0');
      const hash=await adminWallet.sendTransaction({to:tx.to,data:tx.data});await client.waitForTransactionReceipt({hash});
      assert.equal((await reader.settings()).paused,true);
      await assert.rejects(prepareAction(reader,owner.address,'startFreeSpin',[player.address]));
      await assert.rejects(prepareAction(reader,owner.address,'revealRound',[freeId.toString()]));
      const approval=buildAction(reader,player.address,'approveBudget',['2000000']);assert.equal(approval.to,payment);
      await assert.rejects(async()=>buildAction(reader,player.address,'approveBudget',[(2n**256n-1n).toString()]));
    });
    await t.test('USDC gas preflight works for a wallet with zero ETH',async()=>{
      const empty=mnemonicToAccount(mnemonic,{addressIndex:4}).address;
      await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'anvil_setBalance',params:[empty,'0x0']})});
      assert.equal(await client.getBalance({address:empty}),0n);
      const tx=await prepareAction(createSlotReader({...config,gasMode:'usdc'}),empty,'approveBudget',['2000000']);
      assert.equal(tx.to,payment);assert.equal(tx.gasMode,'usdc');
    });
    await t.test('ERC1155 prizes are transferred to the player and decoded from PrizePaid',async()=>{
      await write('unpause');
      for(let symbol=0;symbol<3;symbol++)await write('configurePrize',[symbol,2,nft,7n,2n,0,symbol===2?400:300]);
      await adminWallet.writeContract({address:nft,abi:fixtures.MockERC1155.abi,functionName:'mint',args:[slot,7n,100n]});
      await engine!.tick();await engine!.start(player.address,freeId,'paid',paid);
      const pending=await until(async()=>{const g=await reader.player(player.address);return g.game?.pending?g.game:null;},'NFT round not started');
      const head=await client.getBlockNumber({cacheTime:0});await mine(Number(pending.targetBlock-head+1n));await engine!.tick();await mine();
      const result=await reader.game(pending.id);assert.equal(result.confirmed,true);assert.equal(result.payout!.kind,2);assert.equal(result.payout!.tokenId,7n);assert.equal(result.payout!.amount,2n);
      assert.equal(await client.readContract({address:nft,abi:fixtures.MockERC1155.abi,functionName:'balanceOf',args:[player.address,7n]}),2n);
    });
    await t.test('free-spin rewards credit the stored player without sending tokens',async()=>{
      for(let symbol=0;symbol<3;symbol++)await write('configurePrize',[symbol,3,zeroAddress,0n,3n,0,symbol===2?400:300]);
      const before=await reader.player(player.address);await engine!.tick();await engine!.start(player.address,before.latestGameId,'paid',paid);
      const pending=await until(async()=>{const g=await reader.player(player.address);return g.game?.pending?g.game:null;},'Reward round not started');
      const head=await client.getBlockNumber({cacheTime:0});await mine(Number(pending.targetBlock-head+1n));await engine!.tick();await mine();
      const result=await reader.game(pending.id);assert.equal(result.confirmed,true);assert.equal(result.payout!.kind,3);assert.equal(result.payout!.amount,3n);
      assert.equal((await reader.player(player.address)).freeSpins,before.freeSpins+3n);
    });
    await t.test('signer policy only permits this chain, slot, zero value and startSpin selector',async()=>{
      const [rule]=spinPolicy(slot,31337);assert.equal(rule.method,'eth_sendTransaction');assert.equal(rule.action,'ALLOW');assert.equal(rule.conditions.length,4);
      assert.ok(rule.conditions.some(c=>c.field==='to'&&c.value===slot));assert.ok(rule.conditions.some(c=>c.field==='function_name'&&c.value==='startSpin'));
    });
    await t.test('a long-idle history cache resumes in bounded requests instead of blocking the terminal',async()=>{
      const empty=mnemonicToAccount(mnemonic,{addressIndex:3}).address;
      const fresh=createSlotReader(config);
      assert.deepEqual(await fresh.lastGame(empty,await client.getBlockNumber({cacheTime:0})),{id:0n,complete:true});
      await mine(24001);
      const block=await client.getBlockNumber({cacheTime:0});
      assert.deepEqual(await fresh.lastGame(empty,block),{id:0n,complete:false});
      assert.deepEqual(await fresh.lastGame(empty,block),{id:0n,complete:true});
    });
  } finally {engine?.stop();process.kill('SIGTERM');}
});
