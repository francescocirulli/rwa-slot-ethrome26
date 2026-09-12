'use client';
import {useEffect, useRef, useState} from 'react';
import {usePrivy} from '@privy-io/react-auth';
import type {Hex} from 'viem';
import type {GasMode, GasToken} from './gas';
import {useWalletRequest} from '../wallet-authorization-client';
export type TransactionReview = {id:string;address:string;action:string;args:string[];expiresAt:number;transaction:{to:string;data:Hex;chainId:number;gasMode:GasMode}};
type Pending = {id?:string;hash?:Hex};
class TransactionApiError extends Error {constructor(message:string,public pending?:Pending){super(message);}}
export function useContractTransaction(address:string,adminUserId?:string) {
  const {getAccessToken}=usePrivy();
  const walletRequest=useWalletRequest();
  const [busy,setBusy]=useState(false),[pending,setPending]=useState<Pending|null>(null),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(0);
  const [review,setReview]=useState<TransactionReview|null>(null),[gasToken,setGasToken]=useState<GasToken|null>(null);
  const lock=useRef(false),owner=useRef(address),alive=useRef(true),decision=useRef<((value:boolean)=>void)|null>(null);
  owner.current=address;
  const storageKey='slot-contract-tx:'+(adminUserId?'admin:'+adminUserId+':':'')+address.toLowerCase();
  const endpoint=adminUserId?'/api/admin/contract/':'/api/contract/';
  useEffect(()=>{
    alive.current=true;setPending(null);setError('');
    try{const saved=sessionStorage.getItem(storageKey);if(saved){const value=/^0x[a-fA-F0-9]{64}$/.test(saved)?{hash:saved}:JSON.parse(saved);if(value&&(/^[a-f0-9]{64}$/.test(value.id||'')||/^0x[a-fA-F0-9]{64}$/.test(value.hash||'')))setPending(value);}}catch{}
    return()=>{alive.current=false;decision.current?.(false);decision.current=null;};
  },[storageKey]);
  function valid(){if(!alive.current||owner.current!==address)throw new Error('Account cambiato. Operazione interrotta.');}
  async function api(path:string,body?:unknown){
    valid();const token=await getAccessToken();valid();if(!token)throw new Error('Accedi di nuovo per verificare il wallet.');
    const response=await (path==='send'?walletRequest:fetch)(endpoint+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json','X-Slot-Request':'1'})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(25000)});
    const value=await response.json();valid();if(!response.ok)throw new TransactionApiError(value.error||'Operation unavailable.',value.pending);return value;
  }
  function remember(value:Pending){
    // Only public identifiers, never credentials. Persist BEFORE the send can start.
    sessionStorage.setItem(storageKey,JSON.stringify(value));setPending(value);
  }
  function clear(){sessionStorage.removeItem(storageKey);setPending(null);}
  async function wait(value:Pending){
    for(let attempt=0;attempt<90;attempt++){
      valid();
      // Once the hash is known, recovery only needs the chain, even after a server restart.
      const state=value.hash?await fetch('/api/contract/receipt?hash='+value.hash,{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(async response=>{if(!response.ok)throw new Error('Verification unavailable.');return response.json();}):await api('status?id='+value.id);
      valid();if(state.gasToken)setGasToken(state.gasToken);
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
    lock.current=true;setBusy(true);setError('');setGasToken(null);
    let prepared:TransactionReview|undefined,submitted=false;
    try{
      prepared=await api('prepare',{action,args});
      if(!prepared||prepared.address.toLowerCase()!==address.toLowerCase())throw new Error('Wallet mismatch.');
      setReview(prepared);
      const accepted=await new Promise<boolean>(resolve=>{decision.current=resolve;});
      decision.current=null;setReview(null);
      if(!accepted)throw new Error('Operation cancelled.');
      valid();
      const value={id:prepared.id};remember(value);submitted=true;
      await api('send',{id:prepared.id,confirm:true});
      await wait(value);
    }catch(cause){
      if(cause instanceof TransactionApiError&&cause.pending?.id){valid();remember(cause.pending);}
      if(prepared&&!submitted&&alive.current)await api('cancel',{id:prepared.id}).catch(()=>{});
      const message=cause instanceof Error?cause.message:'Operation unavailable.';
      if(alive.current)setError(message);throw new Error(message);
    }finally{decision.current=null;lock.current=false;if(alive.current){setBusy(false);setReview(null);}}
  }
  return {execute,check,busy,hash:pending?.hash||null,pending:!!pending,error,confirmed,review,gasToken,decide:(accept:boolean)=>decision.current?.(accept)};
}
