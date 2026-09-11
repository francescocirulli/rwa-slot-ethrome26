import {getAdminRuntime} from '@/lib/admin/runtime';
export const dynamic='force-dynamic';
export const runtime='nodejs';
async function handle(request:Request,context:{params:Promise<{action:string}>}){
  const {action}=await context.params;
  if(!['inventory','quote','execute','status'].includes(action))return Response.json({error:'Non trovato.'},{status:404});
  return getAdminRuntime().assets(request,action as 'inventory'|'quote'|'execute'|'status');
}
export const GET=handle;
export const POST=handle;
