import {getAddress, parseUnits, type Address} from 'viem';
import {USDC} from './types';
export type Asset = {id:string; name:string; ticker:string; address:Address; decimals:number; symbol:number|null; logo:string};
// Base metadata verified with ERC20 symbol()/decimals(), 2026-09-11. Numeric IDs match foundry-slot.
export const RWA_ASSETS:readonly Asset[] = [
  {id:'nvidia',name:'NVIDIA',ticker:'NVDAc',address:getAddress('0xb20000000000000000000078ee7ce2fe4908108c'),decimals:8,symbol:2,logo:'/brands/nvidia.svg'},
  {id:'spacex',name:'SpaceX',ticker:'SPCXc',address:getAddress('0xb2000000000000000000007b9fcbd005511acbd5'),decimals:8,symbol:4,logo:'/brands/spacex.svg'},
  {id:'apple',name:'Apple',ticker:'AAPLc',address:getAddress('0xb200000000000000000000c2e324d24d7eecd1fb'),decimals:8,symbol:5,logo:'/brands/apple.svg'},
  {id:'alphabet',name:'Alphabet',ticker:'GOOGLc',address:getAddress('0xb2000000000000000000002d0ba3164cc74f58b7'),decimals:8,symbol:6,logo:'/brands/alphabet.png'},
  {id:'amazon',name:'Amazon',ticker:'AMZNc',address:getAddress('0xb200000000000000000000d9192b6b456483c2e8'),decimals:8,symbol:7,logo:'/brands/amazon.svg'},
  {id:'gold',name:'Gold',ticker:'DGLD',address:getAddress('0xe908475f8beb7a138b0dc6eb5a05cb27068ffb9a'),decimals:18,symbol:11,logo:'/brands/gold.svg'},
];
export const PAYMENT_ASSET:Asset={id:'usdc',name:'USDC',ticker:'USDC',address:USDC,decimals:6,symbol:null,logo:'/brands/usdc.svg'};
export const ETH_ASSET:Asset={id:'eth',name:'Ethereum',ticker:'ETH',address:'0x0000000000000000000000000000000000000000',decimals:18,symbol:null,logo:'/brands/eth.png'};
export const SWAP_INPUTS=[PAYMENT_ASSET,ETH_ASSET] as const;
export const WALLET_ASSETS=[PAYMENT_ASSET,...RWA_ASSETS];
export const NFT_PRIZES=[{symbol:0,name:'Magnete',key:'MAGNET'},{symbol:3,name:'Gadget',key:'GADGET'},{symbol:8,name:'ENS Registration',key:'ENS_REGISTRATION'},{symbol:9,name:'Urbe Hub Day Pass',key:'URBE_HUB_DAY_PASS'},{symbol:10,name:'T-shirt',key:'SHIRT'}] as const;
export const PRIZE_LABELS=['MAGNETE','FREE SPIN','NVIDIA','GADGET','SPACEX','APPLE','ALPHABET','AMAZON','ENS','URBE PASS','T-SHIRT','GOLD','SYMBOL 12','SYMBOL 13','SYMBOL 14','SYMBOL 15'] as const;
export function assetByAddress(address:string){return WALLET_ASSETS.find(asset=>asset.address.toLowerCase()===address.toLowerCase());}
export function assetUnits(value:unknown,decimals:number):bigint {
  if(typeof value!=='string'||!new RegExp('^(0|[1-9][0-9]{0,30})(\\.[0-9]{1,'+decimals+'})?$').test(value))throw new Error('Inserisci un importo positivo, con massimo '+decimals+' decimali.');
  const amount=parseUnits(value,decimals);if(amount<=0n||amount>=2n**256n)throw new Error('Importo non valido.');return amount;
}
