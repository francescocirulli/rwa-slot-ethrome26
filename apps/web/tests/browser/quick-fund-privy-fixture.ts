// Isolated browser fixture: only the hooks AdminAssets reads, no real Privy session.
export const usePrivy=()=>({getAccessToken:async()=> 'test-access'});
