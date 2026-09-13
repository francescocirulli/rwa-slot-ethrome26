import type {Address,Hex} from 'viem';
type Source={id:Hex;owner:Address};
export type EnsRegistrationProgress={state:'registering'|'retrying';lastAttemptAt:number};
export function createEnsWorker({fromBlock,pageBlocks=1000n,head,events,complete,discover}:{fromBlock:bigint;pageBlocks?:bigint;head:()=>Promise<bigint>;events:(from:bigint,to:bigint)=>Promise<Source[]>;complete:(claim:Source)=>Promise<void>;discover?:()=>Promise<{claims:Source[];catchingUp:boolean}>}){
  if(pageBlocks<1n)throw new Error('Invalid ENS log page size');
  let cursor=fromBlock,running=false,stopped=false,catchingUp=false,timer:ReturnType<typeof setTimeout>|undefined;
  const pending=new Map<Hex,Source>();
  const progress=new Map<Hex,EnsRegistrationProgress>();
  async function tick(){
    if(running||stopped)return;running=true;catchingUp=false;
    try{
      const attempted=new Set<Hex>();
      async function completePending(){
        for(const [id,event]of pending){
          if(attempted.has(id))continue;attempted.add(id);
          const lastAttemptAt=Date.now();progress.set(id,{state:'registering',lastAttemptAt});
          try{await complete(event);pending.delete(id);progress.delete(id);}
          catch{progress.set(id,{state:'retrying',lastAttemptAt});console.warn(JSON.stringify({event:'ens.worker_claim_retry'}));}
        }
      }
      await completePending();
      let scanError:unknown,recentCatchUp=false;
      if(discover)try{const recent=await discover();recentCatchUp=recent.catchingUp;for(const claim of recent.claims)pending.set(claim.id,claim);}
      catch{console.warn(JSON.stringify({event:'ens.worker_recent_scan_failed'}));}
      // Registration takes priority over old history and survives scan outages.
      await completePending();
      try{
      const end=await head();
      for(let page=0;page<20&&cursor<=end&&pending.size<256;page++){
        const to=cursor+pageBlocks-1n>end?end:cursor+pageBlocks-1n;
        const batch=await events(cursor,to);
        for(const event of batch)pending.set(event.id,event);
        cursor=to+1n;
      }
      catchingUp=cursor<=end&&pending.size<256;
      }catch(error){scanError=error;catchingUp=false;console.warn(JSON.stringify({event:'ens.worker_scan_failed'}));}
      await completePending();
      catchingUp=catchingUp||recentCatchUp;
      if(scanError)throw scanError;
    }finally{running=false;}
  }
  function schedule(){if(stopped)return;timer=setTimeout(()=>{void tick().catch(()=>{}).finally(schedule);},catchingUp?1000:5000);timer.unref();}
  return {tick,enqueue:(claim:Source)=>{pending.set(claim.id,claim);},progress:(id:Hex)=>progress.get(id),start(){if(timer||stopped)return;void tick().catch(()=>{}).finally(schedule);},stop(){stopped=true;if(timer)clearTimeout(timer);},state:()=>({cursor,pending:pending.size,catchingUp})};
}
