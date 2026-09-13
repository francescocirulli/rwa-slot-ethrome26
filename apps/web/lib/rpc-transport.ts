import {createTransport, http, type Transport, type EIP1193RequestFn} from 'viem';
import {shouldThrowRpcError} from './rpc-fallback';

// Only reads and identical signed broadcasts may move to another provider.
// In particular, never retry a wallet signing/sending request after a lost reply.
const readMethods = new Set([
  'eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
  'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getBalance', 'eth_getCode',
  'eth_getStorageAt', 'eth_getTransactionCount', 'eth_getTransactionByHash',
  'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_getLogs', 'eth_getProof', 'net_version', 'net_listening',
]);
type Endpoint = {retryAt: number; failures: number; generation: number};
type Lane = {endpoints: Endpoint[]; recoveryAt: number};
type Pool = {live: Lane; history: Lane; pending: Map<string, Promise<unknown>>};
const pools = new Map<string, Pool>();

function unavailable(error: unknown) {
  // Inspect causes without logging endpoint URLs, request bodies or credentials.
  let cause = error;
  for (let depth = 0; cause && typeof cause === 'object' && depth < 8; depth++) {
    const item = cause as {name?: string; code?: number; details?: string; message?: string; cause?: unknown};
    if (item.name === 'HttpRequestError' || item.name === 'TimeoutError' || item.code === -32005 ||
        /(?:request|rate) limit|quota|too many requests/i.test(item.details || item.message || '')) return true;
    cause = item.cause;
  }
  return false;
}

// A pool is shared by slot polling, balances/inventory and keeper preparation.
// Cooldowns use actual failures, without background health pings consuming quota.
export function rpcTransport(urls: string[], options: {timeout?: number; now?: () => number; isolated?: boolean} = {}): Transport {
  const endpoints = [...new Set(urls.map(url => url.trim()).filter(Boolean))];
  if (!endpoints.length) throw new Error('Configure at least one RPC endpoint.');
  const key = JSON.stringify(endpoints);
  let pool = options.isolated ? undefined : pools.get(key);
  if (!pool) {
    const lane = (): Lane => ({endpoints: endpoints.map(() => ({retryAt: 0, failures: 0, generation: 0})), recoveryAt: 0});
    pool = {live: lane(), history: lane(), pending: new Map()};
    if (!options.isolated) {
      if (pools.size >= 32) pools.delete(pools.keys().next().value!);
      pools.set(key, pool);
    }
  }
  const shared = pool, now = options.now || Date.now;
  return args => {
    const transports = endpoints.map(url => http(url, {
      batch: {wait: 10, batchSize: 20}, timeout: options.timeout ?? 4000, retryCount: 0,
    })(args));
    // viem batches by URL across clients. Keep logs outside those HTTP batches,
    // otherwise one slow scan holds up every live read in the same response.
    const historyTransports = endpoints.map(url => http(url, {
      batch: false, timeout: options.timeout ?? 4000, retryCount: 0,
    })(args));
    return createTransport({key: 'resilientRpc', name: 'Resilient RPC', type: 'resilientRpc', retryCount: 0,
      request: (async (request: Parameters<EIP1193RequestFn>[0]) => {
        const read = readMethods.has(request.method);
        const canRetry = read || request.method === 'eth_sendRawTransaction';
        const requestKey = read ? JSON.stringify(request) : undefined;
        const pending = requestKey && shared.pending.get(requestKey);
        if (pending) return pending;
        const run = async () => {
          // A slow/rejected history query must not quarantine healthy balance,
          // allowance or live-round reads on the same node.
          const kind = request.method === 'eth_getLogs' ? 'history' : 'live';
          const lane = shared[kind];
          const routes = kind === 'history' ? historyTransports : transports;
          let probe = -1;
          if (read && kind === 'live' && lane.endpoints.every(endpoint => endpoint.retryAt > now()) && lane.recoveryAt <= now()) {
            // After a total outage, permit one real read every five seconds.
            // Other callers keep failing closed; no cached state authorizes writes.
            probe = lane.endpoints.reduce((best, endpoint, index) => endpoint.retryAt < lane.endpoints[best].retryAt ? index : best, 0);
            lane.recoveryAt = now() + 5000;
          }
          let lastError: unknown = new Error('RPC providers are temporarily unavailable.');
          for (let index = 0; index < routes.length; index++) {
            const health = lane.endpoints[index];
            if (health.retryAt > now() && index !== probe) continue;
            const generation = health.generation;
            try {
              const result = await routes[index].request(request);
              // An older concurrent success cannot erase a newer failure.
              if (health.generation === generation) {health.failures = 0; health.retryAt = 0;}
              return result;
            } catch (error) {
              if (unavailable(error) && health.generation === generation) {
                health.generation++;
                health.retryAt = now() + Math.min(300000, 30000 * 2 ** Math.min(health.failures++, 4));
                lane.recoveryAt = now() + 5000;
                // Safe diagnostics: never log URLs, parameters or raw errors.
                console.warn(JSON.stringify({event: 'rpc.endpoint_unavailable', endpoint: index, kind,
                  method: read || request.method === 'eth_sendRawTransaction' ? request.method : 'wallet', retryMs: health.retryAt - now()}));
              }
              if (!canRetry || shouldThrowRpcError(error as Error)) throw error;
              lastError = error;
            }
          }
          // Do not hammer an entirely unavailable pool on every device poll.
          throw lastError;
        };
        const task = run();
        if (!requestKey) return task;
        shared.pending.set(requestKey, task);
        try {return await task;} finally {if (shared.pending.get(requestKey) === task) shared.pending.delete(requestKey);}
      }) as EIP1193RequestFn,
    });
  };
}
