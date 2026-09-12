'use client';
import {useEffect,useRef,useState} from 'react';
import type {WelcomeView} from '@/lib/welcome';
export function WelcomeBonus({getAccessToken,onGranted}:{getAccessToken:()=>Promise<string|null>;onGranted:()=>void}) {
  const [view,setView]=useState<WelcomeView>({status:'checking',amount:'2'});
  const callbacks=useRef({getAccessToken,onGranted});callbacks.current={getAccessToken,onGranted};
  useEffect(()=>{
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    async function claim(){
      try{
        const token=await callbacks.current.getAccessToken();
        if(!token)throw new Error('Sign in again');
        const response=await fetch('/api/account/welcome',{method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw new Error('Bonus temporarily unavailable');
        const result:WelcomeView=await response.json();
        if(cancelled)return;
        setView(result);
        if(result.status==='granted'){callbacks.current.onGranted();return;}
        if(result.status==='ineligible')return;
      }catch{if(!cancelled)setView({status:'unavailable',amount:'2'});}
      if(!cancelled)timer=setTimeout(claim,5000);
    }
    void claim();return()=>{cancelled=true;clearTimeout(timer);};
  },[]);
  if(view.status==='ineligible')return null;
  return <div className="phone-account-state" aria-label="Welcome spins" role="status"><span>WELCOME BONUS</span><b>{view.status==='granted'?'Your 2 welcome spins have been credited.':'Your 2 welcome spins are being credited…'}</b><small>{view.status==='granted'?'Granted once to your first Privy wallet. The wallet balance shows any spins left.':'No iPad pairing or wallet funds required. We retry automatically.'}</small></div>;
}
