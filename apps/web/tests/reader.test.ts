import test from 'node:test';
import assert from 'node:assert/strict';
import {toHex, type Address, type Hash} from 'viem';
import {createSlotReader} from '../lib/slot/reader';
import type {SlotConfig} from '../lib/slot/config';
const player = '0x0000000000000000000000000000000000000001' as Address;
const slot = '0x0000000000000000000000000000000000000002' as Address;
const token = '0x0000000000000000000000000000000000000011' as Address;
const hash = (block: bigint) => toHex(block, {size: 32}) as Hash;

function fixture(config: Partial<SlotConfig> = {}) {
  const reader = createSlotReader({address: slot, chainId: 8453, rpcUrl: 'http://localhost:1', deploymentBlock: 1n,
    historyFromBlock: 1n, logPageBlocks: 5n, paymentToken: token, confirmations: 2, gasMode: 'usdc', ...config});
  const ranges: [bigint, bigint][] = [];
  const state = {spinBlock: 0n, revealBlock: 0n, hasResult: true, won: false};
  (reader.client as any).getChainId = async () => 8453;
  (reader.client as any).getCode = async () => '0x1234';
  (reader.client as any).getBlockNumber = async () => 400n;
  (reader.client as any).getBlock = async ({blockNumber}: {blockNumber: bigint}) => ({number: blockNumber, hash: hash(blockNumber)});
  (reader.client as any).readContract = async (args: any) => {
    if (args.functionName === 'paymentToken') return token;
    if (args.functionName === 'getGame') return {hasResult: state.hasResult, targetBlock: 100n, revealDeadline: 356n, won: state.won};
    if (args.functionName === 'getGameStatus') return 4;
    throw new Error('Unexpected call ' + args.functionName);
  };
  (reader.client as any).getContractEvents = async (args: any) => {
    ranges.push([args.fromBlock, args.toBlock]);
    if (args.eventName === 'SpinStarted' && state.spinBlock >= args.fromBlock && state.spinBlock <= args.toBlock) {
      return [{args: {gameId: 7n}, blockNumber: state.spinBlock, blockHash: hash(state.spinBlock), transactionHash: hash(state.spinBlock)}];
    }
    if (args.eventName === 'RoundRevealed' && state.revealBlock >= args.fromBlock && state.revealBlock <= args.toBlock) {
      return [{blockNumber: state.revealBlock, transactionHash: hash(state.revealBlock)}];
    }
    return [];
  };
  return {reader, ranges, state};
}

test('reveal history pages a capped eth_getLogs range and stops at the first match', async () => {
  const f = fixture();
  f.state.revealBlock = 108n;
  const game = await f.reader.game(7n, 110n);
  assert.equal(game.resultBlock, 108n);
  assert.equal(game.transactionHash, hash(108n));
  assert.equal(f.ranges.length, 2);
  assert.ok(f.ranges.every(([start, end]) => end - start < 5n && start >= 101n));
  assert.deepEqual(f.ranges, [[101n, 105n], [106n, 110n]]);
});

test('reveal history reads only one page when the reveal is in the first page', async () => {
  const f = fixture();
  f.state.revealBlock = 103n;
  const game = await f.reader.game(7n, 300n);
  assert.equal(game.resultBlock, 103n);
  assert.deepEqual(f.ranges, [[101n, 105n]]);
});

test('player history stops at the configured floor without scanning past it', async () => {
  const f = fixture({historyFromBlock: 90n});
  const last = await f.reader.lastGame(player, 100n);
  assert.deepEqual(last, {id: 0n, complete: true});
  assert.ok(f.ranges.length > 0);
  assert.ok(f.ranges.every(([start, end]) => start >= 90n && end - start < 5n));
});

test('player history finds a spin above the floor and respects the page size', async () => {
  const f = fixture({historyFromBlock: 1n});
  f.state.spinBlock = 99n;
  const last = await f.reader.lastGame(player, 100n);
  assert.equal(last.id, 7n);
  assert.equal(last.complete, true);
  assert.ok(f.ranges.every(([start, end]) => end - start < 5n));
  assert.ok(f.ranges.some(([start, end]) => start <= 99n && end >= 99n));
});
