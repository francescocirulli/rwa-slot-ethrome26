import type {PrivyClient} from '@privy-io/node';
import {erc20Abi, parseAbi, type Address} from 'viem';
import {ADMIN_ACTIONS} from '../slot/actions';
import {slotAbi} from '../slot/abi';
import {adminProofMessage} from './model';
import {PAYMENT_ASSET} from '../assets';
import {LIFI_ROUTER,lifiSwapAbi} from './lifi';
import {BASE_PRIZE_COLLECTION,prizeCollectionAbi} from '../prize-collection';
export const OPERATOR_ACTIONS:readonly string[] = ADMIN_ACTIONS.filter(action=>action.role!=='owner'&&action.name!=='renounceRole'&&action.name!=='acceptDefaultAdminTransfer'&&action.name!=='acceptPrizeOwnership'&&action.name!=='transferPrizeOwnership'&&action.name!=='acceptPrizeOwnershipBackend').map(action=>action.name);
type Rules=Parameters<ReturnType<PrivyClient['policies']>['create']>[0]['rules'];
export function legacyOperatorPolicy(wallet:Address,contract:Address|null):Rules {
  const rules:Rules=[{name:'Shared wallet access proof',method:'personal_sign',action:'ALLOW',conditions:[{field_source:'message',field:'content',operator:'eq',value:adminProofMessage(wallet)}]}];
  if(!contract)return rules;
  const base=[{field_source:'ethereum_transaction',field:'chain_id',operator:'eq',value:'8453'},{field_source:'ethereum_transaction',field:'value',operator:'eq',value:'0'}] as const;
  const functions=slotAbi.filter(item=>item.type==='function').filter(item=>OPERATOR_ACTIONS.includes(item.name));
  rules.push({name:'Operate the configured slot',method:'eth_sendTransaction',action:'ALLOW',conditions:[...base,
    {field_source:'ethereum_transaction',field:'to',operator:'eq',value:contract},
    {field_source:'ethereum_calldata',field:'function_name',operator:'in',value:functions.map(item=>item.name),abi:JSON.parse(JSON.stringify(functions))}]});
  rules.push({name:'Fund slot with ERC20',method:'eth_sendTransaction',action:'ALLOW',conditions:[...base,
    {field_source:'ethereum_calldata',field:'transfer.to',operator:'eq',value:contract,abi:JSON.parse(JSON.stringify(parseAbi(['function transfer(address to,uint256 amount) returns(bool)'])))}]});
  rules.push({name:'Fund slot with ERC1155',method:'eth_sendTransaction',action:'ALLOW',conditions:[...base,
    {field_source:'ethereum_calldata',field:'safeTransferFrom.to',operator:'eq',value:contract,abi:JSON.parse(JSON.stringify(parseAbi(['function safeTransferFrom(address from,address to,uint256 id,uint256 amount,bytes data)'])))}]});
  return rules;
}
export function swapOperatorPolicy(wallet:Address,contract:Address|null):Rules {
  const rules=legacyOperatorPolicy(wallet,contract);
  const chain={field_source:'ethereum_transaction',field:'chain_id',operator:'eq',value:'8453'} as const;
  const approveAbi=JSON.parse(JSON.stringify(erc20Abi.filter(f=>f.type==='function'&&f.name==='approve')));
  rules.push({name:'Approve USDC for LI.FI',method:'eth_sendTransaction',action:'ALLOW',conditions:[chain,
    {field_source:'ethereum_transaction',field:'value',operator:'eq',value:'0'},
    {field_source:'ethereum_transaction',field:'to',operator:'eq',value:PAYMENT_ASSET.address},
    {field_source:'ethereum_calldata',field:'approve.spender',operator:'eq',value:LIFI_ROUTER,abi:approveAbi},
    {field_source:'ethereum_calldata',field:'approve.amount',operator:'gt',value:'0',abi:approveAbi},
  ]});
  for(const fn of lifiSwapAbi){
    const abi=JSON.parse(JSON.stringify([fn]));
    rules.push({name:'LI.FI '+fn.name,method:'eth_sendTransaction',action:'ALLOW',conditions:[chain,
      {field_source:'ethereum_transaction',field:'to',operator:'eq',value:LIFI_ROUTER},
      {field_source:'ethereum_transaction',field:'value',operator:fn.name.endsWith('NativeToERC20')?'gt':'eq',value:'0'},
      {field_source:'ethereum_calldata',field:'function_name',operator:'eq',value:fn.name,abi},
      {field_source:'ethereum_calldata',field:fn.name+'._receiver',operator:'eq',value:wallet,abi},
      {field_source:'ethereum_calldata',field:fn.name+'._minAmountOut',operator:'gt',value:'0',abi},
    ]});
  }
  return rules;
}
export function operatorPolicy(wallet:Address,contract:Address|null,collection:Address=BASE_PRIZE_COLLECTION):Rules {
  const rules=swapOperatorPolicy(wallet,contract);
  if(contract)rules.push({name:'Mint prizes to shared wallet or slot',method:'eth_sendTransaction',action:'ALLOW',conditions:[
    {field_source:'ethereum_transaction',field:'chain_id',operator:'eq',value:'8453'},
    {field_source:'ethereum_transaction',field:'value',operator:'eq',value:'0'},
    {field_source:'ethereum_transaction',field:'to',operator:'eq',value:collection},
    {field_source:'ethereum_calldata',field:'function_name',operator:'eq',value:'mint',abi:JSON.parse(JSON.stringify(prizeCollectionAbi.filter(item=>item.name==='mint')))},
    {field_source:'ethereum_calldata',field:'mint.recipient',operator:'in',value:[wallet,contract],abi:JSON.parse(JSON.stringify(prizeCollectionAbi.filter(item=>item.name==='mint')))},
  ]});
  return rules;
}
// Provider responses add IDs to rules. Compare the enforced fields, with canonical object keys.
export function policyMatches(actual:unknown,expected:Rules):boolean {
  function canonical(value:unknown):unknown {
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key,value])=>key!=='id'&&value!==null&&value!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,canonical(value)]));
    return value;
  }
  return JSON.stringify(canonical(actual))===JSON.stringify(canonical(expected));
}
