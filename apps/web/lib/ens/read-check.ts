import {SlotError} from '../slot/errors';

type Phase='review'|'send-check';
function temporary(error:unknown){
 if(error instanceof SlotError)return false;
 let cause=error;
 for(let depth=0;cause&&typeof cause==='object'&&depth<8;depth++){
  const item=cause as {name?:string;status?:number;code?:number;message?:string;details?:string;cause?:unknown};
  if(item.status===401||item.status===403||item.name==='ContractFunctionRevertedError')return false;
  if(item.status===408||item.status===429||item.status!==undefined&&item.status>=500||item.name==='TimeoutError'||item.name==='AbortError')return true;
  if(item.name==='HttpRequestError'&&item.status===undefined||item.name==='TypeError'&&/fetch|network/i.test(item.message||''))return true;
  if(item.code===-32005||/(?:request|rate) limit|quota|too many requests|RPC providers are temporarily unavailable/i.test(item.details||item.message||''))return true;
  cause=item.cause;
 }
 return false;
}
// Only read-only eligibility checks belong here. Never wrap wallet submission,
// reservation or fulfillment: an unknown send must retain its original identity.
export async function retryEnsRead<T>(phase:Phase,read:()=>Promise<T>,sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))):Promise<T>{
 for(let attempt=0;;attempt++){
  try{return await read();}catch(error){
   if(!temporary(error)||attempt>=2){console.warn(JSON.stringify({event:'ens.read_failed',phase}));throw error;}
   console.warn(JSON.stringify({event:'ens.read_retry',phase,attempt:attempt+1}));
   // Allow the shared Base live-read pool's five-second recovery probe to open.
   await sleep(attempt===0?1000:5000);
  }
 }
}
