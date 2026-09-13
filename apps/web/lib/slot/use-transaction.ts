'use client';
import {useEffect, useRef, useState} from 'react';
import {usePrivy} from '@privy-io/react-auth';
import type {Hex} from 'viem';
import type {GasMode, GasToken} from './gas';
import {useWalletRequest} from '@/lib/wallet-authorization-client';
export type TransactionReview = {id:string;address:string;signerAddress?:string;signer?:'privy'|'backend';action:string;args:string[];expiresAt:number;transaction:{to:string;data:Hex;chainId:number;gasMode:GasMode}};
type Pending = {id?:string;hash?:Hex};
class TransactionApiError extends Error {constructor(message:string,public pending?:Pending,public code?:string,public status?:number){super(message);}}
export function useContractTransaction(address:string,adminUserId?:string) {
  const {getAccessToken}=usePrivy();
  const walletRequest=useWalletRequest();
  const [busy,setBusy]=useState(false),[pending,setPending]=useState<Pending|null>(null),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(0);
  const [unrecoverable,setUnrecoverable]=useState(false);
  const [review,setReview]=useState<TransactionReview|null>(null),[gasToken,setGasToken]=useState<GasToken|null>(null);
  const lock=useRef(false),owner=useRef(address),alive=useRef(true),decision=useRef<((value:boolean)=>void)|null>(null);
  owner.current=address;
  const storageKey='slot-contract-tx:'+(adminUserId?'admin:'+adminUserId+':':'')+address.toLowerCase();
  const endpoint=adminUserId?'/api/admin/contract/':'/api/contract/';
  useEffect(()=>{
    alive.current=true;setPending(null);setError('');setUnrecoverable(false);
    try{const saved=sessionStorage.getItem(storageKey);if(saved){const value=/^0x[a-fA-F0-9]{64}$/.test(saved)?{hash:saved}:JSON.parse(saved);if(value&&(/^[a-f0-9]{64}$/.test(value.id||'')||/^0x[a-fA-F0-9]{64}$/.test(value.hash||'')))setPending(value);}}catch{}
    return()=>{alive.current=false;decision.current?.(false);decision.current=null;};
  },[storageKey]);
  function valid(){if(!alive.current||owner.current!==address)throw new Error('Account cambiato. Operazione interrotta.');}
  async function responseValue(response:Response){
    const value=await response.json().catch(()=>{throw new TransactionApiError('Verification unavailable.',undefined,undefined,response.status);});
    if(!response.ok)throw new TransactionApiError(value.error||'Operation unavailable.',value.pending,value.code,response.status);
    return value;
  }
  async function api(path:string,body?:unknown,backend=false){
    valid();const token=await getAccessToken();valid();if(!token)throw new Error('Accedi di nuovo per verificare il wallet.');
    const response=await (path==='send'&&!backend?walletRequest:fetch)(endpoint+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json','X-Slot-Request':'1'})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(25000)});
    const value=await responseValue(response);valid();return value;
  }
  function remember(value:Pending){
    // Only public identifiers, never credentials. Persist BEFORE the send can start.
    sessionStorage.setItem(storageKey,JSON.stringify(value));setPending(value);setUnrecoverable(false);
  }
  function clear(){sessionStorage.removeItem(storageKey);setPending(null);}
  async function wait(value:Pending){
    const until=Date.now()+180000;
    for(let attempt=0;attempt<90&&Date.now()<until;attempt++){
      valid();
      let state;
      try {
        // Once the hash is known, recovery only needs the chain, even after a server restart.
        state=value.hash?await fetch('/api/contract/receipt?hash='+value.hash,{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(responseValue):await api('status?id='+value.id);
      } catch(cause){
        valid();
        // An operation without a hash is kept in server memory only: after a restart the
        // server cannot find it. Surface it and let the user verify onchain and discard it.
        if(!value.hash&&cause instanceof TransactionApiError&&cause.code==='UnknownOperation'){
          setUnrecoverable(true);
          throw new Error('The request was lost when the service restarted and cannot be recovered. Verify the contract on Base, then discard it to continue.');
        }
        const retryable=cause instanceof TransactionApiError
          ? cause.status===408||cause.status===429||!!cause.status&&cause.status>=500
          : cause instanceof TypeError||cause instanceof Error&&['AbortError','TimeoutError'].includes(cause.name);
        if(!retryable)throw cause;
        setError('Confirmation temporarily unavailable. Retrying the same transaction; do not approve again.');
        await new Promise(resolve=>setTimeout(resolve,2000));
        continue;
      }
      valid();setError('');if(state.gasToken)setGasToken(state.gasToken);
      if(state.hash&&state.hash!==value.hash){value={...value,hash:state.hash};remember(value);}
      const stage=state.stage||state.status;
      if(stage==='confirmed'){clear();setConfirmed(count=>count+1);return;}
      if(['failed','cancelled','reverted'].includes(stage)||stage==='prepared'&&state.canConfirm!==false){
        if(stage==='prepared'&&value.id)await api('cancel',{id:value.id});
        clear();throw new Error(state.error||(stage==='prepared'?'The transaction was not sent. You can try again.':'Operation not completed.'));
      }
      if(stage==='uncertain'&&!state.hash){setError(state.error||'Send under verification. Do not send a second request.');}
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    throw new Error('Transaction still under verification. Use “Check” without sending it again.');
  }
  async function check(){
    if(!pending||lock.current)return;lock.current=true;setBusy(true);setError('');
    try{await wait(pending);}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'Verification unavailable.');}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  async function execute(action:string,args:string[]){
    if(lock.current||pending)throw new Error('Check the transaction already sent first.');
    lock.current=true;setBusy(true);setError('');setGasToken(null);setUnrecoverable(false);
    let prepared:TransactionReview|undefined,submitted=false;
    try{
      prepared=await api('prepare',{action,args});
      if(!prepared||prepared.address.toLowerCase()!==address.toLowerCase())throw new Error('Wallet mismatch.');
      setReview(prepared);
      const accepted=await new Promise<boolean>(resolve=>{decision.current=resolve;});
      decision.current=null;setReview(null);
      if(!accepted)throw new Error('Operation cancelled.');
      valid();
      let value:Pending={id:prepared.id};remember(value);submitted=true;
      const sent=await api('send',{id:prepared.id,confirm:true},prepared.signer==='backend');
      if(/^0x[a-fA-F0-9]{64}$/.test(sent.hash||'')){value={...value,hash:sent.hash};remember(value);}
      await wait(value);
    }catch(cause){
      if(cause instanceof TransactionApiError&&cause.pending?.id){valid();remember(cause.pending);}
      if(prepared&&!submitted&&alive.current)await api('cancel',{id:prepared.id}).catch(()=>{});
      const message=cause instanceof Error?cause.message:'Operation unavailable.';
      if(alive.current)setError(message);throw new Error(message);
    }finally{decision.current=null;lock.current=false;if(alive.current){setBusy(false);setReview(null);}}
  }
  function discard(){
    // Only a request the server no longer knows and that carries no hash may be abandoned.
    if(!unrecoverable)return;clear();setUnrecoverable(false);setError('');
  }
  return {execute,check,discard,busy,hash:pending?.hash||null,pending:!!pending,unrecoverable,error,confirmed,review,gasToken,decide:(accept:boolean)=>decision.current?.(accept)};
}
