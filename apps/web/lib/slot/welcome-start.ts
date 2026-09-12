import type {SlotReader} from './reader';

// Only call with the creation timestamp returned by Privy's server wallet API
// for a generated (never imported) wallet. The user cannot supply this bound.
export async function welcomeStartBlock(reader:SlotReader, createdAt:number) {
  const latest=await reader.client.getBlock({blockTag:'latest'});
  const target=BigInt(Math.max(0,Math.floor(createdAt/1000)-300));
  let low=reader.config.deploymentBlock,high=latest.number;
  if(high<low)throw new Error('Deployment is not available');
  // Include five minutes before key creation and the block preceding the cutoff.
  // Never use the configurable player-history floor for bonus deduplication.
  while(low<high){
    const middle=(low+high)/2n;
    const block=await reader.client.getBlock({blockNumber:middle});
    if(block.timestamp<target)low=middle+1n;else high=middle;
  }
  return low>reader.config.deploymentBlock?low-1n:reader.config.deploymentBlock;
}
