import {concatHex, encodeFunctionData, keccak256, toHex, type Address, type Hash, type Hex} from 'viem';
import {slotAbi} from './abi';
import {SlotError} from './errors';
import type {SlotReader} from './reader';

export const WELCOME_AMOUNT = 2n;
// A durable public label, not a credential. Preserve it across releases and key rotation.
export const WELCOME_MARKER = keccak256(toHex('rwa-slot:welcome-free-spins:v1'));
export function welcomeGrantData(player: Address): Hex {
  // The deployed Solidity decoder accepts this trailing word after its two static arguments.
  return concatHex([encodeFunctionData({abi: slotAbi, functionName: 'grantFreeSpins', args: [player, WELCOME_AMOUNT]}), WELCOME_MARKER]);
}
type Scan = {floor:bigint; through: bigint; hash: Hash; transactionHash?: Hash};
export type WelcomeHistory = {granted: boolean; complete: boolean; blockNumber: bigint; blockHash: Hash; transactionHash?: Hash};
const MAX_PAGES = 12;

export function createWelcomeHistory(reader: SlotReader) {
  const {client, contract, config} = reader;
  const pageBlocks = config.logPageBlocks && config.logPageBlocks > 0n ? config.logPageBlocks : 2000n;
  const scans = new Map<string, Scan>(), locks = new Map<string, Promise<unknown>>();
  async function scan(player: Address, requestedFloor:bigint): Promise<WelcomeHistory> {
    const historyFloor=requestedFloor>config.deploymentBlock?requestedFloor:config.deploymentBlock;
    const key = player.toLowerCase();
    const head = await client.getBlock({blockTag: 'latest'});
    if (head.number < historyFloor) throw new SlotError('WrongDeployment', 'The contract history is unavailable.', 503);
    let cached = scans.get(key);
    if (cached && (cached.floor>historyFloor || cached.through > head.number || (await client.getBlock({blockNumber: cached.through})).hash !== cached.hash)) {
      scans.delete(key); cached = undefined;
    }
    if (cached?.transactionHash) return {granted: true, complete: true, blockNumber: head.number, blockHash: head.hash, transactionHash: cached.transactionHash};
    let cursor = cached ? cached.through + 1n : historyFloor;
    let through = cursor - 1n, transactionHash: Hash | undefined;
    const data = welcomeGrantData(player).toLowerCase();
    // Also recognize a native once-only grant on a future contract, without requiring that interface.
    const nativeData = encodeFunctionData({abi: slotAbi, functionName: 'grantWelcomeFreeSpins', args: [player]}).toLowerCase();
    for (let page = 0; page < MAX_PAGES && cursor <= head.number; page++) {
      const end = cursor + pageBlocks - 1n < head.number ? cursor + pageBlocks - 1n : head.number;
      const events = await client.getContractEvents({...contract, eventName: 'FreeSpinsGranted', args: {player}, fromBlock: cursor, toBlock: end, strict: true});
      for (const event of events) {
        if (event.removed || event.blockNumber < cursor || event.blockNumber > end || event.args.amount !== WELCOME_AMOUNT || event.args.player.toLowerCase() !== key) continue;
        const tx = await client.getTransaction({hash: event.transactionHash});
        if (tx.to?.toLowerCase() !== config.address.toLowerCase() || tx.value !== 0n || ![data, nativeData].includes(tx.input.toLowerCase())) continue;
        const receipt = await client.getTransactionReceipt({hash: event.transactionHash});
        if (receipt.status !== 'success' || receipt.blockHash !== event.blockHash || tx.blockHash !== event.blockHash) {
          throw new SlotError('WelcomeHistoryChanged', 'Checking the bonus history. Try again shortly.', 503);
        }
        transactionHash = event.transactionHash; break;
      }
      through = end; cursor = end + 1n;
      if (transactionHash) break;
    }
    // A failed/inconsistent RPC read never advances the cursor or authorizes another credit.
    const checkpoint = await client.getBlock({blockNumber: through});
    if ((await client.getBlock({blockNumber: head.number})).hash !== head.hash) {
      throw new SlotError('WelcomeHistoryChanged', 'Checking the bonus history. Try again shortly.', 503);
    }
    if (scans.size >= 512 && !scans.has(key)) scans.delete(scans.keys().next().value!);
    scans.set(key, {floor:cached?.floor??historyFloor,through, hash: checkpoint.hash, transactionHash});
    return {granted: !!transactionHash, complete: !!transactionHash || through === head.number, blockNumber: head.number, blockHash: head.hash, transactionHash};
  }
  function read(player: Address, fromBlock=config.deploymentBlock): Promise<WelcomeHistory> {
    const key = player.toLowerCase();
    const task = (locks.get(key) || Promise.resolve()).catch(() => {}).then(() => scan(player,fromBlock));
    locks.set(key, task);
    void task.finally(() => {if (locks.get(key) === task) locks.delete(key);}).catch(() => {});
    return task;
  }
  return {read};
}
