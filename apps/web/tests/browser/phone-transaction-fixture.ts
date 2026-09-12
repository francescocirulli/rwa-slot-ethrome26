import {useRef,useState} from 'react';
import type {TransactionReview} from '../../lib/slot/use-transaction';
export function useContractTransaction(address:string) {
  const [review,setReview]=useState<TransactionReview|null>(null),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(0);
  const decision=useRef<(accept:boolean)=>void>(()=>{});
  return {review,busy,confirmed,pending:false,unrecoverable:false,error:'',hash:null,gasToken:null,check:async()=>{},discard:()=>{},decide:(accept:boolean)=>decision.current(accept),
    execute:async(action:string,args:string[])=>{
      setBusy(true);setReview({id:'fixture',address,action,args,expiresAt:Date.now()+300000,transaction:{to:args[0]?.startsWith('0x')?args[0]:'0x0000000000000000000000000000000000000099',data:'0x',chainId:8453,gasMode:'usdc'}});
      try {
        const accepted=await new Promise<boolean>(resolve=>{decision.current=resolve;});
        if(!accepted)throw new Error('Operazione annullata.');
        document.body.dataset.submitted=JSON.stringify({action,args});setConfirmed(value=>value+1);
      }finally {setBusy(false);setReview(null);}
    }};
}
