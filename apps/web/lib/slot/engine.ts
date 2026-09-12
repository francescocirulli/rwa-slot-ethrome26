import {createWalletClient, http, encodeFunctionData, parseEventLogs, keccak256, toHex, type Address, type Hash, type Hex, type TransactionReceipt} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import type {SlotReader} from './reader';
import {serializable} from './config';
import {SlotError, slotError} from './errors';
import {slotAbi} from './abi';
import {definiteSendFailure, transactionError, type GasToken} from './gas';
import type {WelcomeView} from '../welcome';
export type SubmittedSpin = {hash?: Hash; transactionId?: string; userOperationHash?:Hash; gasToken?: GasToken};
export type SpinOperation = {key: string; attempt: number; player: Address; afterGameId: string; stage: 'submitting' | 'confirming' | 'started' | 'failed' | 'uncertain'; hash?: Hash; gameId?: string; error?: string; gasToken?: GasToken; transactionId?: string};
export function createSlotEngine(reader: SlotReader, backendKey?: Hex) {
  const {client, config, chain, contract} = reader;
  const backend = backendKey ? privateKeyToAccount(backendKey) : undefined;
  const wallet = backend ? createWalletClient({account: backend, chain, transport: http(config.rpcUrl, {retryCount: 0, timeout: 12000})}) : undefined;
  const operations = new Map<string, SpinOperation>(), locks = new Map<string, Promise<unknown>>();
  const welcome = new Map<string, {player: Address; hash?: Hash; nextAttempt: number; error?: string}>();
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
  async function sendBackend(functionName: 'revealRound' | 'expireRound' | 'startFreeSpin' | 'grantWelcomeFreeSpins', arg: bigint | Address, onHash?: (hash: Hash) => void, assertSession?: () => void) {
    if (!wallet || !backend) throw new SlotError('KeeperMissing', 'Il wallet backend non è ancora configurato.', 503);
    const task = backendQueue.catch(() => {}).then(async () => {
      await flushBackend();
      const [pendingNonce, latestNonce] = await Promise.all([client.getTransactionCount({address: backend.address, blockTag: 'pending'}), client.getTransactionCount({address: backend.address, blockTag: 'latest'})]);
      if (pendingBackend || pendingNonce !== latestNonce) throw new SlotError('KeeperBusy', 'Il wallet backend sta confermando un’altra operazione. Riprova tra poco.');
      const data = functionName === 'startFreeSpin' || functionName === 'grantWelcomeFreeSpins' ? encodeFunctionData({abi: slotAbi, functionName, args: [arg as Address]}) : encodeFunctionData({abi: slotAbi, functionName, args: [arg as bigint]});
      await client.call({account: backend.address, to: config.address, data});
      const prepared = await wallet.prepareTransactionRequest({account: backend, chain, to: config.address, data, value: 0n, nonce: pendingNonce});
      const balance = await client.getBalance({address: backend.address, blockTag: 'pending'});
      const fee = prepared.maxFeePerGas ?? prepared.gasPrice ?? 0n;
      if (balance < (prepared.gas || 0n) * fee) throw new SlotError('KeeperGas', 'Il wallet backend non ha ETH sufficiente per questa operazione.', 503);
      assertSession?.();
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
    if (!event) throw new SlotError('MissingSpinEvent', 'La transazione non contiene una giocata per questo wallet.');
    return event;
  }
  async function reconcile(operation: SpinOperation) {
    if (!operation.hash || operation.stage === 'started' || operation.stage === 'failed') return;
    const receipt = await client.getTransactionReceipt({hash: operation.hash}).catch(() => null);
    if (!receipt) return;
    if (receipt.status === 'reverted') {operation.stage = 'failed'; operation.error = 'Transazione annullata dal contratto. Nessuna giocata aperta.'; return;}
    try {operation.gameId = startEvent(receipt, operation.player).args.gameId.toString(); operation.stage = 'started'; operation.error = undefined;}
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
      const state = await reader.player(player);
      if (!state.historyReady) throw new SlotError('HistorySyncing', 'Recuperiamo lo storico onchain. Attendi prima di iniziare.');
      if (afterGameId > state.latestGameId) throw new SlotError('StaleGame', 'Aggiorna la sessione prima di iniziare.');
      if (state.game?.pending || state.latestGameId !== afterGameId) {
        return {key, attempt: 0, player, afterGameId: afterGameId.toString(), stage: 'started' as const, gameId: state.latestGameId.toString()};
      }
      const settings = await reader.settings();
      if (settings.paused) throw new SlotError('Paused', 'La macchina è in pausa.');
      if (settings.totalOutcomeWeight !== 1000 || settings.configuredPrizeCount < 3) throw new SlotError('Paytable', 'La tabella premi non è pronta.');
      if (!(await reader.funding()).ready) throw new SlotError('InsufficientPrizeInventory', 'La slot sta rifornendo i premi. Attendi prima di giocare: il tuo saldo e i free spin restano disponibili.');
      if (!backend || !health.configured) throw new SlotError('KeeperMissing', 'Il servizio di reveal non è ancora configurato.', 503);
      if (!health.lastTick || Date.now() - health.lastTick > 30000 || health.balanceWei === '0' || health.error) throw new SlotError('KeeperNotReady', 'Il servizio di reveal deve essere online e avere ETH per il gas.', 503);
      if (mode === 'free') {
        if (!state.freeSpins) throw new SlotError('NoFreeSpins', 'Non ci sono free spin disponibili.');
        const permissions = await reader.roles(backend.address);
        if (!permissions.manager) throw new SlotError('KeeperRole', 'Assegna GAME_MANAGER_ROLE al wallet backend per utilizzare i free spin.', 503);
      } else {
        if (!options.sendPaid) throw new SlotError('ConsentRequired', 'Autorizza le giocate dal telefono.');
        if (options.maxPrice === undefined || settings.ticketPrice > options.maxPrice) throw new SlotError('BudgetExceeded', 'Il budget autorizzato non basta per questa giocata.');
        if (state.allowance < settings.ticketPrice) throw new SlotError('Allowance', 'Autorizza un budget USDC dal telefono.');
        if (state.balance < settings.ticketPrice) throw new SlotError('Balance', 'Saldo USDC insufficiente.');
        await client.simulateContract({...contract, account: player, functionName: 'startSpin', gasPrice: 0n});
      }
      options.assertSession();
      const operation: SpinOperation = {key, attempt: existing?.stage === 'failed' ? existing.attempt + 1 : existing?.attempt || 0, player, afterGameId: afterGameId.toString(), stage: 'submitting'};
      if (operations.size >= 512) {
        const old = [...operations.entries()].find(([, value]) => value.stage === 'started' || value.stage === 'failed');
        if (!old) throw new SlotError('Busy', 'Troppe richieste in conferma. Riprova tra poco.', 503);
        operations.delete(old[0]);
      }
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
            if (!operation.hash) throw new SlotError('TransactionPending', 'Privy sta ancora elaborando la transazione. Non avviare una seconda richiesta.');
          }
          operation.stage = 'confirming';
          await client.waitForTransactionReceipt({hash: operation.hash, confirmations: 1, timeout: 180000});
          await reconcile(operation);
        } catch (error) {
          // Errors after broadcast are never presented as permission to send another spin.
          const rejected = operation.hash || operation.transactionId ? error instanceof SlotError && error.code === 'TransactionFailed' : definiteSendFailure(error);
          operation.stage = !rejected && (operation.hash || mode === 'paid') ? 'uncertain' : 'failed';
          operation.error = mode === 'paid' ? transactionError(error) : slotError(error).message;
        }
      })();
      return {...operation};
    });
  }
  async function playerView(player: Address) {
    const state = await reader.player(player);
    const operation = [...operations.values()].reverse().find(op => op.player.toLowerCase() === player.toLowerCase() &&
      (!state.latestGameId || op.afterGameId === state.latestGameId.toString() || op.gameId === state.latestGameId.toString()));
    if (operation) await reconcile(operation);
    const bonus = welcome.get(player.toLowerCase());
    return serializable({...state, operation: operation || null,
      welcome: state.welcomeFreeSpinsGranted === null ? {status: 'unsupported', amount: '2'} : state.welcomeFreeSpinsGranted ? {status: 'granted', amount: '2'} : bonus ? {status: 'pending', amount: '2', error: bonus.error} : null});
  }
  async function queueWelcome(player: Address): Promise<WelcomeView> {
    return locked(`welcome:${player.toLowerCase()}`, async () => {
      await reader.validate();
      const granted = await reader.welcomeGranted(player);
      if (granted === null) return {status: 'unsupported', amount: '2'};
      if (granted) {
        welcome.delete(player.toLowerCase()); return {status: 'granted', amount: '2'};
      }
      if (!backend) return {status: 'unavailable', amount: '2', error: 'Il bonus sarà accreditato quando il servizio sarà pronto.'};
      const existing = welcome.get(player.toLowerCase());
      if (!existing) {
        if (welcome.size >= 256) throw new SlotError('Busy', 'Troppi bonus in attesa. Riprova tra poco.', 503);
        welcome.set(player.toLowerCase(), {player, nextAttempt: 0});
      }
      return {status: 'pending', amount: '2', error: existing?.error};
    });
  }
  async function processWelcome() {
    const entry = [...welcome.values()].find(item => item.nextAttempt <= Date.now());
    if (!entry) return;
    entry.nextAttempt = Date.now() + 10000;
    try {
      if (await client.readContract({...contract, functionName: 'welcomeFreeSpinsGranted', args: [entry.player]})) {
        welcome.delete(entry.player.toLowerCase()); return;
      }
      if (entry.hash) {
        const receipt = await client.getTransactionReceipt({hash: entry.hash}).catch(() => null);
        // An unknown submission never permits another nonce. A confirmed revert can be retried.
        if (!receipt || receipt.status === 'success') return;
        entry.hash = undefined;
      }
      await sendBackend('grantWelcomeFreeSpins', entry.player, hash => {entry.hash = hash;});
      entry.error = undefined;
    } catch {
      entry.error = 'Il bonus di benvenuto è in attesa. Riproviamo automaticamente.';
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
        if (!round.game.pending || block <= round.game.targetBlock) continue;
        const method = block > round.game.revealDeadline ? 'expireRound' : 'revealRound';
        try {await sendBackend(method, round.id);}
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
  return {reader, start, playerView, tick, startKeeper, sendBackend, queueWelcome,
    health: () => ({...health, pendingTransaction: pendingBackend?.hash || null}),
    stop() {stopped = true; if (timer) clearTimeout(timer);},
  };
}
export type SlotEngine = ReturnType<typeof createSlotEngine>;
