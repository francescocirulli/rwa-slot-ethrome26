import {emptyView} from './model';
import {getSeasonService} from './runtime';
export function leaderboardResponse() {
  try {return Response.json(getSeasonService()?.snapshot() || emptyView(),{headers:{'Cache-Control':'no-store'}});}
  catch {return Response.json({...emptyView(),status:'unavailable',message:'Season leaderboard is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export function leaderboardStream(request:Request) {
  let service:ReturnType<typeof getSeasonService>;
  try {service=getSeasonService();} catch {return new Response('Leaderboard unavailable',{status:503});}
  const encoder = new TextEncoder();
  let cleanup = ()=>{};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false, unsubscribe = ()=>{}, heartbeat:ReturnType<typeof setInterval>|undefined;
      cleanup = ()=>{if(closed) return;closed=true;unsubscribe();if(heartbeat) clearInterval(heartbeat);request.signal.removeEventListener('abort',cleanup);try {controller.close();} catch {}};
      const send = (text:string)=>{if(closed) return;try {if((controller.desiredSize ?? 0) < -8) {cleanup();return;}controller.enqueue(encoder.encode(text));} catch {cleanup();}};
      try {
        send('retry: 3000\n\n');
        if(service) unsubscribe=service.subscribe(view=>send(`event: standings\ndata: ${JSON.stringify(view)}\n\n`));
        else send(`event: standings\ndata: ${JSON.stringify(emptyView())}\n\n`);
        heartbeat=setInterval(()=>send(': heartbeat\n\n'),15000);heartbeat.unref();
        request.signal.addEventListener('abort',cleanup,{once:true});
        if(request.signal.aborted) cleanup();
      } catch {cleanup();}
    },cancel(){cleanup();},
  });
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'}});
}
