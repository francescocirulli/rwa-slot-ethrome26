import type {Address,Hex} from 'viem';
type Source={id:Hex;owner:Address};
export function createEnsWorker({fromBlock,pageBlocks=1000n,head,events,complete}:{fromBlock:bigint;pageBlocks?:bigint;head:()=>Promise<bigint>;events:(from:bigint,to:bigint)=>Promise<Source[]>;complete:(claim:Source)=>Promise<void>}){
  if(pageBlocks<1n)throw new Error('Invalid ENS log page size');
  let cursor=fromBlock,running=false,stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
  const pending=new Map<Hex,Source>();
  async function tick(){
    if(running||stopped)return;running=true;
    try{
      const end=await head();
      for(let page=0;page<20&&cursor<=end&&pending.size<256;page++){
        const to=cursor+pageBlocks-1n>end?end:cursor+pageBlocks-1n;
        const batch=await events(cursor,to);
        for(const event of batch)pending.set(event.id,event);
        cursor=to+1n;
      }
      for(const [id,event]of pending){
        try{await complete(event);pending.delete(id);}catch{/* Keep the onchain claim pending; reconcile on the next tick. */}
      }
    }finally{running=false;}
  }
  function schedule(){if(stopped)return;timer=setTimeout(()=>{void tick().catch(()=>{}).finally(schedule);},15000);timer.unref();}
  return {tick,start(){if(timer||stopped)return;void tick().catch(()=>{}).finally(schedule);},stop(){stopped=true;if(timer)clearTimeout(timer);},state:()=>({cursor,pending:pending.size})};
}
