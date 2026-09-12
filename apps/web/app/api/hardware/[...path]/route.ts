import {createHardware} from '@/lib/hardware';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const state = globalThis as typeof globalThis & {slotHardware?: ReturnType<typeof createHardware>};
export async function POST(request: Request) {
  const origin = process.env.APP_ORIGIN || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000');
  state.slotHardware ||= createHardware({origin: new URL(origin).origin, token: process.env.SLOT_HARDWARE_TOKEN});
  return state.slotHardware.handle(request);
}
