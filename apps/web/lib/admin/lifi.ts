import {decodeFunctionData,encodeFunctionData,parseAbi,zeroAddress,type Address,type Hex} from 'viem';
import {ETH_ASSET,type Asset} from '../assets';
import {SlotError} from '../slot/errors';

export const LIFI_ROUTER='0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE' as const;
export const LIFI_INTEGRATOR='lucky-signal';
const swapTuple='(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)';
// Only same-chain generic swaps. Bridging, arbitrary calls and permit signatures are excluded.
export const lifiSwapAbi=parseAbi([
  `function swapTokensSingleV3ERC20ToERC20(bytes32 _transactionId,string _integrator,string _referrer,address _receiver,uint256 _minAmountOut,${swapTuple} _swapData)`,
  `function swapTokensMultipleV3ERC20ToERC20(bytes32 _transactionId,string _integrator,string _referrer,address _receiver,uint256 _minAmountOut,${swapTuple}[] _swapData)`,
  `function swapTokensSingleV3NativeToERC20(bytes32 _transactionId,string _integrator,string _referrer,address _receiver,uint256 _minAmountOut,${swapTuple} _swapData) payable`,
  `function swapTokensMultipleV3NativeToERC20(bytes32 _transactionId,string _integrator,string _referrer,address _receiver,uint256 _minAmountOut,${swapTuple}[] _swapData) payable`,
]);
export const lifiEventAbi=parseAbi(['event LiFiGenericSwapCompleted(bytes32 indexed transactionId,string integrator,string referrer,address receiver,address fromAssetId,address toAssetId,uint256 fromAmount,uint256 toAmount)']);
export type SwapIntent={address:Address;inputAsset:Asset;outputAsset:Asset;amount:string};
export type LifiQuote={input:string;estimated:string;minimum:string;gasEstimate:string;feeAmount:string;route:string;transactionId:Hex;transaction:{to:Address;data:Hex;value:Hex}};
const same=(a:unknown,b:string)=>typeof a==='string'&&a.toLowerCase()===b.toLowerCase();
const uint=(x:unknown):x is string=>typeof x==='string'&&/^\d{1,78}$/.test(x)&&BigInt(x)<2n**256n;
function requireQuote(condition:unknown):asserts condition {if(!condition)throw new SlotError('SwapQuote','La quotazione LI.FI non corrisponde allo scambio richiesto.',502);}

