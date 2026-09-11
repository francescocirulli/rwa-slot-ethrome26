import {getContractApi} from '@/lib/slot/transaction-runtime';
export const dynamic='force-dynamic';
export const runtime='nodejs';
async function handle(request:Request,context:{params:Promise<{action:string}>}) {
  const {action}=await context.params;
  if(!['prepare','send','status','cancel'].includes(action))return Response.json({error:'Non trovato.'},{status:404});
  return getContractApi().handle(request,action as 'prepare'|'send'|'status'|'cancel','admin');
}
export const GET=handle;
export const POST=handle;
