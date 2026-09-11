import {createPublicClient, formatUnits, defineChain, http, erc20Abi, keccak256, toHex, zeroAddress, type Address, type Hash} from 'viem';
import {slotAbi} from './abi';
import {GAME_STATES, serializable, type SlotConfig} from './config';
import {SlotError} from './errors';
const PAGE_BLOCKS = 2000n;
const roleNames = ['GAME_MANAGER_ROLE', 'TREASURER_ROLE', 'PAUSER_ROLE'] as const;
export function createSlotReader(config: SlotConfig) {
  const chain = defineChain({id: config.chainId, name: config.chainId === 8453 ? 'Base' : 'Local test',
    nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: [config.rpcUrl]}}});
  const client = createPublicClient({chain, transport: http(config.rpcUrl, {batch: true, timeout: 12000, retryCount: 1})});
  const contract = {address: config.address, abi: slotAbi};
  let checkedAt = 0;
  const tokenInfo = new Map<string, {symbol: string; decimals: number}>();
  async function tokenMetadata(token: Address) {
    const cached = tokenInfo.get(token.toLowerCase()); if (cached) return cached;
    try {
      const [symbol, decimals] = await Promise.all([client.readContract({address: token, abi: erc20Abi, functionName: 'symbol'}), client.readContract({address: token, abi: erc20Abi, functionName: 'decimals'})]);
      const value = {symbol: symbol.slice(0, 32), decimals}; tokenInfo.set(token.toLowerCase(), value); return value;
    } catch {return null;}
  }
  const latest = new Map<string, {id: bigint; block: bigint; hash: Hash; checked: bigint}>();
  const scans = new Map<string, {head: bigint; cursor: bigint}>();
  async function validate() {
    if (Date.now() - checkedAt < 5000) return;
    const [chainId, code, token] = await Promise.all([client.getChainId(), client.getCode({address: config.address}),
      client.readContract({...contract, functionName: 'paymentToken'})]);
    if (chainId !== config.chainId || !code || code === '0x' || token.toLowerCase() !== config.paymentToken.toLowerCase()) {
      throw new SlotError('WrongDeployment', 'Contratto, rete o token di pagamento non corrispondono alla configurazione.', 503);
    }
    checkedAt = Date.now();
  }
  async function settings(blockNumber?: bigint) {await validate(); return client.readContract({...contract, functionName: 'getContractSettings', blockNumber});}
  async function catalog(blockNumber?: bigint) {
    const [symbols, prizes] = await client.readContract({...contract, functionName: 'getPrizeCatalog', blockNumber});
    return symbols.map((symbol, index) => ({symbol, ...prizes[index]}));
  }
  async function roles(player: Address, blockNumber?: bigint) {
    const [owner, ...granted] = await Promise.all([client.readContract({...contract, functionName: 'owner', blockNumber}),
      ...roleNames.map(name => client.readContract({...contract, functionName: 'hasRole', args: [keccak256(toHex(name)), player], blockNumber}))]);
    const isOwner = String(owner).toLowerCase() === player.toLowerCase();
    return {owner: String(owner) as Address, isOwner, manager: isOwner || !!granted[0], treasurer: isOwner || !!granted[1], pauser: isOwner || !!granted[2]};
  }
  async function lastGame(player: Address, block: bigint): Promise<{id: bigint; complete: boolean}> {
    const key = player.toLowerCase(), cached = latest.get(key);
    if (cached && cached.checked <= block) {
      const source = await client.getBlock({blockNumber: cached.block});
      if (source.hash === cached.hash) {
        let cursor = cached.checked > 12n ? cached.checked - 12n : 0n;
        if (cursor < config.deploymentBlock) cursor = config.deploymentBlock;
        const end = cursor + PAGE_BLOCKS * 12n - 1n < block ? cursor + PAGE_BLOCKS * 12n - 1n : block;
        let found = cached;
        for (; cursor <= end; cursor += PAGE_BLOCKS) {
          const toBlock = cursor + PAGE_BLOCKS - 1n < end ? cursor + PAGE_BLOCKS - 1n : end;
          const events = await client.getContractEvents({...contract, eventName: 'SpinStarted', args: {player}, fromBlock: cursor, toBlock, strict: true});
          for (const event of events) if (event.args.gameId >= found.id) found = {id: event.args.gameId, block: event.blockNumber, hash: event.blockHash, checked: block};
        }
        latest.set(key, {...found, checked: end}); return {id: found.id, complete: end === block};
      }
      latest.delete(key);
    }
    const scan = {...(scans.get(key) || {head: block, cursor: block})};
    // Bound each request; resume from chain on subsequent polls without a database.
    for (let page = 0; page < 12 && scan.cursor >= config.deploymentBlock; page++) {
      const fromBlock = scan.cursor - PAGE_BLOCKS + 1n > config.deploymentBlock ? scan.cursor - PAGE_BLOCKS + 1n : config.deploymentBlock;
      const events = await client.getContractEvents({...contract, eventName: 'SpinStarted', args: {player}, fromBlock, toBlock: scan.cursor, strict: true});
      const found = events[events.length - 1];
      if (found) {
        if (latest.size >= 512) latest.delete(latest.keys().next().value!);
        latest.set(key, {id: found.args.gameId, block: found.blockNumber, hash: found.blockHash, checked: scan.head}); scans.delete(key);
        return lastGame(player, block);
      }
      if (fromBlock === config.deploymentBlock) {
        scans.delete(key);
        const source = await client.getBlock({blockNumber: config.deploymentBlock});
        if (latest.size >= 512) latest.delete(latest.keys().next().value!);
        latest.set(key, {id: 0n, block: config.deploymentBlock, hash: source.hash, checked: scan.head});
        return lastGame(player, block);
      }
      scan.cursor = fromBlock - 1n;
    }
    if (scans.size >= 512) scans.delete(scans.keys().next().value!);
    scans.set(key, scan); return {id: 0n, complete: false};
  }
  async function game(id: bigint, blockNumber?: bigint) {
    const block = blockNumber ?? await client.getBlockNumber({cacheTime: 0});
    const [raw, status] = await Promise.all([client.readContract({...contract, functionName: 'getGame', args: [id], blockNumber: block}),
      client.readContract({...contract, functionName: 'getGameStatus', args: [id], blockNumber: block})]);
    let payout: {kind: number; token: Address; tokenId: bigint; amount: bigint; transactionHash: Hash; blockNumber: bigint} | null = null;
    let resultBlock: bigint | null = null, transactionHash: Hash | null = null;
    if (raw.hasResult) {
      const end = block < raw.revealDeadline ? block : raw.revealDeadline;
      const [reveals, prizes] = await Promise.all([
        client.getContractEvents({...contract, eventName: 'RoundRevealed', args: {gameId: id}, fromBlock: raw.targetBlock + 1n, toBlock: end, strict: true}),
        raw.won ? client.getContractEvents({...contract, eventName: 'PrizePaid', args: {gameId: id}, fromBlock: raw.targetBlock + 1n, toBlock: end, strict: true}) : Promise.resolve([]),
      ]);
      const reveal = reveals[0], prize = prizes[0];
      if (reveal) {resultBlock = reveal.blockNumber; transactionHash = reveal.transactionHash;}
      if (prize) payout = {kind: prize.args.kind, token: prize.args.token, tokenId: prize.args.tokenId, amount: prize.args.amount, transactionHash: prize.transactionHash, blockNumber: prize.blockNumber};
    }
    const confirmed = resultBlock !== null && block - resultBlock + 1n >= BigInt(config.confirmations);
    const metadata = payout?.kind === 1 ? await tokenMetadata(payout.token) : null;
    const paid = payout ? {...payout, formattedAmount: metadata ? formatUnits(payout.amount, metadata.decimals) : payout.amount.toString(), tokenSymbol: metadata?.symbol || null, decimals: metadata?.decimals ?? null} : null;
    return {id, ...raw, status: GAME_STATES[status], confirmed, resultBlock, transactionHash, payout: paid};
  }
  async function player(address: Address, blockNumber?: bigint) {
    const block = blockNumber ?? await client.getBlockNumber({cacheTime: 0});
    const [[freeSpins, activeGameId], allowance, balance] = await Promise.all([
      client.readContract({...contract, functionName: 'getPlayerState', args: [address], blockNumber: block}),
      client.readContract({address: config.paymentToken, abi: erc20Abi, functionName: 'allowance', args: [address, config.address], blockNumber: block}),
      client.readContract({address: config.paymentToken, abi: erc20Abi, functionName: 'balanceOf', args: [address], blockNumber: block}),
    ]);
    const last = activeGameId ? {id: activeGameId, complete: true} : await lastGame(address, block);
    return {address, freeSpins, allowance, balance, historyReady: last.complete, latestGameId: last.id,
      game: last.id ? await game(last.id, block) : null};
  }
  async function activeGames(blockNumber?: bigint) {
    const block = blockNumber ?? await client.getBlockNumber({cacheTime: 0}), ids: bigint[] = [];
    let offset = 0n, total = 1n;
    while (offset < total) {
      const [page, count] = await client.readContract({...contract, functionName: 'getActiveGameIds', args: [offset, 100n], blockNumber: block});
      ids.push(...page); total = count; offset += 100n;
    }
    return ids;
  }
  async function history(before?: bigint) {
    const block = await client.getBlockNumber({cacheTime: 0}), config = await settings(block);
    const end = before && before < config.nextGameId ? before : config.nextGameId;
    const ids = Array.from({length: Number(end > 20n ? 20n : end - 1n)}, (_, index) => end - 1n - BigInt(index));
    return {games: await Promise.all(ids.map(id => game(id, block))), next: ids.length ? ids[ids.length - 1] : 0n};
  }
  async function snapshot(address?: Address, admin = false) {
    const block = await client.getBlockNumber({cacheTime: 0});
    const [values, prizes, permissions, state] = await Promise.all([settings(block), catalog(block), address ? roles(address, block) : null, address ? player(address, block) : null]);
    const inventory = admin ? await Promise.all(prizes.filter(prize => prize.kind === 1 || prize.kind === 2).map(async prize => {
      const [balance, reserved, available] = prize.kind === 1
        ? await client.readContract({...contract, functionName: 'getERC20Inventory', args: [prize.token], blockNumber: block})
        : await client.readContract({...contract, functionName: 'getERC1155Inventory', args: [prize.token, prize.tokenId], blockNumber: block});
      return {symbol: prize.symbol, token: prize.token, tokenId: prize.tokenId, kind: prize.kind, balance, reserved, available};
    })) : [];
    const pendingOwner = admin ? await client.readContract({...contract, functionName: 'pendingDefaultAdmin', blockNumber: block}) : null;
    return serializable({configured: true as const, address: config.address, chainId: config.chainId, paymentToken: config.paymentToken,
      gasMode: config.gasMode, confirmations: config.confirmations, block, settings: values, catalog: prizes, permissions, player: state, inventory,
      pendingOwner: pendingOwner ? {address: pendingOwner[0], schedule: pendingOwner[1]} : null});
  }
  return {config, chain, client, contract, validate, settings, catalog, roles, lastGame, player, game, activeGames, history, snapshot};
}
export type SlotReader = ReturnType<typeof createSlotReader>;
export type SlotSnapshot = Awaited<ReturnType<SlotReader['snapshot']>>;
export type GameView = NonNullable<NonNullable<SlotSnapshot['player']>['game']>;
