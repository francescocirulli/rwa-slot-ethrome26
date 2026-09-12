// Browser-only SDK fixture. No real authentication, keys, signatures or RPC.
import {useSyncExternalStore} from 'react';
const address='0x0000000000000000000000000000000000000011';
let authenticated=true;
const listeners=new Set<()=>void>();
function subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
function login(){authenticated=true;listeners.forEach(fn=>fn());return Promise.resolve();}
const logout=async()=>{authenticated=false;listeners.forEach(fn=>fn());};
const getAccessToken=async()=>'browser-fixture-only';
const user={id:'fixture-user',email:{address:'player@example.test'},linkedAccounts:[{type:'wallet',walletClientType:'privy',address}]};
const wallets=[{walletClientType:'privy',address}];
export const PrivyProvider=({children}:{children:React.ReactNode;[key:string]:unknown})=>children;
export function usePrivy(){const active=useSyncExternalStore(subscribe,()=>authenticated);return {ready:true,authenticated:active,user:active?user:null,getAccessToken,logout};}
export const useLoginWithEmail=()=>({sendCode:async()=>{},loginWithCode:login});
export const useLoginWithPasskey=()=>({loginWithPasskey:login});
export const useSignupWithPasskey=()=>({signupWithPasskey:login});
export const useLinkWithPasskey=()=>({linkWithPasskey:async()=>{}});
export const useCreateWallet=()=>({createWallet:async()=>({address})});
export const useWallets=()=>({wallets,ready:true});
export const useSigners=()=>({addSigners:async()=>{}});
