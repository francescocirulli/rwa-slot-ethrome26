// Mark the simulated Privy path so tests can distinguish it from backend signing.
export const useWalletRequest=()=>((path:string,init:RequestInit)=>fetch(path,{...init,headers:{...init.headers,'X-Fixture-Privy':'1'}}));
