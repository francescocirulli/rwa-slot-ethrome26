'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {PrivyProvider, useCreateWallet, useLoginWithEmail, useLoginWithPasskey, usePrivy, useSigners, useSignupWithPasskey, useWallets, useLinkWithPasskey} from '@privy-io/react-auth';
import {base} from 'viem/chains';
import {PhoneGame} from './game';
import type {Balance, SessionView} from '@/lib/types';

function Shell({children}: {children: React.ReactNode}) {
  return <div className="phone-shell"><header className="phone-header"><span className="phone-mark">$</span><span>WALL STREET<br/>SLOT<span className="registered">™</span></span><span className="phone-network">● BASE</span></header><main>{children}</main><footer>YOUR WALLET. YOUR SESSION. ONCHAIN. <span>★</span></footer></div>;
}
export function PhoneProvider({appId, configured}: {appId: string; configured: boolean}) {
  if (!appId || !configured) return <Shell><div className="phone-card"><span className="eyebrow">ALMOST READY</span><h1>Your seat<br/>is waiting<span>.</span></h1><p>We are setting up the link. Try again shortly from the QR code on the iPad.</p></div></Shell>;
  return <PrivyProvider appId={appId} config={{loginMethods: ['passkey', 'email'],
    appearance: {theme: 'dark', accentColor: '#d9a73a'}, defaultChain: base, supportedChains: [base],
    embeddedWallets: {ethereum: {createOnLogin: 'off'}},
  }}><Phone/></PrivyProvider>;
}

class PhoneError extends Error {constructor(message: string, public status: number) {super(message);}}
function message(error: unknown) {
  if (error instanceof PhoneError) return error.message;
  return 'Operation not completed. Try again: you can also sign in with email.';
}
function initialSecret() {
  const secret = new URLSearchParams(window.location.hash.slice(1)).get('pair');
  if (secret) {
    try {sessionStorage.setItem('slot-pair', secret);} catch { /* Memory state still works. */ }
    history.replaceState(null, '', '/phone'); return secret;
  }
  try {return sessionStorage.getItem('slot-pair') || '';} catch {return '';}
}

