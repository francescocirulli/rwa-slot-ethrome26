import type {SlotEngine} from './slot/engine';
import type {WelcomeService} from './welcome';
import {SlotError, slotError} from './slot/errors';
import {logSpinFailure} from './slot/diagnostics';
import {GAS_CONSENT} from './slot/gas';
import type {Address} from 'viem';
import {createHash, randomBytes, randomInt} from 'node:crypto';
import QRCode from 'qrcode';
import {IDLE_MS, PAIR_MS, type Balance, type Identity, type Session, type SessionView, type WalletService} from './types';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('hex');
class ApiError extends Error {constructor(public status: number, message: string) {super(message);}}
type Options = {origin: string; walletService?: WalletService; readBalance: (address: string) => Promise<Balance>; now?: () => number; slot?: SlotEngine | null; welcome?: WelcomeService};

export function createRelay({origin, walletService, readBalance, now = Date.now, slot, welcome}: Options) {
  const pairs = new Map<string, Session>();
  const tablets = new Map<string, Session>();
  const phones = new Map<string, Session>();
  const users = new Map<string, Session>();
  const deposits = new Map<string, string>();
  let creates: number[] = [];
  const normalizedOrigin = new URL(origin).origin;

  function revoke(s: Session) {
    if (s.grant) walletService?.revoke(s.grant);
    if (s.playGrant) walletService?.revoke(s.playGrant);
    pairs.delete(s.secretHash); tablets.delete(s.tabletHash);
    if (s.phoneHash) phones.delete(s.phoneHash);
    if (s.userId && users.get(s.userId) === s) users.delete(s.userId);
    deposits.delete(s.id); s.expiresAt = 0;
  }
  function sweep() {for (const s of pairs.values()) if (s.expiresAt <= now()) revoke(s);}
  const sweepTimer = setInterval(sweep, 1000);
  sweepTimer.unref();
  function valid(s: Session) {
    if (s.expiresAt <= now() || pairs.get(s.secretHash) !== s) {
      revoke(s); throw new ApiError(401, 'Session ended. Scan the new QR code on the iPad.');
    }
  }
  function cookie(req: Request, name: string) {
    return (req.headers.get('cookie') || '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
  }
  function cookieHeader(name: string, value: string) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${normalizedOrigin.startsWith('https:') ? '; Secure' : ''}${value ? '' : '; Max-Age=0'}`;
  }
  async function identity(req: Request) {
    if (!walletService) throw new ApiError(503, 'Linking will be available shortly.');
    const token = req.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1];
    if (!token || token.length > 16_000) throw new ApiError(401, 'Sign in on your phone to continue.');
    try {return await walletService.authenticate(token);}
    catch {throw new ApiError(401, 'Access not verified. Sign in again on your phone.');}
  }
  function tablet(req: Request) {
    const s = tablets.get(hash(cookie(req, 'slot_tablet')));
    if (!s) throw new ApiError(401, 'Session ended.');
    valid(s); return s;
  }
  async function phone(req: Request): Promise<{s: Session; user: Identity}> {
    const s = phones.get(hash(cookie(req, 'slot_phone')));
    if (!s) throw new ApiError(401, 'Session ended. Scan the QR code on the iPad.');
    valid(s);
    const user = await identity(req);
    valid(s);
    if (s.userId !== user.userId) throw new ApiError(403, 'This link belongs to another account.');
    return {s, user};
  }
  function touch(s: Session) {valid(s); if (s.state !== 'pending') s.expiresAt = now() + IDLE_MS;}
  async function view(s: Session): Promise<SessionView> {
    valid(s);
    const dto: SessionView = {id: s.id, state: s.state, code: s.code, expiresAt: s.expiresAt, serverTime: now()};
    if (s.state === 'pending') dto.qr = s.qr;
    if (s.wallet) {
      dto.address = s.wallet.address;
      if (!deposits.has(s.id)) deposits.set(s.id, await QRCode.toDataURL(s.wallet.address, {width: 280, margin: 2, errorCorrectionLevel: 'M'}));
      dto.depositQr = deposits.get(s.id);
    }
    if (s.grant) dto.grant = {active: s.grant.active, signerId: s.grant.signerId, policyId: s.grant.policyId, message: s.grant.message};
    if (s.playGrant) {const {active, signerId, policyId, contract, chainId, budget, gasMode} = s.playGrant; dto.playGrant = {active, signerId, policyId, contract, chainId, budget, gasMode};}
    dto.proof = s.proof;
    dto.welcome = s.welcome;
    valid(s);
    dto.expiresAt = s.expiresAt; dto.serverTime = now();
    return dto;
  }
  function json(data: unknown, status = 200, setCookie?: string) {
    const headers: Record<string, string> = {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Cookie', 'Referrer-Policy': 'no-referrer'};
    if (setCookie) headers['Set-Cookie'] = setCookie;
    return new Response(JSON.stringify(data), {status, headers});
  }

  return {
    close() {clearInterval(sweepTimer); for (const s of pairs.values()) revoke(s);},
    async handle(req: Request) {
      try {
        sweep();
        const path = new URL(req.url).pathname.replace('/api/relay', '');
        if (req.method === 'GET') {
          if (path === '/tablet') return json(await view(tablet(req)));
          if (path === '/phone') return json(await view((await phone(req)).s));
          if (path === '/tablet/game' || path === '/phone/game' || path === '/phone/approval') {
            const s = path.startsWith('/tablet') ? tablet(req) : (await phone(req)).s;
            if (!slot) return json({configured: false});
            if (!s.wallet || s.state !== 'active') throw new ApiError(409, 'Link the wallet first.');
            const game = await (path === '/phone/approval' ? slot.approvalView(s.wallet.address as Address) : slot.playView(s.wallet.address as Address));
            valid(s); return json({sessionId: s.id, ...game});
          }
          if (path === '/tablet/balance' || path === '/phone/balance') {
            const s = path.startsWith('/tablet') ? tablet(req) : (await phone(req)).s;
            if (!s.wallet) throw new ApiError(409, 'Wallet not linked yet.');
            const balance = await readBalance(s.wallet.address);
            valid(s); return json({sessionId: s.id, balance});
          }
          throw new ApiError(404, 'Resource not found.');
        }
        if (req.method !== 'POST') throw new ApiError(405, 'Method not allowed.');
        if (req.headers.get('origin') !== normalizedOrigin || req.headers.get('x-slot-request') !== '1') {
          throw new ApiError(403, 'Invalid request origin.');
        }
        if (!req.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'Invalid format.');
        // Bound body size while reading, before allocating the entire payload.
        const reader = req.body?.getReader();
        let raw = '', bytes = 0;
        if (reader) {
          const decoder = new TextDecoder();
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 12_000) {await reader.cancel(); throw new ApiError(413, 'Request too large.');}
            raw += decoder.decode(chunk.value, {stream: true});
          }
          raw += decoder.decode();
        }
        let input: Record<string, unknown>;
        try {input = JSON.parse(raw || '{}'); if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();}
        catch {throw new ApiError(400, 'Invalid request.');}

        if (path === '/pair') {
          creates = creates.filter((time) => time > now() - 60_000);
          if (creates.length >= 30 || pairs.size >= 120) throw new ApiError(429, 'Wait a moment before trying again.');
          creates.push(now());
          const previous = tablets.get(hash(cookie(req, 'slot_tablet')));
          if (previous) revoke(previous);
          const secret = random(), token = random();
          const s: Session = {id: randomBytes(16).toString('hex'), code: String(randomInt(100000, 1000000)),
            secretHash: hash(secret), tabletHash: hash(token), state: 'pending', createdAt: now(), expiresAt: now() + PAIR_MS};
          s.qr = await QRCode.toDataURL(`${normalizedOrigin}/phone#pair=${secret}`, {width: 320, margin: 2, errorCorrectionLevel: 'M'});
          pairs.set(s.secretHash, s); tablets.set(s.tabletHash, s);
          return json(await view(s), 201, cookieHeader('slot_tablet', token));
        }
        if (path === '/lookup' || path === '/approve') {
          if (typeof input.secret !== 'string' || !/^[a-f0-9]{64}$/.test(input.secret)) throw new ApiError(400, 'Invalid QR code.');
          const s = pairs.get(hash(input.secret));
          if (!s || s.expiresAt <= now() || s.state !== 'pending') throw new ApiError(410, 'QR code expired or already used. Scan the one on the iPad.');
          if (path === '/lookup') return json({code: s.code, expiresAt: s.expiresAt, origin: normalizedOrigin});
          if (input.code !== s.code) throw new ApiError(400, 'The code does not match.');
          const user = await identity(req);
          valid(s);
          if (s.state !== 'pending') throw new ApiError(409, 'QR code already used.');
          const wallet = user.wallets[0];
          if (!wallet) throw new ApiError(409, 'Your wallet is being prepared. Wait a few seconds and try again.');
          const previous = users.get(user.userId);
          if (previous && previous !== s) revoke(previous);
          const previousPhone = phones.get(hash(cookie(req, 'slot_phone')));
          if (previousPhone && previousPhone !== s) revoke(previousPhone);
          const token = random();
          s.phoneHash = hash(token); s.state = 'approved'; s.userId = user.userId; s.wallet = wallet;
          s.qr = undefined; touch(s);
          phones.set(s.phoneHash, s); users.set(user.userId, s);
          if (welcome) {
            s.welcome = {status: 'checking', amount: '2'};
            void welcome.request(user, wallet).then(value => {s.welcome = value;}).catch(() => {s.welcome = {status: 'unavailable', amount: '2'};});
          }
          return json(await view(s), 200, cookieHeader('slot_phone', token));
        }
        if (path === '/tablet/claim') {
          const s = tablet(req);
          if (s.state !== 'approved') throw new ApiError(409, 'Link not available.');
          tablets.delete(s.tabletHash);
          const token = random(); s.tabletHash = hash(token); s.state = 'active';
          tablets.set(s.tabletHash, s);
          return json(await view(s), 200, cookieHeader('slot_tablet', token));
        }
        if (path === '/tablet/logout' || path === '/phone/logout') {
          const isTablet = path.startsWith('/tablet');
          const s = isTablet ? tablet(req) : (await phone(req)).s;
          revoke(s); return json({ok: true}, 200, cookieHeader(isTablet ? 'slot_tablet' : 'slot_phone', ''));
        }
        if (path === '/tablet/activity' || path === '/phone/activity') {
          const s = path.startsWith('/tablet') ? tablet(req) : (await phone(req)).s;
          touch(s); return json({sessionId: s.id, expiresAt: s.expiresAt, serverTime: now()});
        }
        if (path === '/phone/welcome') {
          const {s, user} = await phone(req);
          if (!s.wallet || !user.wallets.some(wallet => wallet.id === s.wallet!.id && wallet.address.toLowerCase() === s.wallet!.address.toLowerCase())) {
            throw new ApiError(403, 'This wallet does not belong to this account.');
          }
          s.welcome = welcome ? await welcome.request(user, s.wallet) : {status: 'unavailable', amount: '2'};
          // Automatic bonus recovery must not extend the global inactivity deadline.
          valid(s); return json(await view(s));
        }
        if (path === '/phone/prepare' || path === '/phone/activate') {
          const {s, user} = await phone(req);
          if (s.state !== 'active' || !s.wallet) throw new ApiError(409, 'Wait for the iPad to finish linking.');
          if (!user.wallets.some((wallet) => wallet.id === s.wallet!.id && wallet.address.toLowerCase() === s.wallet!.address.toLowerCase())) {
            throw new ApiError(403, 'This wallet does not belong to this account.');
          }
          if (s.busy) throw new ApiError(409, 'Approval already in progress.');
          touch(s); s.busy = true;
          try {
            if (path.endsWith('/prepare') && !s.grant) {
              const grant = await walletService!.prepare(s.wallet, user.userId, s.id, s.code);
              try {valid(s);} catch (error) {walletService!.revoke(grant); throw error;}
              s.grant = grant;
            } else if (path.endsWith('/activate')) {
              if (!s.grant) throw new ApiError(409, 'Prepare the link first.');
              await walletService!.activate(s.grant); valid(s);
            }
          } finally {s.busy = false;}
          return json(await view(s));
        }
        if (path === '/phone/play/prepare' || path === '/phone/play/activate') {
          const {s, user} = await phone(req);
          if (!slot || !walletService?.preparePlay) throw new ApiError(503, 'Contract not configured yet.');
          if (s.state !== 'active' || !s.wallet) throw new ApiError(409, 'Wait for the iPad to finish linking.');
          if (!user.wallets.some(wallet => wallet.id === s.wallet!.id && wallet.address.toLowerCase() === s.wallet!.address.toLowerCase())) throw new ApiError(403, 'This wallet does not belong to this account.');
          if (s.busy) throw new ApiError(409, 'Approval already in progress.');
          touch(s); s.busy = true;
          try {
            if (path.endsWith('/prepare')) {
              if (slot.reader.config.gasMode === 'usdc' && input.gasConsent !== GAS_CONSENT) throw new ApiError(400, 'Confirm USDC fees with ETH fallback on your phone.');
              if (typeof input.budget !== 'string' || !/^[1-9][0-9]{0,17}$/.test(input.budget)) throw new ApiError(400, 'Invalid budget.');
              const settings = await slot.reader.settings(); valid(s);
              if (BigInt(input.budget) < settings.ticketPrice) throw new ApiError(400, 'The budget must cover at least one spin.');
              if (s.playGrant) throw new ApiError(409, 'Budget already prepared. Complete the consent or link the session again.');
              const grant = await walletService.preparePlay(s.wallet, user.userId, s.id, s.code, slot.reader.config.address, slot.reader.config.chainId, input.budget);
              try {valid(s);} catch (error) {walletService.revoke(grant); throw error;}
              grant.gasMode = slot.reader.config.gasMode; s.playGrant = grant;
            } else {
              if (!s.playGrant) throw new ApiError(409, 'Prepare the budget first.');
              const player = await slot.reader.walletState(s.wallet.address as Address); valid(s);
              if (player.allowance !== BigInt(s.playGrant.budget)) throw new ApiError(409, 'Confirm the USDC approval for the exact budget on your phone.');
              await walletService.activate(s.playGrant); valid(s);
            }
          } finally {s.busy = false;}
          return json(await view(s));
        }
        if (path === '/tablet/spin' || path === '/phone/spin') {
          const s = path.startsWith('/tablet') ? tablet(req) : (await phone(req)).s;
          if (!slot || !s.wallet || s.state !== 'active') throw new ApiError(409, 'Link the wallet and configure the contract.');
          if (typeof input.afterGameId !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(input.afterGameId)) throw new ApiError(400, 'Invalid spin reference.');
          if (input.mode !== 'free' && input.mode !== 'paid') throw new ApiError(400, 'Invalid spin type.');
          touch(s);
          const grant = s.playGrant;
          if (input.mode === 'paid' && (!grant?.active || !walletService?.sendSpin)) throw new ApiError(403, 'Approve the budget and spins on your phone.');
          const operation = await slot.start(s.wallet.address as Address, BigInt(input.afterGameId), input.mode, {
            assertSession: () => {valid(s);}, maxPrice: grant ? BigInt(grant.budget) : undefined,
            sendPaid: grant ? (key) => {valid(s); return walletService!.sendSpin!(grant, key, grant.gasMode || slot.reader.config.gasMode, () => {valid(s);});} : undefined,
            resolvePaid: walletService?.resolveSpin,
          }).catch(error => {
            logSpinFailure('slot.spin_rejected',s.wallet!.address as Address,input.mode as 'paid'|'free',input.afterGameId as string,error);
            throw error;
          });
          valid(s); return json({sessionId: s.id, operation}, 202);
        }
        if (path === '/tablet/sign') {
          const s = tablet(req);
          if (!s.grant?.active || !walletService || s.state !== 'active') throw new ApiError(403, 'Approve the signature from your phone.');
          touch(s);
          if (s.proof) return json(await view(s));
          s.proof = {status: 'pending', message: s.grant.message};
          try {
            const signature = await walletService.sign(s.grant); valid(s);
            s.proof = {status: 'verified', message: s.grant.message, signature};
          } catch (error) {
            valid(s); s.proof.status = 'error';
            if (error instanceof ApiError) throw error;
          }
          return json(await view(s));
        }
        throw new ApiError(404, 'Resource not found.');
      } catch (error) {
        if (error instanceof SlotError) return json({error: error.message, code: error.code}, error.status);
        // Never serialize upstream SDK errors: they may include credentials.
        if (error instanceof ApiError) return json({error: error.message}, error.status);
        const safe = slotError(error); return json({error: safe.message, code: safe.code}, safe.status);
      }
    },
  };
}