export function validateLifiQuote(raw:unknown,intent:SwapIntent):LifiQuote {
  try {
    // Provider JSON stays untrusted until both metadata and encoded transaction agree.
    const q=raw as {action:Record<string,any>;estimate:Record<string,any>;transactionRequest:Record<string,any>;tool:string};
    const {action:a,estimate:e,transactionRequest:t}=q;
    requireQuote(a&&e&&t&&a.fromChainId===8453&&a.toChainId===8453&&t.chainId===8453);
    requireQuote(same(a.fromToken?.address,intent.inputAsset.address)&&same(a.toToken?.address,intent.outputAsset.address));
    requireQuote(a.fromToken.decimals===intent.inputAsset.decimals&&a.toToken.decimals===intent.outputAsset.decimals);
    requireQuote(a.fromAmount===intent.amount&&e.fromAmount===intent.amount&&a.slippage===0.005);
    requireQuote(same(a.fromAddress,intent.address)&&same(a.toAddress,intent.address)&&same(t.from,intent.address));
    requireQuote(same(t.to,LIFI_ROUTER)&&same(e.approvalAddress,LIFI_ROUTER));
    requireQuote(uint(e.toAmount)&&uint(e.toAmountMin)&&BigInt(e.toAmountMin)>0n&&BigInt(e.toAmountMin)<=BigInt(e.toAmount));
    // The quote may round down by one smallest output unit, but cannot widen 0.5% slippage.
    requireQuote(BigInt(e.toAmountMin)>=BigInt(e.toAmount)*995n/1000n);
    requireQuote(typeof t.data==='string'&&/^0x[\da-f]+$/i.test(t.data)&&t.data.length<=100000);
    requireQuote(typeof t.value==='string'&&/^0x[\da-f]+$/i.test(t.value));
    const native=intent.inputAsset.id==='eth';
    requireQuote(BigInt(t.value)===(native?BigInt(intent.amount):0n));
    const decoded=decodeFunctionData({abi:lifiSwapAbi,data:t.data as Hex});
    requireQuote(decoded.functionName.endsWith(native?'NativeToERC20':'ERC20ToERC20'));
    const [transactionId,integrator,,receiver,minimum,steps]=decoded.args;
    requireQuote(integrator===LIFI_INTEGRATOR&&same(receiver,intent.address)&&minimum.toString()===e.toAmountMin);
    // Canonical encoding also rejects hidden/trailing transaction payloads.
    requireQuote(encodeFunctionData({abi:lifiSwapAbi,functionName:decoded.functionName,args:decoded.args as never}).toLowerCase()===t.data.toLowerCase());
    const swaps=Array.isArray(steps)?steps:[steps];
    requireQuote(swaps.length>0&&swaps.length<=8);
    requireQuote(same(swaps[0].sendingAssetId,intent.inputAsset.address)&&same(swaps.at(-1)!.receivingAssetId,intent.outputAsset.address));
    let deposited=0n;
    const available=new Set([intent.inputAsset.address.toLowerCase()]);
    for(const step of swaps){
      requireQuote(step.callTo!==zeroAddress&&step.approveTo!==zeroAddress&&!same(step.callTo,intent.address)&&!same(step.callTo,LIFI_ROUTER));
      requireQuote(step.callData.length>=10&&step.fromAmount>0n&&available.has(step.sendingAssetId.toLowerCase()));
      if(step.requiresDeposit){requireQuote(same(step.sendingAssetId,intent.inputAsset.address));deposited+=step.fromAmount;}
      if(same(step.sendingAssetId,intent.inputAsset.address))requireQuote(step.fromAmount<=BigInt(intent.amount));
      available.add(step.receivingAssetId.toLowerCase());
    }
    requireQuote(deposited===BigInt(intent.amount));
    // LI.FI's router enforces the DEX/selector allowlist and final minimum output.
    // Nested DEX calldata remains protocol-specific, never browser-supplied.
    requireQuote(Array.isArray(e.gasCosts)&&e.gasCosts.length>0&&e.gasCosts.every((g:any)=>uint(g.amount)&&same(g.token?.address,ETH_ASSET.address)&&g.token?.chainId===8453));
    const gasEstimate=e.gasCosts.reduce((sum:bigint,g:any)=>sum+BigInt(g.amount),0n).toString();
    requireQuote(Array.isArray(e.feeCosts)&&e.feeCosts.every((f:any)=>uint(f.amount)&&f.included===true&&same(f.token?.address,intent.inputAsset.address)));
    const feeAmount=e.feeCosts.reduce((sum:bigint,f:any)=>sum+BigInt(f.amount),0n).toString();
    requireQuote(BigInt(feeAmount)<BigInt(intent.amount));
    return {input:intent.amount,estimated:e.toAmount,minimum:e.toAmountMin,gasEstimate,feeAmount,route:typeof q.tool==='string'?q.tool.slice(0,64):'LI.FI',transactionId,transaction:{to:LIFI_ROUTER,data:t.data as Hex,value:t.value as Hex}};
  }catch(error){if(error instanceof SlotError)throw error;throw new SlotError('SwapQuote','Quotazione LI.FI non verificabile. Richiedine una nuova.',502);}
}

export function createLifiClient(fetcher:typeof fetch=fetch,apiKey?:string){
  return async (intent:SwapIntent)=>{
    const params=new URLSearchParams({fromChain:'8453',toChain:'8453',fromToken:intent.inputAsset.address,toToken:intent.outputAsset.address,fromAmount:intent.amount,fromAddress:intent.address,toAddress:intent.address,slippage:'0.005',integrator:LIFI_INTEGRATOR});
    let response:Response;
    try{response=await fetcher('https://li.quest/v1/quote?'+params,{headers:apiKey?{'x-lifi-api-key':apiKey}:{},signal:AbortSignal.timeout(25000),cache:'no-store',redirect:'error'});}catch{throw new SlotError('SwapProvider','LI.FI non risponde. Riprova a richiedere la quotazione.',503);}
    if(!response.ok)throw new SlotError('SwapUnavailable',response.status===429?'LI.FI ha ricevuto troppe richieste. Attendi qualche secondo.':'Nessun percorso LI.FI disponibile per questo importo e questa coppia. Prova un altro importo.',response.status===429?429:400);
    const text=await response.text();requireQuote(text.length<=500000);
    let raw:unknown;try{raw=JSON.parse(text);}catch{throw new SlotError('SwapQuote','Risposta LI.FI non valida.',502);}
    return validateLifiQuote(raw,intent);
  };
}
