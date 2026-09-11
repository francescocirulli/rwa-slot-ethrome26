import {getSlotEngine} from '@/lib/slot/runtime';
import {serializable} from '@/lib/slot/config';
import {slotError} from '@/lib/slot/errors';
import {isAddress, type Address} from 'viem';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const slot = getSlotEngine();
    if (!slot) return Response.json({configured: false, reason: 'Il contratto non è ancora collegato.'}, {headers: {'Cache-Control': 'no-store'}});
    const query = new URL(request.url).searchParams;
    const player = query.get('player');
    if (player && !isAddress(player)) return Response.json({error: 'Wallet non valido.'}, {status: 400});
    const before = query.get('before');
    if (before && !/^[1-9][0-9]{0,77}$/.test(before)) return Response.json({error: 'Pagina non valida.'}, {status: 400});
    const data = query.get('view') === 'history' ? serializable(await slot.reader.history(before ? BigInt(before) : undefined)) :
      {...await slot.reader.snapshot(player as Address | undefined, query.get('view') === 'admin'), keeper: slot.health()};
    return Response.json(data, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {const safe = slotError(error); return Response.json({error: safe.message, code: safe.code}, {status: safe.status, headers: {'Cache-Control': 'no-store'}});}
}
