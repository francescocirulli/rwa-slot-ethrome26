import {getRelay} from '@/lib/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {return await getRelay().handle(request);}
  catch {return Response.json({error: 'Terminal temporarily unavailable.'}, {status: 503, headers: {'Cache-Control': 'no-store'}});}
}
export {handle as GET, handle as POST};
