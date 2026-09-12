// Isolated browser fixture: forward wallet-authorized requests to the mock server
// without Privy's signature channel. The app never sends real transactions here.
export const useWalletRequest=()=>((path:string,init:RequestInit)=>fetch(path,init));
