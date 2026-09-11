import {createPublicClient, http, erc20Abi, formatUnits, parseAbi, type Address} from 'viem';
import {base} from 'viem/chains';
import {WALLET_ASSETS, NFT_PRIZES} from '../assets';
import {slotAbi} from '../slot/abi';
import {SlotError} from '../slot/errors';
const nftAbi=parseAbi(['function balanceOf(address account,uint256 id) view returns(uint256)']);
export function createInventoryReader(rpcUrl='https://base-rpc.publicnode.com') {
  const client=createPublicClient({chain:base,transport:http(rpcUrl,{timeout:15000,retryCount:1})});
  return async function read(address:Address,contract:Address|null) {
    if(await client.getChainId()!==8453)throw new SlotError('Chain','Il nodo RPC non è su Base.',503);
    const blockNumber=await client.getBlockNumber({cacheTime:0});
    const [balances,native,catalog]=await Promise.all([
      client.multicall({blockNumber,contracts:WALLET_ASSETS.flatMap(asset=>[{address:asset.address,abi:erc20Abi,functionName:'balanceOf',args:[address]},{address:asset.address,abi:erc20Abi,functionName:'decimals'}]),allowFailure:true}),
      client.getBalance({address,blockNumber}),
      contract?client.readContract({address:contract,abi:slotAbi,functionName:'getPrizeCatalog',blockNumber}).catch(()=>null):null,
    ]);
    const entries=catalog?catalog[0].map((symbol,i)=>({symbol,...catalog[1][i]})):[];
    const assets=WALLET_ASSETS.map((asset,i)=>{
      const balance=balances[i*2],decimals=balances[i*2+1];
      const verified=balance.status==='success'&&decimals.status==='success'&&decimals.result===asset.decimals;
      const configured=asset.id==='usdc'||entries.some(p=>p.kind===1&&p.symbol===asset.symbol&&p.token.toLowerCase()===asset.address.toLowerCase());
      return {...asset,balance:verified?String(balance.result):null,formatted:verified?formatUnits(BigInt(String(balance.result)),asset.decimals):null,verified,canDeposit:!!contract&&!!catalog&&configured};
    });
    const nfts=await Promise.all(NFT_PRIZES.map(async nft=>{
      const prize=entries.find(p=>p.symbol===nft.symbol&&p.kind===2);
      const amount=prize?await client.readContract({address:prize.token,abi:nftAbi,functionName:'balanceOf',args:[address,prize.tokenId],blockNumber}).catch(()=>null):null;
      return {...nft,token:prize?.token||null,tokenId:prize?.tokenId.toString()||null,balance:amount?.toString()??null};
    }));
    const freeSpins=contract?await client.readContract({address:contract,abi:slotAbi,functionName:'freeSpins',args:[address],blockNumber}).catch(()=>null):null;
    return {address,contract,block:blockNumber.toString(),updatedAt:Date.now(),eth:formatUnits(native,18),assets,nfts,freeSpins:freeSpins?.toString()??null,catalogAvailable:!!catalog};
  };
}
export type Inventory=Awaited<ReturnType<ReturnType<typeof createInventoryReader>>>;
