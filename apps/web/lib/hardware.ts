import {createHash, randomBytes, randomInt, timingSafeEqual} from 'node:crypto';

type Command = {cmd: 'idle' | 'attract' | 'ready' | 'blocked' | 'spin' | 'result'; tier?: number; hub?: boolean; l1?: string; l2?: string};
type InputEvent = {evt: 'motion' | 'lever'; gate?: string};
const digest = (s: string) => createHash('sha256').update(s).digest();
const safe = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
const idle: Command = {cmd: 'idle'};

// One physical machine / one bound kiosk, on the existing single service replica.
// This transport cannot sign transactions or extend a player session.
export function createHardware({origin, token, now = Date.now}: {origin: string; token?: string; now?: () => number}) {
  let binding = '', code = '', codeUntil = 0, attempts = 0, attemptUntil = 0;
  let deviceSeen = 0, deviceOnline = false, tabletSeen = 0, gate = '', consumedGate = '';
  let command: Command = idle, commandUntil = 0;
  let events: (InputEvent & {at: number})[] = [];
  let deviceId = '', sequence = 0;
  const response = (data: unknown, status = 200, cookie?: string) => new Response(JSON.stringify(data), {status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cookie ? {'Set-Cookie': cookie} : {})}});
  return {async handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (!token || token.length < 32) return response({error: 'Hardware not configured.'}, 503);
    if (req.method !== 'POST') return response({error: 'Method not allowed.'}, 405);
    const device = path === '/api/hardware/device';
    if (device) {
      if (!safe(req.headers.get('authorization') || '', 'Bearer ' + token)) return response({error: 'Invalid access.'}, 401);
    } else if (req.headers.get('origin') !== origin || req.headers.get('x-slot-request') !== '1') return response({error: 'Invalid origin.'}, 403);
    if (!req.headers.get('content-type')?.startsWith('application/json')) return response({error: 'Invalid format.'}, 415);
    let input: Record<string, unknown>;
    try {
      const reader = req.body?.getReader(); let raw = '', size = 0; const decoder = new TextDecoder();
      if (reader) while (true) {const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 4096) {await reader.cancel(); return response({error: 'Request too large.'}, 413);} raw += decoder.decode(part.value, {stream: true});}
      input = JSON.parse(raw + decoder.decode()); if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error();
    } catch {return response({error: 'Invalid request.'}, 400);}
    const t = now();
    if (device) {
      if (typeof input.deviceId !== 'string' || !/^[a-f0-9]{32}$/.test(input.deviceId) || !Number.isSafeInteger(input.seq) || Number(input.seq) < 1 || typeof input.online !== 'boolean') return response({error: 'Invalid state.'}, 400);
      // Reconnect clears all eligibility. A new device boot must reacquire it.
      if (deviceId !== input.deviceId) {
        if (deviceId && t - deviceSeen < 5000) return response({error: 'A device is already active.'}, 409);
        deviceId = input.deviceId; sequence = 0; gate = ''; consumedGate = ''; events = [];
      }
      deviceSeen = t; deviceOnline = input.online;
      if (!deviceOnline) {gate = ''; events = [];}
      if (Number(input.seq) > sequence) {
        sequence = Number(input.seq);
        if (deviceOnline && tabletSeen && t - tabletSeen < 2000 && Array.isArray(input.events)) {
          for (const item of input.events.slice(0, 8)) {
            if (!item || typeof item !== 'object') continue;
            if (item.evt === 'motion') {if (!events.some(e => e.evt === 'motion')) events.push({evt: 'motion', at: t});}
            if (item.evt === 'lever' && gate && gate !== consumedGate && item.gate === gate) {
              events.push({evt: 'lever', gate, at: t}); consumedGate = gate; gate = '';
            }
          }
        }
      }
      if (!code || t >= codeUntil) {code = String(randomInt(10000000, 100000000)); codeUntil = t + 300000;}
      const alive = !!tabletSeen && t - tabletSeen < 2000;
      return response({code, bound: !!binding && alive, gate: alive && gate !== consumedGate ? gate : '', command: alive && t < commandUntil ? command : idle});
    }
    if (path === '/api/hardware/pair') {
      if (t >= attemptUntil) {attempts = 0; attemptUntil = t + 60000;}
      if (++attempts > 10) return response({error: 'Too many attempts. Wait a minute.'}, 429);
      if (!code || t >= codeUntil || !safe(String(input.code || ''), code) || t - deviceSeen >= 5000) return response({error: 'Code expired or device offline.'}, 403);
      binding = randomBytes(32).toString('hex'); code = ''; gate = ''; consumedGate = ''; events = []; command = idle; tabletSeen = 0;
      return response({ok: true}, 200, `slot_hardware=${binding}; Path=/api/hardware; HttpOnly; SameSite=Strict${origin.startsWith('https:') ? '; Secure' : ''}`);
    }
    if (path !== '/api/hardware/tablet') return response({error: 'Resource not found.'}, 404);
    const cookie = (req.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('slot_hardware='))?.slice(14) || '';
    if (!binding || !safe(cookie, binding)) return response({error: 'Link Arduino with the code on the Arduino display.'}, 401);
    if (typeof input.gate !== 'string' || input.gate.length > 80) return response({error: 'Invalid state.'}, 400);
    const c = input.command as Record<string, unknown> | undefined;
    if (!c || !['idle','attract','ready','blocked','spin','result'].includes(String(c.cmd))) return response({error: 'Invalid command.'}, 400);
    if (c.cmd === 'result' && (!Number.isInteger(c.tier) || Number(c.tier) < 0 || Number(c.tier) > 3 || typeof c.hub !== 'boolean')) return response({error: 'Invalid result.'}, 400);
    const wasAlive = !!tabletSeen && t - tabletSeen < 2000;
    tabletSeen = t;
    gate = input.gate === consumedGate ? '' : input.gate;
    command = {cmd: c.cmd as Command['cmd'], ...(c.cmd === 'result' ? {tier: Number(c.tier), hub: c.hub as boolean} : {}),
      l1: typeof c.l1 === 'string' ? c.l1.replace(/[^\x20-\x7e]/g, '').slice(0,16) : '', l2: typeof c.l2 === 'string' ? c.l2.replace(/[^\x20-\x7e]/g, '').slice(0,16) : ''};
    commandUntil = t + 2000;
    const delivered = wasAlive ? events.filter(e => t - e.at < 1000).map(({at, ...e}) => e) : [];
    events = [];
    return response({online: deviceOnline && t - deviceSeen < 3000, events: delivered});
  }};
}
