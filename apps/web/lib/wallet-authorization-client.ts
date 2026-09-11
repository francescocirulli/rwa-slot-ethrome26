'use client';
import {useEffect,useRef} from 'react';
import {usePrivy,useAuthorizationSignature} from '@privy-io/react-auth';
import {runWalletRequest} from './wallet-authorization-flow';
export function useWalletRequest() {
  const {getAccessToken,user,authenticated}=usePrivy();
  const {generateAuthorizationSignature}=useAuthorizationSignature();
  const current=useRef<string|undefined>(undefined),alive=useRef(true);
  current.current=authenticated?user?.id:undefined;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  return (path:string,init:RequestInit)=>{
    const expected=current.current;
    return runWalletRequest(path,init,{getAccessToken,sign:generateAuthorizationSignature,
      valid:()=>{if(!alive.current||!expected||current.current!==expected)throw new Error('Account cambiato. Operazione interrotta.');}});
  };
}
