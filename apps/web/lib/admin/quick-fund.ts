import {RWA_ASSETS} from '../assets';

// Reads the contract's per-round reserve (readFunding) and turns it into the
// operations needed to fund `turns` full rounds from the shared wallet.
// Only the six ERC20 RWA prizes are covered; ERC1155 prizes stay manual.
type FundingAsset = {kind:number;token:string;tokenId?:string;required:bigint|string;available:bigint|string;reserved?:bigint|string;balance?:bigint|string};
type BalanceAsset = {id:string;balance:string|null;verified?:boolean};
export type QuickFundItem = {
  id:string;name:string;ticker:string;address:string;decimals:number;symbol:number|null;logo:string;
  required:bigint;available:bigint;toFund:bigint;wallet:bigint|null;verified:boolean;toDeposit:bigint;toBuy:bigint;
};
export function buildQuickFundPlan({turns,funding,assets}:{turns:number;funding:{assets:readonly FundingAsset[]}|null|undefined;assets:readonly BalanceAsset[]}):QuickFundItem[] {
  if(!funding||!Number.isInteger(turns)||turns<1)return [];
  const plan:QuickFundItem[]=[];
  for(const stock of funding.assets){
    if(stock.kind!==1)continue;
    const catalog=RWA_ASSETS.find(asset=>asset.address.toLowerCase()===stock.token.toLowerCase());
    const balance=catalog?assets.find(asset=>asset.id===catalog.id):undefined;
    if(!catalog||!balance)continue;
    const required=BigInt(stock.required)*BigInt(turns);
    if(required===0n)continue;
    const available=BigInt(stock.available);
    const toFund=required>available?required-available:0n;
    const verified=balance.verified!==false&&balance.balance!==null;
    const wallet=verified&&balance.balance!==null?BigInt(balance.balance):null;
    const toDeposit=wallet===null?0n:wallet<toFund?wallet:toFund;
    const toBuy=wallet===null?toFund:toFund>wallet?toFund-wallet:0n;
    plan.push({id:catalog.id,name:catalog.name,ticker:catalog.ticker,address:catalog.address,decimals:catalog.decimals,symbol:catalog.symbol,logo:catalog.logo,required,available,toFund,wallet,verified,toDeposit,toBuy});
  }
  return plan;
}
