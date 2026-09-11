import type {WalletAuthorization} from '../../lib/types';
import {authorizationPaths,walletAuthorizations} from '../../lib/wallet-authorization';
export const testSignature=(actor:string)=>Buffer.from(actor.padEnd(64,'.')).toString('base64');
export const testAuthorization=(actor='owner'):WalletAuthorization=>({sign_fns:[async()=>testSignature(actor)]});
export async function authorizedTestRequest(request:Request,userId:string,handle:(request:Request)=>Promise<Response>) {
 const path=new URL(request.url).pathname;
 if(!authorizationPaths.has(path))return handle(request);
 const channels=walletAuthorizations(),{id}=channels.create(userId,path),headers=new Headers(request.headers);headers.set('X-Wallet-Authorization',id);
 let settled=false;
 try{
  const operation=handle(new Request(request,{headers})).then(response=>{settled=true;return response;});
  const signing=(async()=>{while(true){const state=await channels.poll(id,userId);if(state.state==='done'||settled&&!state.claimed)return;if(state.challenge)channels.sign(id,userId,state.challenge.id,testSignature(userId));}})();
  return(await Promise.all([operation,signing]))[0];
 }finally{channels.cancel(id,userId);}
}
