import {parseAbi} from 'viem';
export const ensRegistrarAbi=parseAbi([
  'function backend() view returns(address)',
  'function registry() view returns(address)',
  'function expiry() view returns(uint64)',
  'function parentNode() view returns(bytes32)',
  'function claim(bytes32 id) view returns((address owner,string label,bool completed,bytes32 source,address resolver))',
  'function claimCount(address owner) view returns(uint256)',
  'function claimAt(address owner,uint256 index) view returns(bytes32)',
  'function labelClaim(bytes32 labelHash) view returns(bytes32)',
  'function reserve(bytes32 id,address owner,string label)',
  'function fulfill(bytes32 id,bytes32 source)',
]);
export const redemptionAbi=parseAbi([
  'function backend() view returns(address)',
  'function collection() view returns(address)',
  'function consumptions(bytes32 id) view returns(address owner,bytes32 labelHash,uint64 blockNumber)',
  'function authorizationHash(bytes32 claimId,address owner,bytes32 labelHash,uint64 deadline) view returns(bytes32)',
  'event VoucherConsumed(bytes32 indexed claimId,address indexed owner,bytes32 indexed labelHash)',
]);
export const ensRegistryAbi=parseAbi([
  'function getOwner(uint256 id) view returns(address)',
  'function getState(uint256 id) view returns((uint8 status,uint64 expiry,address latestOwner,uint256 tokenId,uint256 resource))',
  'function getSubregistry(string label) view returns(address)',
  'function getResolver(string label) view returns(address)',
  'event LabelRegistered(uint256 indexed tokenId,bytes32 indexed labelHash,string label,address owner,uint64 expiry,address indexed sender)',
]);
