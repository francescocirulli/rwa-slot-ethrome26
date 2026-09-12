import {getSeasonService} from '@/lib/arkiv/runtime';
import {ExplorerError,parseExplorer} from '@/lib/arkiv/explorer';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  try {
    const filters=parseExplorer(new URL(request.url).searchParams);
    const service=getSeasonService();
    if(!service)return Response.json({error:'The game archive is not configured yet.'},{status:503});
    const result=await service.explore(filters);
    return Response.json({...result,indexing:service.snapshot().indexing},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return Response.json({error:error instanceof ExplorerError?error.message:'The game archive is temporarily unavailable. Please retry.'},{status:error instanceof ExplorerError?error.status:503,headers:{'Cache-Control':'no-store'}});}
}
