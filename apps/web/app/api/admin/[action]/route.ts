import {getAdminRuntime} from '@/lib/admin/runtime';
export const dynamic='force-dynamic';
export const runtime='nodejs';
async function handle(request:Request,context:{params:Promise<{action:string}>}) {
  const {action}=await context.params;
  if(!['account','create','member','proof'].includes(action))return Response.json({error:'Non trovato.'},{status:404});
  return getAdminRuntime().handle(request,action as 'account'|'create'|'member'|'proof');
}
export const GET=handle;
export const POST=handle;
