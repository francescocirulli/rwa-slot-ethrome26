import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFunctionData, toHex, type Address, type Hex} from 'viem';
import {createWelcomeHistory, welcomeGrantData} from '../lib/slot/welcome-history';
import {slotAbi} from '../lib/slot/abi';
import type {SlotReader} from '../lib/slot/reader';
const player = '0x0000000000000000000000000000000000000001' as Address;
const slot = '0x0000000000000000000000000000000000000002' as Address;
function fixture(head = 10n) {
  const state = {head, fork: 0n, failLogs: false, failReceipt: false};
  const hash = (block: bigint) => toHex(block + state.fork * 1000000n, {size: 32});
  const logs: {address: Address; args: {player: Address; amount: bigint}; blockNumber: bigint; blockHash: Hex; transactionHash: Hex; removed: boolean}[] = [];
  const transactions = new Map<Hex, {to: Address; value: bigint; input: Hex; blockHash: Hex}>();
  const ranges: [bigint, bigint][] = [];
  const reader = {config: {address: slot, deploymentBlock: 1n}, contract: {address: slot, abi: slotAbi}, client: {
    getBlock: async ({blockNumber}: {blockNumber?: bigint}) => ({number: blockNumber ?? state.head, hash: hash(blockNumber ?? state.head)}),
    getContractEvents: async ({fromBlock, toBlock}: {fromBlock: bigint; toBlock: bigint}) => {
      ranges.push([fromBlock, toBlock]); if (state.failLogs) throw new Error('RPC unavailable');
      return logs.filter(log => log.blockNumber >= fromBlock && log.blockNumber <= toBlock);
    },
    getTransaction: async ({hash}: {hash: Hex}) => {const tx = transactions.get(hash); if (!tx) throw new Error('Transaction unavailable'); return tx;},
    getTransactionReceipt: async ({hash}: {hash: Hex}) => {
      if (state.failReceipt) throw new Error('Receipt unavailable');
      return {status: 'success', blockHash: transactions.get(hash)!.blockHash};
    },
  }} as unknown as SlotReader;
  function grant(block: bigint, input = welcomeGrantData(player), amount = 2n, to = slot) {
    const txHash = toHex(100000n + BigInt(logs.length), {size: 32});
    logs.push({address: slot, args: {player, amount}, blockNumber: block, blockHash: hash(block), transactionHash: txHash, removed: false});
    transactions.set(txHash, {to, value: 0n, input, blockHash: hash(block)});
    return txHash;
  }
  return {reader, state, logs, transactions, ranges, grant};
}
test('welcome history distinguishes the marked bonus from manual credits and verifies its receipt', async () => {
  const f = fixture();
  f.grant(2n, encodeFunctionData({abi: slotAbi, functionName: 'grantFreeSpins', args: [player, 2n]}));
  f.grant(3n, welcomeGrantData(player), 3n);
  f.grant(4n, welcomeGrantData(player), 2n, player);
  const reader = createWelcomeHistory(f.reader);
  assert.deepEqual({...await reader.read(player), blockHash: undefined}, {granted: false, complete: true, blockNumber: 10n, blockHash: undefined, transactionHash: undefined});
  f.state.head = 11n;
  const tx = f.grant(11n);
  f.state.failReceipt = true;
  await assert.rejects(reader.read(player), /Receipt unavailable/);
  f.state.failReceipt = false;
  assert.equal((await reader.read(player)).transactionHash, tx);
  assert.equal((await createWelcomeHistory(f.reader).read(player)).granted, true);
});
test('bounded scans never report a missing bonus before the whole history is checked', async () => {
  const f = fixture(30000n); f.grant(25000n);
  const reader = createWelcomeHistory(f.reader);
  const first = await reader.read(player);
  assert.equal(first.granted, false); assert.equal(first.complete, false); assert.equal(f.ranges.length, 12);
  assert.equal((await reader.read(player)).granted, true);
  assert.ok(f.ranges.every(([start, end]) => end - start < 2000n));
});
test('RPC failure does not advance a negative scan, and concurrent readers serialize progress', async () => {
  const f = fixture(), reader = createWelcomeHistory(f.reader);
  f.state.failLogs = true;
  await assert.rejects(reader.read(player), /RPC unavailable/);
  f.state.failLogs = false;
  const results = await Promise.all([reader.read(player), reader.read(player)]);
  assert.ok(results.every(result => result.complete && !result.granted));
  assert.deepEqual(f.ranges, [[1n, 10n], [1n, 10n]]);
});
test('a reorg invalidates both positive and negative history caches', async () => {
  const f = fixture(), reader = createWelcomeHistory(f.reader);
  f.grant(5n); assert.equal((await reader.read(player)).granted, true);
  f.state.fork++; f.logs.length = 0;
  assert.equal((await reader.read(player)).granted, false);
  f.state.fork++; f.grant(7n);
  assert.equal((await reader.read(player)).granted, true);
});
test('a verified wallet creation bound limits capped requests independently of the player-history floor', async () => {
  const f = fixture(25000n);
  f.reader.config.logPageBlocks = 5n;
  f.reader.config.historyFromBlock = 24990n;  const tx = f.grant(24995n);
  const result = await createWelcomeHistory(f.reader).read(player,24990n);
  assert.equal(result.granted, true); assert.equal(result.transactionHash, tx);
  assert.ok(f.ranges.length > 0);
  assert.ok(f.ranges.every(([start, end]) => start >= 24990n && end - start < 5n));
});

test('raising the player history floor never hides an earlier welcome grant',async()=>{
  const f=fixture();f.grant(2n);f.reader.config.historyFromBlock=9n;
  assert.equal((await createWelcomeHistory(f.reader).read(player)).granted,true);
});

test('an earlier creation bound invalidates a negative cache before permitting a grant',async()=>{
  const f=fixture();f.grant(2n);const history=createWelcomeHistory(f.reader);
  assert.equal((await history.read(player,8n)).granted,false);
  assert.equal((await history.read(player,1n)).granted,true);
});
