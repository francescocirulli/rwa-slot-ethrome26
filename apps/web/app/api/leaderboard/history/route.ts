import {isAddress} from 'viem';
import {getSeasonService} from '@/lib/arkiv/runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const player=new URL(request.url).searchParams.get('player');
  if(!player || !isAddress(player)) return Response.json({error:'A valid public wallet address is required.'},{status:400});
  try {return Response.json({spins:await getSeasonService()?.history(player)||[]},{headers:{'Cache-Control':'no-store'}});}
  catch {return Response.json({error:'Spin history is temporarily unavailable.'},{status:503});}
}
