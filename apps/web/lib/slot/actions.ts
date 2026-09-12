import {encodeFunctionData, decodeFunctionData, erc20Abi, getAddress, isAddress, parseAbi, zeroAddress, type Address, type Hex, type Abi, type AbiFunction} from 'viem';
import {slotAbi} from './abi';
import type {SlotReader} from './reader';
import {SlotError} from './errors';
import {BASE_PRIZE_COLLECTION,prizeCollectionAbi} from '../prize-collection';
export const ADMIN_ACTIONS = [
  {name: 'pause', label: 'Metti in pausa', role: 'pauser', fields: []},
  {name: 'unpause', label: 'Riattiva la macchina', role: 'pauser', fields: []},
  {name: 'setTicketPrice', label: 'Prezzo biglietto', role: 'manager', fields: ['Prezzo in unità USDC (1 USDC = 1000000)']},
  {name: 'setRevealSettings', label: 'Tempi di reveal', role: 'manager', fields: ['Blocchi di attesa', 'Finestra reveal in blocchi (max 256)']},
  {name: 'setNoWinWeight', label: 'Probabilità senza premio', role: 'manager', fields: ['Peso (1 unità = 0,1%)']},
  {name: 'configurePrize', label: 'Configura premio', role: 'manager', fields: ['ID simbolo (0–15)', 'Tipo: 0 disabilitato, 1 ERC20, 2 ERC1155, 3 free spin', 'Indirizzo token (zero address per free spin)', 'Token ID (0 per ERC20/free spin)', 'Importo 5/5 nelle unità minime del token', 'Peso 3/5 (1 unità = 0,1%)', 'Peso 5/5 (1 unità = 0,1%)']},
  {name: 'grantFreeSpins', label: 'Aggiungi free spin', role: 'manager', fields: ['Wallet player', 'Free spin da aggiungere']},
  {name: 'setFreeSpins', label: 'Imposta saldo free spin', role: 'manager', fields: ['Wallet player', 'Nuovo saldo free spin']},
  {name: 'fundERC20', label: 'Deposita token ERC20', role: 'any', fields: ['Token di pagamento o premio configurato', 'Importo nelle unità minime del token']},
  {name: 'fundERC1155', label: 'Deposita premi ERC1155', role: 'any', fields: ['Token premio configurato', 'Token ID', 'Quantità']},
  {name: 'mintERC1155', label: 'Crea premi ERC1155', role: 'any', fields: ['Collezione premi', 'Token ID esistente', 'Quantità', 'Destinazione: wallet oppure slot']},
  {name: 'acceptPrizeOwnership', label: 'Accetta proprietà collezione ERC1155', role: 'any', fields: ['Collezione premi']},
  {name: 'withdrawERC20', label: 'Preleva token ERC20', role: 'treasurer', fields: ['Indirizzo token', 'Wallet destinatario', 'Importo nelle unità minime del token']},
  {name: 'withdrawERC1155', label: 'Preleva premi ERC1155', role: 'treasurer', fields: ['Indirizzo token', 'Token ID', 'Wallet destinatario', 'Quantità']},
  {name: 'withdrawNative', label: 'Preleva ETH', role: 'treasurer', fields: ['Wallet destinatario', 'Importo in wei']},
  {name: 'grantRole', label: 'Assegna ruolo', role: 'owner', fields: ['Ruolo bytes32', 'Wallet destinatario']},
  {name: 'revokeRole', label: 'Revoca ruolo', role: 'owner', fields: ['Ruolo bytes32', 'Wallet destinatario']},
  {name: 'renounceRole', label: 'Rinuncia a un ruolo', role: 'any', fields: ['Ruolo bytes32', 'Conferma il tuo wallet']},
  {name: 'beginDefaultAdminTransfer', label: 'Avvia trasferimento proprietà', role: 'owner', fields: ['Nuovo owner']},
  {name: 'acceptDefaultAdminTransfer', label: 'Accetta proprietà', role: 'any', fields: []},
  {name: 'cancelDefaultAdminTransfer', label: 'Annulla trasferimento proprietà', role: 'owner', fields: []},
  {name: 'changeDefaultAdminDelay', label: 'Modifica ritardo proprietà', role: 'owner', fields: ['Ritardo in secondi']},
  {name: 'rollbackDefaultAdminDelay', label: 'Annulla modifica ritardo', role: 'owner', fields: []},
] as const;
export type AdminAction = typeof ADMIN_ACTIONS[number]['name'];
const nftAbi = parseAbi(['function safeTransferFrom(address from,address to,uint256 id,uint256 amount,bytes data)']);
function uint(value: string, bits = 256) {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 2n ** BigInt(bits)) throw new SlotError('Input', 'Inserisci un intero positivo nelle unità indicate.', 400);
  return BigInt(value);
}
function address(value: string) {if (!isAddress(value)) throw new SlotError('Input', 'Indirizzo Ethereum non valido.', 400); return getAddress(value);}
function argument(type: string, value: string): unknown {
  if (type === 'address') return address(value);
  if (type === 'bytes32') {if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new SlotError('Input', 'Il ruolo deve essere un valore bytes32.', 400); return value;}
  if (/^uint\d*$/.test(type)) return uint(value, Number(type.slice(4) || 256));
  throw new SlotError('Input', 'Tipo di parametro non supportato.', 400);
}
export function buildAction(reader: SlotReader, account: Address, action: string, inputs: string[]) {
  let to = reader.config.address, data: Hex;
  if (action === 'approveBudget') {
    if (inputs.length !== 1 || inputs[0].length > 18) throw new SlotError('Input', 'Budget non valido.', 400);
    to = reader.config.paymentToken; data = encodeFunctionData({abi: erc20Abi, functionName: 'approve', args: [reader.config.address, uint(inputs[0])]});
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
    if (to.toLowerCase() !== collection.toLowerCase()) throw new SlotError('Asset', 'Collezione premi non autorizzata.', 403);
    if (action === 'acceptPrizeOwnership') data = encodeFunctionData({abi:prizeCollectionAbi,functionName:'acceptOwnership'});
    else {
      if (!['wallet','slot'].includes(inputs[3]) || uint(inputs[2]) === 0n) throw new SlotError('Input', 'Quantità o destinazione non valida.', 400);
      data = encodeFunctionData({abi:prizeCollectionAbi,functionName:'mint',args:[inputs[3] === 'wallet' ? account : reader.config.address,uint(inputs[1]),uint(inputs[2])]});
    }
  } else {
    if (!ADMIN_ACTIONS.some(item => item.name === action)) throw new SlotError('Action', 'Operazione non consentita.', 400);
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
    if (!allowed) throw new SlotError('Asset', 'Configura prima questo token nel catalogo premi.');
  }
  if (action === 'mintERC1155' || action === 'acceptPrizeOwnership') {
    const owner = await reader.client.readContract({address:tx.to,abi:prizeCollectionAbi,functionName:action === 'mintERC1155' ? 'owner' : 'pendingOwner'});
    if (owner.toLowerCase() !== account.toLowerCase()) throw new SlotError('PrizeOwner', action === 'mintERC1155' ? 'Il wallet condiviso deve essere owner della collezione ERC1155 per creare premi.' : 'Avvia prima il trasferimento della collezione verso il wallet condiviso.', 403);
    if (action === 'mintERC1155') {
      if (!(await reader.client.readContract({address:tx.to,abi:prizeCollectionAbi,functionName:'tokenExists',args:[uint(inputs[1])]}))) throw new SlotError('Asset','Questo token ID non esiste nella collezione.');
      if (inputs[3] === 'slot' && !(await reader.catalog()).some(prize=>prize.kind===2 && prize.token.toLowerCase()===tx.to.toLowerCase() && prize.tokenId===uint(inputs[1]))) throw new SlotError('Asset','Configura questo token ID nel catalogo prima di creare premi direttamente nella slot.');
    }
  }
  const abi = action === 'approveBudget' || action === 'fundERC20' ? erc20Abi : action === 'fundERC1155' ? nftAbi : action === 'mintERC1155' || action === 'acceptPrizeOwnership' ? prizeCollectionAbi : slotAbi;
  const decoded = decodeFunctionData({abi: abi as Abi, data: tx.data});
  // ETH is not required for preflight: Privy quotes and collects USDC gas at send.
  await reader.client.simulateContract({account, address: tx.to, abi: abi as Abi, functionName: decoded.functionName, args: decoded.args, value: 0n, gasPrice: 0n});
  return tx;
}
