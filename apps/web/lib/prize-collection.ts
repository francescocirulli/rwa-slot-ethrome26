import {getAddress,isAddress,parseAbi,type Address} from 'viem';

export const BASE_PRIZE_COLLECTION = getAddress('0x8D411D8efCDb0d528E4F6659B44223264Fd0B719');
// Deployed launch IDs plus Magnet, verified on Base on 2026-09-12.
export const BASE_PRIZE_IDS: Record<number,string> = {0:'5',3:'1',8:'2',9:'3',10:'4'};
export const prizeCollectionAbi = parseAbi([
  'function balanceOf(address account,uint256 id) view returns(uint256)',
  'function owner() view returns(address)',
  'function pendingOwner() view returns(address)',
  'function tokenExists(uint256 tokenId) view returns(bool)',
  'function mint(address recipient,uint256 tokenId,uint256 amount)',
  'function acceptOwnership()',
  'function transferOwnership(address newOwner)',
  'function safeTransferFrom(address from,address to,uint256 id,uint256 amount,bytes data)',
]);
export function prizeCollectionAddress(value?:string): Address {
  if (!value) return BASE_PRIZE_COLLECTION;
  if (!isAddress(value)) throw new Error('Invalid SLOT_PRIZE1155_ADDRESS');
  return getAddress(value);
}