function Phone() {
  const {ready, authenticated, user, getAccessToken, logout} = usePrivy();
  const {signupWithPasskey} = useSignupWithPasskey();
  const {loginWithPasskey} = useLoginWithPasskey();
  const {sendCode, loginWithCode} = useLoginWithEmail();
  const {linkWithPasskey} = useLinkWithPasskey();
  const {createWallet} = useCreateWallet();
  const {wallets, ready: walletsReady} = useWallets();
  const {addSigners} = useSigners();
  const [secret, setSecret] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const [info, setInfo] = useState<{code: string; origin: string; expiresAt: number} | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [consented, setConsented] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [remaining, setRemaining] = useState(180);
  const [ended, setEnded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slotConfigured, setSlotConfigured] = useState(false);
  const latest = useRef({user, addSigners, wallets, session});
  latest.current = {user, addSigners, wallets, session};
  const generation = useRef(0), deadline = useRef(0), serverTime = useRef(0), lastActivity = useRef(0);

  const clearSession = useCallback(() => {
    generation.current++; latest.current.session = null; deadline.current = 0; serverTime.current = 0;
    setSession(null); setBalance(null); setConsented(false); setEnded(true); setBusy(''); setRecovering(false);
  }, []);
  const apply = useCallback((value: SessionView) => {
    if (value.serverTime >= serverTime.current) {
      serverTime.current = value.serverTime;
      deadline.current = Date.now() + Math.max(0, value.expiresAt - value.serverTime);
    }
    if (value.serverTime >= serverTime.current) setSession(value);
  }, []);
  const api = useCallback(async (path: string, data?: unknown, auth = true) => {
    const headers: Record<string, string> = {};
    if (auth) {
      const token = await getAccessToken();
      if (!token) throw new PhoneError('Sign in to continue.', 401);
      headers.Authorization = `Bearer ${token}`;
    }
    if (data !== undefined) {headers['Content-Type'] = 'application/json'; headers['X-Slot-Request'] = '1';}
    const response = await fetch('/api/relay' + path, {method: data === undefined ? 'GET' : 'POST', headers,
      body: data === undefined ? undefined : JSON.stringify(data), credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(25_000)});
    const result = await response.json();
    if (!response.ok) throw new PhoneError(result.error || 'Request not completed.', response.status);
    return result;
  }, [getAccessToken]);
  useEffect(() => {setSecret(initialSecret()); setLoaded(true);}, []);
  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    api('/lookup', {secret}, false).then((value) => {if (!cancelled) {setInfo(value); setEnded(false);}})
      .catch((cause) => {if (!cancelled) setError(message(cause));});
    return () => {cancelled = true;};
  }, [secret, api]);
  useEffect(() => {
    if (!ready || !loaded) return;
    if (!authenticated || secret || ended) {setRecovering(false); return;}
    setRecovering(true);
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const current = generation.current;
    async function poll() {
      if (!document.hidden) {
        try {
          const result = await api('/phone');
          if (!cancelled && current === generation.current) {apply(result); setError(''); setRecovering(false);}
        } catch (cause) {
          if (!cancelled && current === generation.current) {
            setRecovering(false);
            if (cause instanceof PhoneError && cause.status === 401) clearSession(); else setError(message(cause));
          }
        }
      }
      if (!cancelled && current === generation.current) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => {cancelled = true; clearTimeout(timer);};
  }, [ready, authenticated, loaded, secret, ended, api, apply, clearSession]);
  useEffect(() => {if (ready && !authenticated && session) clearSession();}, [ready, authenticated, session, clearSession]);
  const sessionId = session?.id;
  const welcomeDone = session?.welcome?.status === 'granted' || session?.welcome?.status === 'ineligible';
  useEffect(() => {
    if (!sessionId || !authenticated || welcomeDone) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const current = generation.current;
    async function recoverWelcome() {
      try {
        const value: SessionView = await api('/phone/welcome', {});
        if (!cancelled && current === generation.current && value.id === sessionId) {
          apply(value);
          if (value.welcome?.status === 'granted' || value.welcome?.status === 'ineligible') return;
        }
      } catch { /* Pairing stays usable; retry the idempotent bonus without renewing activity. */ }
      if (!cancelled) timer = setTimeout(recoverWelcome, 10000);
    }
    void recoverWelcome();
    return () => {cancelled = true; clearTimeout(timer);};
  }, [sessionId, authenticated, welcomeDone, api, apply]);
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const current = generation.current;
    async function pollBalance() {
      try {
        const value = await api('/phone/balance');
        if (!cancelled && current === generation.current && value.sessionId === sessionId) setBalance(value.balance);
      } catch { /* Session poll handles authentication and connection errors. */ }
      if (!cancelled) timer = setTimeout(pollBalance, 12000);
    }
    void pollBalance(); return () => {cancelled = true; clearTimeout(timer);};
  }, [sessionId, api]);
  const activity = useCallback(async () => {
    const currentSession = latest.current.session;
    if (!currentSession || Date.now() - lastActivity.current < 800) return;
    if (deadline.current && Date.now() >= deadline.current) {clearSession(); return;}
    lastActivity.current = Date.now();
    const current = generation.current;
    try {
      const value = await api('/phone/activity', {});
      if (current === generation.current && value.sessionId === currentSession.id && value.serverTime >= serverTime.current) {
        serverTime.current = value.serverTime; deadline.current = Date.now() + Math.max(0, value.expiresAt - value.serverTime);
      }
    } catch (cause) {if (current === generation.current && cause instanceof PhoneError && cause.status === 401) clearSession();}
  }, [api, clearSession]);
  useEffect(() => {
    function check() {
      if (!deadline.current) return;
      const left = Math.ceil((deadline.current - Date.now()) / 1000);
      setRemaining(Math.max(0, left)); if (left <= 0) clearSession();
    }
    function interaction(event: Event) {if (event.isTrusted) void activity();}
    const timer = setInterval(check, 500);
    document.addEventListener('pointerdown', interaction); document.addEventListener('keydown', interaction);
    document.addEventListener('visibilitychange', check);
    return () => {clearInterval(timer); document.removeEventListener('pointerdown', interaction); document.removeEventListener('keydown', interaction); document.removeEventListener('visibilitychange', check);};
  }, [activity, clearSession]);
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(''); const current = generation.current;
    try {await action();} catch (cause) {if (current === generation.current) setError(message(cause));}
    finally {if (current === generation.current) setBusy('');}
  }
  async function connect() {
    if (!info || !confirmed) return;
    if (!latest.current.wallets.some((wallet) => wallet.walletClientType === 'privy')) await createWallet();
    const until = Date.now() + 12_000;
    while (!latest.current.user?.linkedAccounts.some((account) => account.type === 'wallet' && account.walletClientType === 'privy')) {
      if (Date.now() >= until) throw new PhoneError('Wallet created. Wait a few seconds and press Link again.', 409);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const current = generation.current;
    const value = await api('/approve', {secret, code: info.code});
    if (current !== generation.current) return;
    apply(value); setSecret(''); setInfo(null); setEnded(false);
    try {sessionStorage.removeItem('slot-pair');} catch { /* Nothing else persists the pair secret. */ }
  }
  async function authorize() {
    const current = generation.current;
    const prepared: SessionView = await api('/phone/prepare', {});
    if (current !== generation.current || !prepared.grant || !prepared.address) return;
    apply(prepared);
    await latest.current.addSigners({address: prepared.address,
      signers: [{signerId: prepared.grant.signerId, policyIds: [prepared.grant.policyId]}]});
    if (current !== generation.current) return;
    const activated = await api('/phone/activate', {});
    if (current === generation.current) apply(activated);
  }
  async function disconnect() {
    const task = api('/phone/logout', {});
    clearSession();
    try {await task;} catch {setError('Link interrupted: the server will close the session when it expires.');}
  }
  const canAct = ready && !busy;
  const connectedSession = authenticated && session;
  const checking = !ready || !loaded || recovering;
  return <Shell>
    <div className="intro"><span className="eyebrow">YOUR PASS TO THE FLOOR</span><h1>{connectedSession ? <>Nice pull.<br/>You are in<span>.</span></> : <>One phone.<br/>A little luck<span>.</span></>}</h1><p>{connectedSession ? session.state === 'approved' ? 'The iPad is finishing the link.' : 'Your wallet is linked to the iPad.' : 'Sign in here. Your seat opens on the iPad.'}</p></div>
    {checking && <div className="phone-progress" role="status">Checking your access and the link to the iPad…</div>}
    {ready && authenticated && <div className="phone-account-state"><span>● ACCOUNT CONNECTED</span><b>{user?.email?.address || 'Passkey login'}</b><small>{connectedSession ? 'Wallet linked to this iPad' : 'No iPad linked to this page'}</small></div>}
    {error && <div className="phone-error" role="alert">{error}</div>}
    {busy && <div className="phone-progress" role="status">{busy}…</div>}
    {!checking && !authenticated && !ended && <section className="phone-card"><span className="eyebrow">01 / GET VERIFIED</span><h2>Your entrance.</h2><button className="phone-primary" disabled={!canAct} onClick={() => run('Signing in', async () => {await loginWithPasskey();})}>Sign in with passkey <span>↗</span></button><button className="phone-secondary" disabled={!canAct} onClick={() => run('Creating passkey', async () => {await signupWithPasskey();})}>First time? Create a passkey</button><div className="divider">OR WITH EMAIL</div><form onSubmit={(event) => {event.preventDefault(); void run(emailSent ? 'Verifying code' : 'Sending code', async () => {if (emailSent) await loginWithCode({code}); else {await sendCode({email}); setEmailSent(true);}});}}><label htmlFor="email">Your email</label><input id="email" type="email" autoComplete="email" value={email} disabled={emailSent || !!busy} onChange={(event) => setEmail(event.target.value)} required placeholder="you@example.com"/>{emailSent && <><label htmlFor="code">Code from your email</label><input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required placeholder="000000"/><p className="small">Check your spam folder too.</p></>}<button className="phone-primary" disabled={!canAct} type="submit">{emailSent ? 'Confirm code' : 'Send me the code'} <span>↗</span></button>{emailSent && <button className="phone-text" type="button" disabled={!canAct} onClick={() => {setEmailSent(false); setCode('');}}>Change email or request a new code</button>}</form></section>}
    {info && secret && <section className="phone-card pairing-card"><span className="eyebrow">02 / IS THIS YOUR IPAD?</span><div className="comparison-code">{info.code.slice(0, 3)} {info.code.slice(3)}</div><p>This code must match the one on the screen in front of you.</p><small className="origin-label">{info.origin}</small>{authenticated && <><p className="account-label">{user?.email?.address || 'Passkey login'} <button className="phone-text" disabled={!canAct} onClick={() => run('Switching account', async () => {await logout(); setConfirmed(false);})}>Switch account</button></p><label className="check-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span>The code matches. I want to link my wallet to this iPad.</span></label><button className="phone-primary" disabled={!canAct || !confirmed || !walletsReady} onClick={() => run('Linking the wallet', connect)}>Link the wallet <span>↗</span></button></>}</section>}
    {connectedSession && session && <>
      {session.state === 'active' && <PhoneGame session={session} api={api} onConfigured={setSlotConfigured} onSession={value => {if (latest.current.session?.id === value.id && deadline.current > Date.now()) apply(value);}}/>}
      {!slotConfigured && (!session.grant?.active ? <section className="phone-card"><span className="eyebrow">03 / THE LAST YES</span><h2>Now it is the iPad's turn.</h2><p>Approve a signature proof from the tablet. It works even after you close this page.</p><div className="permission-note"><b>Only a proof message.</b><p>No transfer, purchase or bet. The permission ends after 3 minutes without interaction on the phone or the iPad.</p></div><label className="check-row"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)}/><span>I authorize signing the proof message during this session.</span></label><button className="phone-primary" disabled={!canAct || !consented || session.state !== 'active'} onClick={() => run('Approving the signature', authorize)}>{session.state === 'approved' ? 'Wait for the iPad…' : 'Approve and take a seat'} <span>↗</span></button></section> : <div className="ready-card"><span>✓</span><div><b>{session.proof?.status === 'verified' ? 'Link verified.' : 'Your phone can rest.'}</b><p>{session.proof?.status === 'verified' ? 'The signature succeeded. No funds were moved.' : 'Press “Test the link” on the iPad.'}</p></div></div>)}
      <section className="phone-card"><div className="wallet-heading"><span className="eyebrow">YOUR WALLET</span><span className="base-badge">● BASE</span></div><div className="phone-balance">{balance?.amount !== null && balance?.amount !== undefined ? balance.amount : '—'} <span>USDC</span></div><p className="small">{balance?.stale ? 'Balance update pending.' : 'Receive USDC on the Base network.'}</p><div className="receive-box">{session.depositQr && <img src={session.depositQr} width="180" height="180" alt="Wallet address to receive USDC on Base"/>}<code>{session.address}</code><button className="phone-secondary" onClick={() => run('Copying address', async () => {await navigator.clipboard.writeText(session.address!); setCopied(true); setTimeout(() => setCopied(false), 2000);})}>{copied ? 'Address copied ✓' : 'Copy address ↗'}</button></div><p className="small">Your wallet and funds stay yours even after you leave the iPad.</p>{user?.email && !user.linkedAccounts.some((account) => account.type === 'passkey') && <button className="phone-text" disabled={!canAct} onClick={() => run('Adding passkey', async () => {await linkWithPasskey();})}>Add a passkey to this account ↗</button>}<button className="phone-exit" onClick={() => void disconnect()}>Disconnect the iPad <span>↗</span></button></section>
      {remaining <= 30 && <div className="phone-idle" role="alert"><p>The seat frees up in <b>{remaining}s</b>.</p><button className="phone-primary" onClick={() => void activity()}>I am still here ↗</button></div>}
    </>}
    {!checking && loaded && !secret && !connectedSession && !busy && <section className="phone-card"><span className="eyebrow">{ended ? 'SEE YOU SOON, PLAYER' : 'THE FIRST STEP IS ON THE IPAD'}</span><h2>{ended ? 'The seat is open.' : 'Scan the QR code.'}</h2><p>{ended ? 'The iPad session has ended. Your wallet stays in your account: scan a new QR code to come back.' : 'Open the QR code shown on the iPad to link your wallet to that terminal.'}</p></section>}
    {ready && authenticated && !connectedSession && !secret && !recovering && <button className="phone-account-exit" disabled={!canAct} onClick={() => run('Signing out of the account', async () => {clearSession(); await logout();})}>Also sign out of the Privy account ↗</button>}
  </Shell>;
}
