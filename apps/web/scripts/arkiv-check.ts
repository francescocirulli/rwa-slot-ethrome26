// Read-only diagnostics. Never creates an entity or submits a transaction.
import {createPublicClient} from '@arkiv-network/sdk';
import {tiramisu} from '@arkiv-network/sdk/chains';
import {str,u64} from '@arkiv-network/sdk/attr';
import {eq,gte} from '@arkiv-network/sdk/query';
import {http,webSocket} from 'viem';
import {watchBlocks} from 'viem/actions';
import {arkivEndpoints} from '../lib/arkiv/config';
async function main() {
  const {httpUrl,wsUrl}=arkivEndpoints();
  const client=createPublicClient({chain:tiramisu,transport:http(httpUrl,{retryCount:0,timeout:12000})});
  const page=await client.select({key:true}).where(eq('project',str(process.env.ARKIV_PROJECT||'wall-street-slot-ethrome26')),gte('season',u64(1))).fetch();
  console.log(JSON.stringify({check:'compound-query',block:String(page.blockNumber),entities:page.entities.length}));
  const live=createPublicClient({chain:tiramisu,transport:webSocket(wsUrl,{retryCount:0,reconnect:{attempts:5,delay:1000}})});
  let blocks=0,errors=0,events=0;
  await new Promise<void>((resolve,reject)=>{
    const stops:(()=>void)[]=[];
    const timer=setTimeout(()=>{for(const stop of stops)stop();reject(new Error('No pushed block after reconnect within 45 seconds'));},45000);
    stops.push(live.watchEntityEvents({onEvent:()=>{events++;},onError:()=>{errors++;}}));
    stops.push(watchBlocks(live,{poll:false,onBlock(block){
      if(!block) return;
      blocks++;console.log(JSON.stringify({check:blocks===1?'before-drop':'after-reconnect',block:String(block.number)}));
      if(blocks===1) void live.transport.getRpcClient().then(rpc=>rpc.socket.close());
      else {clearTimeout(timer);for(const stop of stops)stop();console.log(JSON.stringify({check:'socket-recovery',blocks,errors,entityEvents:events}));resolve();}
    },onError:()=>{errors++;}}));
  });
}
main().then(()=>process.exit(0)).catch(()=>{console.error('Arkiv read-only diagnostic failed. Check network access and endpoint configuration.');process.exit(1);});
