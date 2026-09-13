import {erc20Abi, formatUnits, type Address} from 'viem';
import {WALLET_ASSETS, NFT_PRIZES} from '../assets';
import {slotAbi} from '../slot/abi';
import {BASE_PRIZE_COLLECTION,BASE_PRIZE_IDS,prizeCollectionAbi} from '../prize-collection';
import {createBaseReadClient,baseChainCheck} from '../base-read-client';
import {prizeRequirements} from '../slot/funding';
export function createInventoryReader(rpcUrl='https://base-rpc.publicnode.com',collection:Address=BASE_PRIZE_COLLECTION,client=createBaseReadClient(rpcUrl)) {
  const check=baseChainCheck(client);
  const pending=new Map<string,Promise<Awaited<ReturnType<typeof read>>>>();
  async function read(address:Address,contract:Address|null,scope:boolean|'player'=false) {
    const fundingOnly=scope===true,playerOnly=scope==='player';
    await check();
    const blockNumber=await client.getBlockNumber({cacheTime:0});
    const [balances,native,contractNative,catalog,owner,pendingOwner]=await Promise.all([
      client.multicall({blockNumber,contracts:WALLET_ASSETS.flatMap(asset=>[{address:asset.address,abi:erc20Abi,functionName:'balanceOf',args:[address]},{address:asset.address,abi:erc20Abi,functionName:'decimals'}]),allowFailure:true}),
      client.getBalance({address,blockNumber}),
      contract&&!fundingOnly&&!playerOnly?client.getBalance({address:contract,blockNumber}).catch(()=>null):null,
      contract?client.readContract({address:contract,abi:slotAbi,functionName:'getPrizeCatalog',blockNumber}).catch(()=>null):null,
      fundingOnly||playerOnly?null:client.readContract({address:collection,abi:prizeCollectionAbi,functionName:'owner',blockNumber}).catch(()=>null),
      fundingOnly||playerOnly?null:client.readContract({address:collection,abi:prizeCollectionAbi,functionName:'pendingOwner',blockNumber}).catch(()=>null),
    ]);
    const entries=catalog?catalog[0].map((symbol,i)=>({symbol,...catalog[1][i]})):[];
    const reserve=(values:readonly [bigint,bigint,bigint]|null)=>values?{balance:String(values[0]),reserved:String(values[1]),available:String(values[2])}:null;
    const assets=await Promise.all(WALLET_ASSETS.map(async (asset,i)=>{
      const balance=balances[i*2],decimals=balances[i*2+1];
      const verified=balance.status==='success'&&decimals.status==='success'&&decimals.result===asset.decimals;
      const configured=asset.id==='usdc'||entries.some(p=>p.kind===1&&p.symbol===asset.symbol&&p.token.toLowerCase()===asset.address.toLowerCase());
      const stock=contract&&!playerOnly?await client.readContract({address:contract,abi:slotAbi,functionName:'getERC20Inventory',args:[asset.address],blockNumber}).catch(()=>null):null;
      return {...asset,balance:verified?String(balance.result):null,formatted:verified?formatUnits(BigInt(String(balance.result)),asset.decimals):null,verified,reserve:decimals.status==='success'&&decimals.result===asset.decimals?reserve(stock):null,canDeposit:!!contract&&!!catalog&&configured};
    }));
    const nfts=await Promise.all((fundingOnly?[]:NFT_PRIZES).map(async nft=>{
      const prize=entries.find(p=>p.symbol===nft.symbol&&p.kind===2);
      const token=prize?.token||(collection.toLowerCase()===BASE_PRIZE_COLLECTION.toLowerCase()?collection:null);
      const tokenId=prize?.tokenId.toString()||(token?BASE_PRIZE_IDS[nft.symbol]:null);
      const [amount,stock,exists]=token&&tokenId?await Promise.all([
        client.readContract({address:token,abi:prizeCollectionAbi,functionName:'balanceOf',args:[address,BigInt(tokenId)],blockNumber}).catch(()=>null),
        contract&&!playerOnly?client.readContract({address:contract,abi:slotAbi,functionName:'getERC1155Inventory',args:[token,BigInt(tokenId)],blockNumber}).catch(()=>null):null,
        !playerOnly&&token.toLowerCase()===collection.toLowerCase()?client.readContract({address:token,abi:prizeCollectionAbi,functionName:'tokenExists',args:[BigInt(tokenId)],blockNumber}).catch(()=>false):false,
      ]):[null,null,false];
      return {...nft,token,tokenId,balance:amount?.toString()??null,reserve:reserve(stock),canDeposit:!!prize&&!!contract,canMint:!!exists&&owner?.toLowerCase()===address.toLowerCase()};
    }));
    const freeSpins=contract&&!fundingOnly&&!playerOnly?await client.readContract({address:contract,abi:slotAbi,functionName:'freeSpins',args:[address],blockNumber}).catch(()=>null):null;
    // Use the catalog and reserves from this same block; do not mix in an old page snapshot.
    const required=catalog?prizeRequirements(entries.filter(prize=>prize.kind===1)):null;
    const fundingAssets=required?.map(item=>{const asset=assets.find(a=>a.address.toLowerCase()===item.token.toLowerCase());return asset?.reserve?{kind:1,token:item.token,required:item.required.toString(),...asset.reserve}:null;});
    const funding=fundingAssets&&fundingAssets.every(item=>item!==null)?{assets:fundingAssets}:null;
    return {address,contract,block:blockNumber.toString(),updatedAt:Date.now(),eth:formatUnits(native,18),contractEth:contractNative===null?null:formatUnits(contractNative,18),assets,nfts,freeSpins:freeSpins?.toString()??null,catalogAvailable:!!catalog,
      funding,scope:playerOnly?'player':fundingOnly?'funding':'full',collection:{address:collection,owner,pendingOwner,canMint:owner?.toLowerCase()===address.toLowerCase(),canAcceptOwnership:pendingOwner?.toLowerCase()===address.toLowerCase()}};
  };
  return (address:Address,contract:Address|null,scope:boolean|'player'=false)=>{
    const key=address.toLowerCase()+':'+contract?.toLowerCase()+':'+scope;
    const running=pending.get(key);if(running)return running;
    const request=read(address,contract,scope).finally(()=>pending.delete(key));pending.set(key,request);return request;
  };
}
export type Inventory=Awaited<ReturnType<ReturnType<typeof createInventoryReader>>>;
