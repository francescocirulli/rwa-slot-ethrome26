import {createWalletClient, fallback, http, encodeFunctionData, parseEventLogs, keccak256, toHex, type Address, type Hash, type Hex, type TransactionReceipt} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import type {SlotReader} from './reader';
import {serializable} from './config';
import {SlotError, slotError} from './errors';
import {logSpinFailure} from './diagnostics';
import {createPrizeAvailability} from './availability';
import {slotAbi} from './abi';
import {definiteSendFailure, transactionError, type GasToken} from './gas';
import type {WelcomeView} from '../welcome';
import {personalWrites, type WriteCoordinator} from '../admin/write-coordinator';
import {createWelcomeHistory, welcomeGrantData, type WelcomeHistory} from './welcome-history';
import {BASE_PRIZE_COLLECTION,prizeCollectionAbi} from '../prize-collection';
import {shouldThrowRpcError} from '../rpc-fallback';
export type SubmittedSpin = {hash?: Hash; transactionId?: string; userOperationHash?:Hash; gasToken?: GasToken};
export type SpinOperation = {key: string; attempt: number; player: Address; afterGameId: string; stage: 'submitting' | 'confirming' | 'started' | 'failed' | 'uncertain'; hash?: Hash; gameId?: string; error?: string; gasToken?: GasToken; transactionId?: string};
export function createSlotEngine(reader: SlotReader, backendKey?: Hex, writes:WriteCoordinator=personalWrites()) {
  const {client, config, chain, contract} = reader;
  const backend = backendKey ? privateKeyToAccount(backendKey) : undefined;
  const backendRpcUrls=config.rpcUrls?.length?config.rpcUrls:[config.rpcUrl];
  const wallet = backend ? createWalletClient({account: backend, chain, transport: fallback(backendRpcUrls.map(url=>http(url, {retryCount: 0, timeout: 12000})),{retryCount:0,shouldThrow:shouldThrowRpcError})}) : undefined;
  const operations = new Map<string, SpinOperation>(), locks = new Map<string, Promise<unknown>>();
  const welcome = new Map<string, {player: Address; hash?: Hash; nextAttempt: number; checking: boolean; error?: string}>();
  const welcomeHistory = createWelcomeHistory(reader);
  const welcomeViews = new Map<string, WelcomeView>();
  const prizeAvailability = createPrizeAvailability(() => reader.funding());
  let backendQueue = Promise.resolve<unknown>(null), ticking = false, timer: ReturnType<typeof setTimeout> | undefined, stopped = true;
  let pendingBackend: {hash: Hash; raw: Hex; nonce: number} | undefined;
  const health = {configured: !!backend, address: backend?.address || null, lastTick: 0, lastBlock: '0', error: '', canStartFreeSpin: false, balanceWei: '0'};
  function locked<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(action);
    locks.set(key, task); void task.finally(() => {if (locks.get(key) === task) locks.delete(key);}).catch(() => {});
    return task;
  }
  async function flushBackend() {
    if (!pendingBackend) return;
    const sent = pendingBackend;
    const receipt = await client.getTransactionReceipt({hash: sent.hash}).catch(() => null);
    if (receipt) {if (pendingBackend === sent) pendingBackend = undefined; return;}
    const mined = await client.getTransactionCount({address: backend!.address, blockTag: 'latest'});
    if (mined > sent.nonce) {if (pendingBackend === sent) pendingBackend = undefined; return;}
    // Re-broadcast the identical signed transaction: never invent a second nonce after a lost response.
    await client.sendRawTransaction({serializedTransaction: sent.raw}).catch(() => {});
  }
  async function sendBackend(functionName: 'revealRound' | 'expireRound' | 'startFreeSpin' | 'grantFreeSpins' | 'acceptPrizeOwnership', arg: bigint | Address, onHash?: (hash: Hash) => void, assertSession?: () => void | Promise<void>) {
    if (!wallet || !backend) throw new SlotError('KeeperMissing', 'The keeper wallet is not configured yet.', 503);
    const accepting = functionName === 'acceptPrizeOwnership';
    if (accepting && !assertSession) throw new SlotError('Consent', 'Backend ownership acceptance requires explicit admin authorization.', 403);
    const task = backendQueue.catch(() => {}).then(async () => {
      if (accepting) await assertSession!();
      await flushBackend();
      const [pendingNonce, latestNonce] = await Promise.all([client.getTransactionCount({address: backend.address, blockTag: 'pending'}), client.getTransactionCount({address: backend.address, blockTag: 'latest'})]);
      if (pendingBackend || pendingNonce !== latestNonce) throw new SlotError('KeeperBusy', 'The keeper wallet is confirming another operation. Try again shortly.');
      let checked: WelcomeHistory | undefined;
      if (functionName === 'grantFreeSpins') {
        // Read again inside the nonce queue: an earlier eligibility check cannot authorize a send.
        checked = await welcomeHistory.read(arg as Address);
        if (checked.granted) throw new SlotError('WelcomeAlreadyGranted', 'Bonus already credited.');
        if (!checked.complete) throw new SlotError('WelcomeHistorySyncing', 'Checking the bonus history.');
        if (await client.getTransactionCount({address: backend.address, blockNumber: checked.blockNumber}) !== pendingNonce) {
          throw new SlotError('KeeperBusy', 'Checking the previous keeper wallet operation.');
        }
      }
      const to = accepting ? config.prizeCollection || BASE_PRIZE_COLLECTION : config.address;
      if (accepting) {
        const pending = await client.readContract({address:to,abi:prizeCollectionAbi,functionName:'pendingOwner'});
        if (pending.toLowerCase() !== backend.address.toLowerCase()) throw new SlotError('PrizeOwner', 'The backend wallet must be the pending collection owner.', 403);
      }
      const data = functionName === 'acceptPrizeOwnership' ? encodeFunctionData({abi:prizeCollectionAbi,functionName:'acceptOwnership'}) : functionName === 'grantFreeSpins' ? welcomeGrantData(arg as Address) : functionName === 'startFreeSpin'
        ? encodeFunctionData({abi: slotAbi, functionName, args: [arg as Address]}) : encodeFunctionData({abi: slotAbi, functionName, args: [arg as bigint]});
      await client.call({account: backend.address, to, data});
      const prepared = await wallet.prepareTransactionRequest({account: backend, chain, to, data, value: 0n, nonce: pendingNonce});
      const balance = await client.getBalance({address: backend.address, blockTag: 'pending'});
      const fee = prepared.maxFeePerGas ?? prepared.gasPrice ?? 0n;
      if (balance < (prepared.gas || 0n) * fee) throw new SlotError('KeeperGas', 'The keeper wallet does not have enough ETH for this operation.', 503);
      await assertSession?.();
      if (checked) {
        const [pending, latest, anchor] = await Promise.all([
          client.getTransactionCount({address: backend.address, blockTag: 'pending'}),
          client.getTransactionCount({address: backend.address, blockTag: 'latest'}),
          client.getBlock({blockNumber: checked.blockNumber}),
        ]);
        if (pending !== pendingNonce || latest !== pendingNonce || anchor.hash !== checked.blockHash) {
          throw new SlotError('KeeperBusy', 'The keeper wallet state changed. Checking before sending.');
        }
      }
      const raw = await wallet.signTransaction(prepared), hash = keccak256(raw);
      pendingBackend = {hash, raw, nonce: pendingNonce}; onHash?.(hash);
      await client.sendRawTransaction({serializedTransaction: raw}).catch(() => { /* The receipt/identical rebroadcast resolves an ambiguous send. */ });
      return hash;
    });
    backendQueue = task; return task;
  }
  function startEvent(receipt: TransactionReceipt, player: Address) {
    const [event] = parseEventLogs({abi: slotAbi, eventName: 'SpinStarted', logs: receipt.logs.filter(log => log.address.toLowerCase() === config.address.toLowerCase()), strict: true})
      .filter(event => event.args.player.toLowerCase() === player.toLowerCase());
    if (!event) throw new SlotError('MissingSpinEvent', 'The transaction does not contain a spin for this wallet.');
    return event;
  }
  async function reconcile(operation: SpinOperation) {
    if (!operation.hash || operation.stage === 'started' || operation.stage === 'failed') return;
    const receipt = await client.getTransactionReceipt({hash: operation.hash}).catch(() => null);
    if (!receipt) return;
    if (receipt.status === 'reverted') {operation.stage = 'failed'; operation.error = 'Transaction reverted by the contract. No spin opened.'; return;}
    try {const id=startEvent(receipt, operation.player).args.gameId;reader.rememberGame(operation.player,id);operation.gameId = id.toString(); operation.stage = 'started'; operation.error = undefined;prizeAvailability.invalidate();}
    catch (error) {operation.stage = 'failed'; operation.error = slotError(error).message;}
  }
  async function start(player: Address, afterGameId: bigint, mode: 'paid' | 'free', options: {
    assertSession: () => void; sendPaid?: (key: string) => Promise<SubmittedSpin>; resolvePaid?: (submission: SubmittedSpin) => Promise<Hash | undefined>; maxPrice?: bigint;
  }) {
    const key = keccak256(toHex(`${config.chainId}:${config.address.toLowerCase()}:${player.toLowerCase()}:${afterGameId}`));
    return locked(player.toLowerCase(), async () => {
      options.assertSession(); await reader.validate();
      const existing = operations.get(key);
      if (existing && existing.stage !== 'failed' && !(existing.stage === 'uncertain' && !existing.hash)) {await reconcile(existing); return {...existing};}
      const leaseId = 'spin:' + key;
      // Retain the operation even if bounded history evicts its map entry.
      let tracked:SpinOperation|undefined = existing;
      await writes.acquire(player.toLowerCase(), leaseId, async () => {
        const op = tracked;
        if (!op) return false;
        await reconcile(op);
        if (op.stage === 'failed') return true;
        if (op.stage !== 'started') return false;
        return !(await reader.walletState(player)).busy;
      });
      try {
        const state = await reader.playPlayer(player);
        if (state.gameUnavailable) throw new SlotError('GameUnavailable', 'Checking the current round. Wait before starting.',503);
        if (afterGameId > state.latestGameId) throw new SlotError('StaleGame', 'Refresh the session before starting.');
        if (state.game?.pending || state.latestGameId !== afterGameId) {
          writes.release(player.toLowerCase(), leaseId);
          return {key, attempt: 0, player, afterGameId: afterGameId.toString(), stage: 'started' as const, gameId: state.latestGameId.toString()};
        }
        if(state.busy)throw new SlotError('GamePending','Waiting for the current round to confirm.');
        const settings = await reader.settings();
        if (settings.paused) throw new SlotError('Paused', 'The machine is paused.');
        if (settings.totalOutcomeWeight !== 1000 || settings.configuredPrizeCount < 3) throw new SlotError('Paytable', 'The prize table is not ready.');
        const funding = await reader.funding();
        prizeAvailability.record(funding.ready);
        if (!funding.ready) throw new SlotError('InsufficientPrizeInventory', 'The slot needs a prize refill. Your balance and free spins stay available.');
        if (!backend || !health.configured) throw new SlotError('KeeperMissing', 'The reveal service is not configured yet.', 503);
        if (!health.lastTick || Date.now() - health.lastTick > 30000 || health.balanceWei === '0' || health.error) throw new SlotError('KeeperNotReady', 'The reveal service must be online and hold ETH for gas.', 503);
        if (mode === 'free') {
          if (!state.freeSpins) throw new SlotError('NoFreeSpins', 'No free spins available.');
          const permissions = await reader.roles(backend.address);
          if (!permissions.manager) throw new SlotError('KeeperRole', 'Grant GAME_MANAGER_ROLE to the keeper wallet to use free spins.', 503);
        } else {
          if (!options.sendPaid) throw new SlotError('ConsentRequired', 'Approve spins from your phone.');
          if (options.maxPrice === undefined || settings.ticketPrice > options.maxPrice) throw new SlotError('BudgetExceeded', 'The approved budget is not enough for this spin.');
          if (state.allowance < settings.ticketPrice) throw new SlotError('Allowance', 'Approve a USDC budget from your phone.');
          if (state.balance < settings.ticketPrice) throw new SlotError('Balance', 'Insufficient USDC balance.');
          await client.simulateContract({...contract, account: player, functionName: 'startSpin', gasPrice: 0n});
        }
        options.assertSession();
        const operation: SpinOperation = {key, attempt: existing?.stage === 'failed' ? existing.attempt + 1 : existing?.attempt || 0, player, afterGameId: afterGameId.toString(), stage: 'submitting'};
        if (operations.size >= 512) {
          const old = [...operations.entries()].find(([, value]) => value.stage === 'started' || value.stage === 'failed');
          if (!old) throw new SlotError('Busy', 'Too many requests awaiting confirmation. Try again shortly.', 503);
          operations.delete(old[0]);
        }
        tracked = operation;
        operations.set(key, operation);
        // Keep HTTP short while wallet signing and mining continue. Polling is read-only.
        void (async () => {
          try {
            options.assertSession();
            if (mode === 'free') operation.hash = await sendBackend('startFreeSpin', player, hash => {operation.hash = hash; operation.stage = 'confirming';}, options.assertSession);
            else {
              const submission = await options.sendPaid!(`${key}:${operation.attempt}`);
              operation.gasToken = submission.gasToken; operation.transactionId = submission.transactionId;
              operation.hash = submission.hash;
              if (!operation.hash && options.resolvePaid) {
                for (let attempt = 0; attempt < 90 && !operation.hash; attempt++) {
                  operation.hash = await options.resolvePaid(submission);
                  if (!operation.hash) await new Promise(resolve => setTimeout(resolve, 2000));
                }
              }
              if (!operation.hash) throw new SlotError('TransactionPending', 'Privy is still processing the transaction. Do not start a second request.');
            }
            operation.stage = 'confirming';
            await client.waitForTransactionReceipt({hash: operation.hash, confirmations: 1, timeout: 180000});
            await reconcile(operation);
          } catch (error) {
            // Errors after broadcast are never presented as permission to send another spin.
            const rejected = operation.hash || operation.transactionId ? error instanceof SlotError && error.code === 'TransactionFailed' : definiteSendFailure(error);
            operation.stage = !rejected && (operation.hash || mode === 'paid') ? 'uncertain' : 'failed';
            operation.error = mode === 'paid' ? transactionError(error) : slotError(error).message;
            if (slotError(error).code === 'InsufficientPrizeInventory') prizeAvailability.record(false);
            logSpinFailure('slot.spin_submission_failed',player,mode,operation.afterGameId,error,operation.stage);
          }
        })();
        return {...operation};
      } catch (error) {writes.release(player.toLowerCase(), leaseId);throw error;}
    });
  }
  async function walletView(player: Address) {
    const state = await reader.walletState(player);
    const pending = [...operations.values()].filter(op => op.player.toLowerCase() === player.toLowerCase() && !['started','failed'].includes(op.stage));
    for (const op of pending) await reconcile(op);
    return serializable({...state,busy:state.busy || pending.some(op => !['started','failed'].includes(op.stage))});
  }
  async function playerView(player: Address, blockNumber?:bigint) {
    // Reconcile submissions before selecting the round: it can have settled before
    // the first browser poll. The ID comes from the verified SpinStarted receipt.
    for(const op of operations.values())if(op.player.toLowerCase()===player.toLowerCase()&&op.stage!=='started'&&op.stage!=='failed')await reconcile(op);
    const state = await reader.playPlayer(player,blockNumber);
    const operation = [...operations.values()].reverse().find(op => op.player.toLowerCase() === player.toLowerCase() &&
      (!state.latestGameId || op.afterGameId === state.latestGameId.toString() || op.gameId === state.latestGameId.toString()));
    const bonus = welcome.get(player.toLowerCase());
    return serializable({...state, operation: operation || null,
      welcome: bonus ? {status: bonus.checking ? 'checking' : 'pending', amount: '2', error: bonus.error} : welcomeViews.get(player.toLowerCase()) || null});
  }
  async function playView(player:Address) {
    const block=await client.getBlockNumber({cacheTime:0});
    const [settings,state]=await Promise.all([reader.settings(block),playerView(player,block)]);
    return serializable({configured:true,address:config.address,chainId:config.chainId,paymentToken:config.paymentToken,
      gasMode:config.gasMode,block,settings,player:state,keeper:health,prizeAvailability:prizeAvailability.view()});
  }
  async function queueWelcome(player: Address): Promise<WelcomeView> {
    return locked(`welcome:${player.toLowerCase()}`, async () => {
      await reader.validate();
      const history = await welcomeHistory.read(player);
      if (history.granted) {
        welcomeViews.set(player.toLowerCase(),{status:'granted',amount:'2'});
        welcome.delete(player.toLowerCase()); return {status: 'granted', amount: '2'};
      }
      if (!backend) return {status: 'unavailable', amount: '2', error: 'The bonus will be credited once the service is ready.'};
      const existing = welcome.get(player.toLowerCase());
      if (!existing) {
        if (welcome.size >= 256) throw new SlotError('Busy', 'Too many pending bonuses. Try again shortly.', 503);
        welcome.set(player.toLowerCase(), {player, nextAttempt: 0, checking: !history.complete});
      }
      return {status: history.complete ? 'pending' : 'checking', amount: '2', error: existing?.error};
    });
  }
  async function processWelcome() {
    const entry = [...welcome.values()].find(item => item.nextAttempt <= Date.now());
    if (!entry) return;
    entry.nextAttempt = Date.now() + 10000;
    try {
      if (entry.hash) {
        if ((await welcomeHistory.read(entry.player)).granted) {welcomeViews.set(entry.player.toLowerCase(),{status:'granted',amount:'2'});welcome.delete(entry.player.toLowerCase()); return;}
        const receipt = await client.getTransactionReceipt({hash: entry.hash}).catch(() => null);
        // An unknown submission never permits another nonce. A confirmed revert can be retried.
        if (!receipt || receipt.status === 'success') return;
        entry.hash = undefined;
      }
      await sendBackend('grantFreeSpins', entry.player, hash => {entry.hash = hash; entry.checking = false; entry.nextAttempt=Date.now()+1000;});
      entry.error = undefined;
    } catch (error) {
      if (error instanceof SlotError && error.code === 'WelcomeAlreadyGranted') {welcomeViews.set(entry.player.toLowerCase(),{status:'granted',amount:'2'});welcome.delete(entry.player.toLowerCase()); return;}
      entry.checking = error instanceof SlotError && error.code === 'WelcomeHistorySyncing';
      entry.error = 'The welcome bonus is pending. We retry automatically.';
    }
  }
  async function tick() {
    if (ticking || !backend) return;
    ticking = true;
    try {
      await reader.validate(); await flushBackend();
      const block = await client.getBlockNumber({cacheTime: 0});
      health.lastTick = Date.now(); health.lastBlock = block.toString();
      const [ids, permissions, balance] = await Promise.all([reader.activeGames(block), reader.roles(backend.address, block), client.getBalance({address: backend.address, blockNumber: block})]);
      health.balanceWei = balance.toString();
      health.canStartFreeSpin = permissions.manager;
      const rounds = await Promise.all(ids.map(async id => ({id, game: await client.readContract({...contract, functionName: 'getGame', args: [id], blockNumber: block})})));
      rounds.sort((a, b) => a.game.revealDeadline < b.game.revealDeadline ? -1 : 1);
      health.error = '';
      for (const round of rounds) {
        reader.rememberGame(round.game.player,round.id);
        if (!round.game.pending || block <= round.game.targetBlock) continue;
        const method = block > round.game.revealDeadline ? 'expireRound' : 'revealRound';
        try {await sendBackend(method, round.id,hash=>{if(method==='revealRound')reader.rememberReveal(round.id,hash);});}
        catch (error) {const safe = slotError(error); if (safe.code !== 'KeeperBusy' && safe.code !== 'NoPendingRound') health.error = safe.message;}
        // One transaction at a time, sharing the nonce stream with free spins.
        if (pendingBackend) break;
      }
      // Reveals have priority; welcome grants share the keeper's serialized nonce stream.
      if (!pendingBackend) await processWelcome();
    } catch (error) {health.error = slotError(error).message;}
    finally {ticking = false;}
  }
  function startKeeper() {
    if (!stopped || !backend) return;
    stopped = false;
    async function loop() {await tick(); if (!stopped) {timer = setTimeout(loop, 1000); timer.unref();}}
    void loop();
  }
  return {reader, start, playerView, playView, walletView, tick, startKeeper, sendBackend, queueWelcome,
    health: () => ({...health, pendingTransaction: pendingBackend?.hash || null}),
    stop() {stopped = true; if (timer) clearTimeout(timer);},
  };
}
export type SlotEngine = ReturnType<typeof createSlotEngine>;
