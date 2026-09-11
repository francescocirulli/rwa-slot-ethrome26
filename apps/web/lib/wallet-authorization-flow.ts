type Options={getAccessToken:()=>Promise<string|null>;sign:(bytes:Uint8Array)=>Promise<{signature:string}>;valid:()=>void;fetch?:typeof fetch};

// Keep the original request alive while Privy's browser SDK signs the exact
// bytes requested by the server SDK. Neither tokens nor keys authorize a wallet
// operation on the backend; only the user's request-specific signature does.
export async function runWalletRequest(path:string,init:RequestInit,options:Options):Promise<Response> {
  const request=options.fetch??fetch,controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),90000);
  let id:string|undefined,settled=false,response:Response|undefined;
  const check=()=>{controller.signal.throwIfAborted();options.valid();};
  async function channel(body:object,closing=false) {
    if(!closing)check();
    const token=await options.getAccessToken();
    if(!token)throw new Error('Accedi di nuovo per autorizzare il wallet.');
    if(!closing)check();
    const result=await request('/api/wallet-authorization',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Slot-Request':'1'},
      body:JSON.stringify(body),cache:'no-store',signal:closing?AbortSignal.timeout(5000):controller.signal});
    const value=await result.json();if(!result.ok)throw new Error(value.error||'Autorizzazione wallet non disponibile.');return value;
  }
  try {
    id=(await channel({action:'create',path})).id;
    if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new Error('Autorizzazione wallet non valida.');
    check();const headers=new Headers(init.headers);headers.set('X-Wallet-Authorization',id);
    const operation=request(path,{...init,headers,signal:controller.signal}).then(result=>{settled=true;response=result;return result;});
    const signing=(async()=>{
      while(true){
        check();
        if(settled&&!response?.ok)return;
        const state=await channel({action:'poll',id});check();
        if(state.state==='done'||settled&&!state.claimed)return;
        if(state.state!=='sign')continue;
        const challenge=state.challenge;
        if(!challenge||typeof challenge.payload!=='string'||challenge.payload.length>180000||typeof challenge.id!=='string')throw new Error('Richiesta di firma non valida.');
        const bytes=Uint8Array.from(atob(challenge.payload),character=>character.charCodeAt(0));
        let signed:{signature:string};
        try{signed=await options.sign(bytes);}catch{throw new Error('Autorizzazione Privy non completata. Accedi di nuovo e riprova.');}
        check();await channel({action:'sign',id,challengeId:challenge.id,signature:signed.signature});
      }
    })();
    const [result]=await Promise.all([operation,signing]);
    // Consume the response before aborting the channel's shared controller.
    // Otherwise fetch can succeed while the caller's response.json() is aborted.
    return new Response(await result.arrayBuffer(),{status:result.status,statusText:result.statusText,headers:result.headers});
  }finally{
    clearTimeout(timer);controller.abort();
    if(id)await channel({action:'cancel',id},true).catch(()=>{});
  }
}
