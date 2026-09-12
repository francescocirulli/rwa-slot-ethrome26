import type {WalletService} from './types';
import type {WelcomeService} from './welcome';

export function createAccountWelcomeHandler(wallets:WalletService|undefined,welcome:WelcomeService|undefined,origin:string) {
  const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization'}});
  return async(request:Request)=>{
    if(request.method!=='POST')return reply({error:'Method not allowed.'},405);
    if(request.headers.get('origin')!==origin)return reply({error:'Invalid origin.'},403);
    if(!wallets||!welcome)return reply({status:'unavailable',amount:'2'},503);
    const token=request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1];
    if(!token||token.length>16000)return reply({error:'Sign in to receive your welcome spins.'},401);
    let user;
    try{user=await wallets.authenticate(token);}catch{return reply({error:'Access not verified.'},401);}
    // No body, address or wallet ID supplied by the browser can select a payee.
    const wallet=user.wallets.find(item=>item.index===0)||user.wallets[0];
    if(!wallet)return reply({status:'checking',amount:'2'});
    return reply(await welcome.request(user,wallet));
  };
}
