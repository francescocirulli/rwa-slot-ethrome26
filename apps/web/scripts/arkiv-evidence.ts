// Read-only Mission 02 evidence: the same season predicate before and after expiry.
import {watchBlocks} from 'viem/actions';
import {loadArkivConfig} from '../lib/arkiv/config';
import {loadSlotConfig} from '../lib/slot/config';
import {createSlotReader} from '../lib/slot/reader';
import {createArkivStore} from '../lib/arkiv/store';
import {seasonAt} from '../lib/arkiv/model';
class EvidenceError extends Error {}
async function main() {
  const config=loadArkivConfig(),slot=loadSlotConfig();
  if(!config||!slot) throw new EvidenceError('Configure Arkiv and the source contract');
  const store=createArkivStore({...config,privateKey:undefined},createSlotReader(slot));
  const head=await store.publicClient.getBlockNumber();
  const season=seasonAt(head,config.anchor,config.seasonBlocks);
  if(!season) throw new EvidenceError('Wait for the first season');
  if(season.endBlock-head>150n) throw new EvidenceError('Use a short demo season with less than five minutes remaining');
  const startTime=(await store.publicClient.getBlock({blockNumber:season.startBlock})).timestamp;
  const before=await store.contributions(season,head,startTime);
  if(!before.length) throw new EvidenceError('First publish a confirmed spin in the current season');
  console.log(JSON.stringify({phase:'before',season:season.id,block:String(head),expiresAt:String(season.endBlock),entities:before.length,gameIds:before.map(row=>row.gameId)}));
  await new Promise<void>((resolve,reject)=>{
    let done=false,stop=()=>{};
    const timer=setTimeout(()=>{stop();reject(new EvidenceError('Timed out waiting for expiry'));},360000);
    async function check(block:bigint) {
      if(done||block<season!.endBlock) return;done=true;clearTimeout(timer);stop();
      try {
        const after=await store.contributions(season!,block,startTime);
        console.log(JSON.stringify({phase:'after',season:season!.id,block:String(block),entities:after.length,deleteCalls:0}));
        if(after.length) throw new EvidenceError('Expired entities still returned');resolve();
      } catch(error) {reject(error);}
    }
    stop=watchBlocks(store.liveClient,{poll:false,onBlock:block=>{if(block) void check(block.number);},onError:()=>{}});
    void store.publicClient.getBlockNumber().then(check).catch(reject);
  });
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error instanceof EvidenceError ? error.message : 'Evidence query failed. Check endpoint configuration.');process.exit(1);});
