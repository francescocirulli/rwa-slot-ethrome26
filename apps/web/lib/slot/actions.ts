import {encodeFunctionData, decodeFunctionData, erc20Abi, getAddress, isAddress, parseAbi, zeroAddress, type Address, type Hex, type Abi, type AbiFunction} from 'viem';
import {slotAbi} from './abi';
import type {SlotReader} from './reader';
import {SlotError} from './errors';
import {BASE_PRIZE_COLLECTION,BASE_PRIZE_IDS,prizeCollectionAbi} from '../prize-collection';
import {assetByAddress} from '../assets';
export type AdminTarget = 'slot' | 'collection';
export const ADMIN_TARGETS: {id: AdminTarget; label: string; note: string}[] = [
  {id: 'slot', label: 'Contratto slot', note: 'Regole di gioco, cassa, ruoli e proprietà della slot.'},
  {id: 'collection', label: 'Collezione ERC1155', note: 'Creazione e proprietà dei premi della collezione 1155.'},
];
export const ADMIN_ACTIONS = [
  {name: 'pause', label: 'Pause', role: 'pauser', target: 'slot', fields: []},
  {name: 'unpause', label: 'Resume the machine', role: 'pauser', target: 'slot', fields: []},
  {name: 'setTicketPrice', label: 'Ticket price', role: 'manager', target: 'slot', fields: ['Price in USDC base units (1 USDC = 1000000)']},
  {name: 'setRevealSettings', label: 'Reveal timing', role: 'manager', target: 'slot', fields: ['Wait blocks', 'Reveal window in blocks (max 256)']},
  {name: 'setNoWinWeight', label: 'No-prize probability', role: 'manager', target: 'slot', fields: ['Weight (1 unit = 0.1%)']},
  {name: 'configurePrize', label: 'Configure prize', role: 'manager', target: 'slot', fields: ['Symbol ID (0–15)', 'Kind: 0 disabled, 1 ERC20, 2 ERC1155, 3 free spin', 'Token address (zero address for free spin)', 'Token ID (0 for ERC20/free spin)', '5/5 amount in token base units', '3/5 weight (1 unit = 0.1%)', '5/5 weight (1 unit = 0.1%)']},
  {name: 'grantFreeSpins', label: 'Add free spins', role: 'manager', target: 'slot', fields: ['Player wallet', 'Free spins to add']},
  {name: 'setFreeSpins', label: 'Set free-spin balance', role: 'manager', target: 'slot', fields: ['Player wallet', 'New free-spin balance']},
  {name: 'fundERC20', label: 'Deposit ERC20 tokens', role: 'any', target: 'slot', fields: ['Payment token or configured prize token', 'Amount in token base units']},
  {name: 'fundERC1155', label: 'Deposit ERC1155 prizes', role: 'any', target: 'collection', fields: ['Configured prize token', 'Token ID', 'Quantity']},
  {name: 'mintERC1155', label: 'Mint ERC1155 prizes', role: 'any', target: 'collection', fields: ['Prize collection', 'Existing token ID', 'Quantity', 'Destination: wallet or slot']},
  {name: 'acceptPrizeOwnership', label: 'Accept ERC1155 collection ownership', role: 'any', target: 'collection', fields: ['Prize collection']},
  {name: 'withdrawERC20', label: 'Withdraw ERC20 tokens', role: 'treasurer', target: 'slot', fields: ['Token address', 'Recipient wallet', 'Amount in token base units']},
  {name: 'withdrawERC1155', label: 'Withdraw ERC1155 prizes', role: 'treasurer', target: 'slot', fields: ['Token address', 'Token ID', 'Recipient wallet', 'Quantity']},
  {name: 'withdrawNative', label: 'Withdraw ETH', role: 'treasurer', target: 'slot', fields: ['Recipient wallet', 'Amount in wei']},
  {name: 'grantRole', label: 'Grant role', role: 'owner', target: 'slot', fields: ['bytes32 role', 'Recipient wallet']},
  {name: 'revokeRole', label: 'Revoke role', role: 'owner', target: 'slot', fields: ['bytes32 role', 'Recipient wallet']},
  {name: 'renounceRole', label: 'Renounce a role', role: 'any', target: 'slot', fields: ['bytes32 role', 'Confirm your wallet']},
  {name: 'beginDefaultAdminTransfer', label: 'Start ownership transfer', role: 'owner', target: 'slot', fields: ['New owner']},
  {name: 'acceptDefaultAdminTransfer', label: 'Accept ownership', role: 'any', target: 'slot', fields: []},
  {name: 'cancelDefaultAdminTransfer', label: 'Cancel ownership transfer', role: 'owner', target: 'slot', fields: []},
  {name: 'changeDefaultAdminDelay', label: 'Change ownership delay', role: 'owner', target: 'slot', fields: ['Delay in seconds']},
  {name: 'rollbackDefaultAdminDelay', label: 'Annulla modifica ritardo', role: 'owner', target: 'slot', fields: []},
] as const;
export type AdminAction = typeof ADMIN_ACTIONS[number]['name'];
const nftAbi = parseAbi(['function safeTransferFrom(address from,address to,uint256 id,uint256 amount,bytes data)']);
function uint(value: string, bits = 256) {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 2n ** BigInt(bits)) throw new SlotError('Input', 'Enter a positive integer in the indicated units.', 400);
  return BigInt(value);
}
function address(value: string) {if (!isAddress(value)) throw new SlotError('Input', 'Invalid Ethereum address.', 400); return getAddress(value);}
function argument(type: string, value: string): unknown {
  if (type === 'address') return address(value);
  if (type === 'bytes32') {if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new SlotError('Input', 'The role must be a bytes32 value.', 400); return value;}
  if (/^uint\d*$/.test(type)) return uint(value, Number(type.slice(4) || 256));
  throw new SlotError('Input', 'Unsupported parameter type.', 400);
}
export function buildAction(reader: SlotReader, account: Address, action: string, inputs: string[]) {
  let to = reader.config.address, data: Hex;
  if (action === 'approveBudget') {
    if (inputs.length !== 1 || inputs[0].length > 18) throw new SlotError('Input', 'Invalid budget.', 400);
    to = reader.config.paymentToken; data = encodeFunctionData({abi: erc20Abi, functionName: 'approve', args: [reader.config.address, uint(inputs[0])]});
  } else if (action === 'transferERC20' || action === 'transferERC1155') {
    const nft = action === 'transferERC1155';
    if (inputs.length !== (nft ? 4 : 3)) throw new SlotError('Input', 'Parametri incompleti.', 400);
    to = address(inputs[0]);
    const recipient = address(inputs[nft ? 2 : 1]), amount = uint(inputs[nft ? 3 : 2]);
    if (!amount || recipient === zeroAddress || recipient.toLowerCase() === account.toLowerCase() || recipient.toLowerCase() === reader.config.address.toLowerCase() || recipient.toLowerCase() === to.toLowerCase()) throw new SlotError('Input', 'Invalid amount or recipient.', 400);
    if (!nft && !assetByAddress(to)) throw new SlotError('Asset', 'Unsupported token.', 400);
    data = nft ? encodeFunctionData({abi: nftAbi, functionName: 'safeTransferFrom', args: [account, recipient, uint(inputs[1]), amount, '0x']})
      : encodeFunctionData({abi: erc20Abi, functionName: 'transfer', args: [recipient, amount]});
  } else if (action === 'fundERC20') {
    if (inputs.length !== 2) throw new SlotError('Input', 'Parametri incompleti.', 400);
    to = address(inputs[0]); data = encodeFunctionData({abi: erc20Abi, functionName: 'transfer', args: [reader.config.address, uint(inputs[1])]});
  } else if (action === 'fundERC1155') {
    if (inputs.length !== 3) throw new SlotError('Input', 'Parametri incompleti.', 400);
    to = address(inputs[0]); data = encodeFunctionData({abi: nftAbi, functionName: 'safeTransferFrom', args: [account, reader.config.address, uint(inputs[1]), uint(inputs[2]), '0x']});
  } else if (action === 'mintERC1155' || action === 'acceptPrizeOwnership') {
    if (inputs.length !== (action === 'mintERC1155' ? 4 : 1)) throw new SlotError('Input', 'Parametri incompleti.', 400);
    to = address(inputs[0]);
    const collection = reader.config.prizeCollection || BASE_PRIZE_COLLECTION;
    if (to.toLowerCase() !== collection.toLowerCase()) throw new SlotError('Asset', 'Prize collection not allowed.', 403);
    if (action === 'acceptPrizeOwnership') data = encodeFunctionData({abi:prizeCollectionAbi,functionName:'acceptOwnership'});
    else {
      if (!['wallet','slot'].includes(inputs[3]) || uint(inputs[2]) === 0n) throw new SlotError('Input', 'Invalid quantity or destination.', 400);
      data = encodeFunctionData({abi:prizeCollectionAbi,functionName:'mint',args:[inputs[3] === 'wallet' ? account : reader.config.address,uint(inputs[1]),uint(inputs[2])]});
    }
  } else {
    if (!ADMIN_ACTIONS.some(item => item.name === action)) throw new SlotError('Action', 'Operation not allowed.', 400);
    const definition = slotAbi.find(item => item.type === 'function' && item.name === action) as AbiFunction;
    if (!definition || definition.inputs.length !== inputs.length) throw new SlotError('Input', 'Parametri incompleti.', 400);
    data = encodeFunctionData({abi: [definition] as Abi, functionName: action, args: definition.inputs.map((input, index) => argument(input.type, inputs[index]))});
  }
  return {to, data, value: '0x0' as const, chainId: reader.config.chainId, gasMode: reader.config.gasMode};
}
export async function prepareAction(reader: SlotReader, account: Address, action: string, inputs: string[]) {
  await reader.validate();
  const tx = buildAction(reader, account, action, inputs);
  if (action === 'fundERC20' || action === 'fundERC1155') {
    const token = address(inputs[0] || ''), catalog = await reader.catalog();
    const allowed = action === 'fundERC20' && token.toLowerCase() === reader.config.paymentToken.toLowerCase() ||
      catalog.some(prize => prize.kind === (action === 'fundERC20' ? 1 : 2) && prize.token.toLowerCase() === token.toLowerCase() && (action !== 'fundERC1155' || prize.tokenId === uint(inputs[1])));
    if (!allowed) throw new SlotError('Asset', 'Configure this token in the prize catalog first.');
  }
  if (action === 'mintERC1155' || action === 'acceptPrizeOwnership') {
    const owner = await reader.client.readContract({address:tx.to,abi:prizeCollectionAbi,functionName:action === 'mintERC1155' ? 'owner' : 'pendingOwner'});
    if (owner.toLowerCase() !== account.toLowerCase()) throw new SlotError('PrizeOwner', action === 'mintERC1155' ? 'The shared wallet must own the ERC1155 collection to mint prizes.' : 'Start the collection transfer to the shared wallet first.', 403);
    if (action === 'mintERC1155') {
      if (!(await reader.client.readContract({address:tx.to,abi:prizeCollectionAbi,functionName:'tokenExists',args:[uint(inputs[1])]}))) throw new SlotError('Asset','This token ID does not exist in the collection.');
      if (inputs[3] === 'slot' && !(await reader.catalog()).some(prize=>prize.kind===2 && prize.token.toLowerCase()===tx.to.toLowerCase() && prize.tokenId===uint(inputs[1]))) throw new SlotError('Asset','Configure this token ID in the catalog before minting prizes directly into the slot.');
    }
  }
  if (action === 'transferERC20') {
    const asset = assetByAddress(tx.to)!;
    const [decimals, balance] = await Promise.all([
      reader.client.readContract({address:tx.to,abi:erc20Abi,functionName:'decimals'}),
      reader.client.readContract({address:tx.to,abi:erc20Abi,functionName:'balanceOf',args:[account]}),
    ]);
    if (decimals !== asset.decimals) throw new SlotError('Asset', 'Token decimals not verified.', 503);
    if (balance < uint(inputs[2])) throw new SlotError('Balance', 'Saldo token insufficiente.', 400);
  }
  if (action === 'transferERC1155') {
    const id = uint(inputs[1]);
    const known = tx.to.toLowerCase() === BASE_PRIZE_COLLECTION.toLowerCase() && Object.values(BASE_PRIZE_IDS).includes(id.toString());
    if (!known && !(await reader.catalog()).some(prize => prize.kind === 2 && prize.token.toLowerCase() === tx.to.toLowerCase() && prize.tokenId === id)) throw new SlotError('Asset', 'Unsupported NFT prize.', 400);
    const balance = await reader.client.readContract({address:tx.to,abi:prizeCollectionAbi,functionName:'balanceOf',args:[account,id]});
    if (balance < uint(inputs[3])) throw new SlotError('Balance', 'Insufficient NFT quantity.', 400);
  }
  const abi = action === 'transferERC20' ? erc20Abi : action === 'transferERC1155' ? nftAbi : action === 'approveBudget' || action === 'fundERC20' ? erc20Abi : action === 'fundERC1155' ? nftAbi : action === 'mintERC1155' || action === 'acceptPrizeOwnership' ? prizeCollectionAbi : slotAbi;
  const decoded = decodeFunctionData({abi: abi as Abi, data: tx.data});
  // ETH is not required for preflight: Privy quotes and collects USDC gas at send.
  const simulation = await reader.client.simulateContract({account, address: tx.to, abi: abi as Abi, functionName: decoded.functionName, args: decoded.args, value: 0n, gasPrice: 0n});
  if (action === 'transferERC20' && simulation?.result === false) throw new SlotError('TransferRejected', 'Il token ha rifiutato il trasferimento.', 409);
  return tx;
}
