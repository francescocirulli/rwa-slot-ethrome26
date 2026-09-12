'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {PrivyProvider, useCreateWallet, useLoginWithEmail, useLoginWithPasskey, usePrivy, useSigners, useSignupWithPasskey, useWallets, useLinkWithPasskey} from '@privy-io/react-auth';
import {base} from 'viem/chains';
import {PhoneGame} from './game';
import type {Balance, SessionView} from '@/lib/types';

function Shell({children}: {children: React.ReactNode}) {
  return <div className="phone-shell"><header className="phone-header"><span className="phone-mark">✳</span><span>LUCKY<br/>SIGNAL<span className="registered">®</span></span><span className="phone-network">● BASE</span></header><main>{children}</main><footer>IL TUO WALLET. LA TUA SESSIONE. <span>✦</span></footer></div>;
}
export function PhoneProvider({appId, configured}: {appId: string; configured: boolean}) {
  if (!appId || !configured) return <Shell><div className="phone-card"><span className="eyebrow">CI SIAMO QUASI</span><h1>Il tuo posto<br/>ti aspetta<span>.</span></h1><p>Stiamo preparando il collegamento. Riprova tra poco dal QR sull’iPad.</p></div></Shell>;
  return <PrivyProvider appId={appId} config={{loginMethods: ['passkey', 'email'],
    appearance: {theme: 'dark', accentColor: '#e8f77a'}, defaultChain: base, supportedChains: [base],
    embeddedWallets: {ethereum: {createOnLogin: 'off'}},
  }}><Phone/></PrivyProvider>;
}

class PhoneError extends Error {constructor(message: string, public status: number) {super(message);}}
function message(error: unknown) {
  if (error instanceof PhoneError) return error.message;
  return 'Operazione non completata. Riprova: puoi usare anche l’accesso via email.';
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
      if (!token) throw new PhoneError('Accedi per continuare.', 401);
      headers.Authorization = `Bearer ${token}`;
    }
    if (data !== undefined) {headers['Content-Type'] = 'application/json'; headers['X-Slot-Request'] = '1';}
    const response = await fetch('/api/relay' + path, {method: data === undefined ? 'GET' : 'POST', headers,
      body: data === undefined ? undefined : JSON.stringify(data), credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(25_000)});
    const result = await response.json();
    if (!response.ok) throw new PhoneError(result.error || 'Richiesta non completata.', response.status);
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
      if (Date.now() >= until) throw new PhoneError('Wallet creato. Attendi qualche secondo e premi di nuovo Collega.', 409);
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
    try {await task;} catch {setError('Collegamento interrotto: il server chiuderà la sessione alla scadenza.');}
  }
  const canAct = ready && !busy;
  const connectedSession = authenticated && session;
  const checking = !ready || !loaded || recovering;
  return <Shell>
    <div className="intro"><span className="eyebrow">IL TUO PASS PER L’ARCADE</span><h1>{connectedSession ? <>Bel colpo.<br/>Sei dentro<span>.</span></> : <>Un telefono.<br/>Un po’ di fortuna<span>.</span></>}</h1><p>{connectedSession ? session.state === 'approved' ? 'L’iPad sta completando il collegamento.' : 'Il tuo wallet è collegato all’iPad.' : 'Accedi qui. Il tuo posto si apre sull’iPad.'}</p></div>
    {checking && <div className="phone-progress" role="status">Verifichiamo il tuo accesso e il collegamento all’iPad…</div>}
    {ready && authenticated && <div className="phone-account-state"><span>● ACCOUNT CONNESSO</span><b>{user?.email?.address || 'Accesso con passkey'}</b><small>{connectedSession ? 'Wallet associato a questo iPad' : 'Nessun iPad collegato a questa pagina'}</small></div>}
    {error && <div className="phone-error" role="alert">{error}</div>}
    {busy && <div className="phone-progress" role="status">{busy}…</div>}
    {!checking && !authenticated && !ended && <section className="phone-card"><span className="eyebrow">01 / FATTI RICONOSCERE</span><h2>Il tuo ingresso.</h2><button className="phone-primary" disabled={!canAct} onClick={() => run('Accesso', async () => {await loginWithPasskey();})}>Accedi con passkey <span>↗</span></button><button className="phone-secondary" disabled={!canAct} onClick={() => run('Creazione passkey', async () => {await signupWithPasskey();})}>Prima volta? Crea una passkey</button><div className="divider">OPPURE CON EMAIL</div><form onSubmit={(event) => {event.preventDefault(); void run(emailSent ? 'Verifica codice' : 'Invio codice', async () => {if (emailSent) await loginWithCode({code}); else {await sendCode({email}); setEmailSent(true);}});}}><label htmlFor="email">La tua email</label><input id="email" type="email" autoComplete="email" value={email} disabled={emailSent || !!busy} onChange={(event) => setEmail(event.target.value)} required placeholder="tu@esempio.it"/>{emailSent && <><label htmlFor="code">Codice ricevuto via email</label><input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required placeholder="000000"/><p className="small">Controlla anche la cartella spam.</p></>}<button className="phone-primary" disabled={!canAct} type="submit">{emailSent ? 'Conferma codice' : 'Ricevi il codice'} <span>↗</span></button>{emailSent && <button className="phone-text" type="button" disabled={!canAct} onClick={() => {setEmailSent(false); setCode('');}}>Cambia email o richiedi un nuovo codice</button>}</form></section>}
    {info && secret && <section className="phone-card pairing-card"><span className="eyebrow">02 / È IL TUO IPAD?</span><div className="comparison-code">{info.code.slice(0, 3)} {info.code.slice(3)}</div><p>Questo codice deve coincidere con quello sullo schermo davanti a te.</p><small className="origin-label">{info.origin}</small>{authenticated && <><p className="account-label">{user?.email?.address || 'Accesso con passkey'} <button className="phone-text" disabled={!canAct} onClick={() => run('Cambio account', async () => {await logout(); setConfirmed(false);})}>Cambia account</button></p><label className="check-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span>Il codice coincide. Voglio collegare il mio wallet a questo iPad.</span></label><button className="phone-primary" disabled={!canAct || !confirmed || !walletsReady} onClick={() => run('Collegamento del wallet', connect)}>Collega il wallet <span>↗</span></button></>}</section>}
    {connectedSession && session && <>
      {session.state === 'active' && <PhoneGame session={session} api={api} onConfigured={setSlotConfigured} onSession={value => {if (latest.current.session?.id === value.id && deadline.current > Date.now()) apply(value);}}/>}
      {!slotConfigured && (!session.grant?.active ? <section className="phone-card"><span className="eyebrow">03 / L’ULTIMO SÌ</span><h2>Ora tocca all’iPad.</h2><p>Autorizza una firma di prova dal tablet. Funzionerà anche dopo aver chiuso questa pagina.</p><div className="permission-note"><b>Solo un messaggio di prova.</b><p>Nessun trasferimento, acquisto o puntata. Il permesso termina dopo 3 minuti senza interazioni sul telefono o sull’iPad.</p></div><label className="check-row"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)}/><span>Autorizzo la firma del messaggio di prova durante questa sessione.</span></label><button className="phone-primary" disabled={!canAct || !consented || session.state !== 'active'} onClick={() => run('Autorizzazione della firma', authorize)}>{session.state === 'approved' ? 'Attendi l’iPad…' : 'Autorizza e prendi posto'} <span>↗</span></button></section> : <div className="ready-card"><span>✓</span><div><b>{session.proof?.status === 'verified' ? 'Collegamento verificato.' : 'Il telefono può riposare.'}</b><p>{session.proof?.status === 'verified' ? 'La firma è riuscita. Nessun fondo è stato spostato.' : 'Premi “Prova il collegamento” sull’iPad.'}</p></div></div>)}
      <section className="phone-card"><div className="wallet-heading"><span className="eyebrow">IL TUO WALLET</span><span className="base-badge">● BASE</span></div><div className="phone-balance">{balance?.amount !== null && balance?.amount !== undefined ? balance.amount : '—'} <span>USDC</span></div><p className="small">{balance?.stale ? 'Aggiornamento saldo in attesa.' : 'Ricevi USDC sulla rete Base.'}</p><div className="receive-box">{session.depositQr && <img src={session.depositQr} width="180" height="180" alt="Indirizzo wallet per ricevere USDC su Base"/>}<code>{session.address}</code><button className="phone-secondary" onClick={() => run('Copia indirizzo', async () => {await navigator.clipboard.writeText(session.address!); setCopied(true); setTimeout(() => setCopied(false), 2000);})}>{copied ? 'Indirizzo copiato ✓' : 'Copia indirizzo ↗'}</button></div><p className="small">Il wallet e i fondi restano tuoi anche dopo l’uscita dall’iPad.</p>{user?.email && !user.linkedAccounts.some((account) => account.type === 'passkey') && <button className="phone-text" disabled={!canAct} onClick={() => run('Aggiunta passkey', async () => {await linkWithPasskey();})}>Aggiungi una passkey a questo account ↗</button>}<button className="phone-exit" onClick={() => void disconnect()}>Disconnetti l’iPad <span>↗</span></button></section>
      {remaining <= 30 && <div className="phone-idle" role="alert"><p>Il posto si libera tra <b>{remaining}s</b>.</p><button className="phone-primary" onClick={() => void activity()}>Sono ancora qui ↗</button></div>}
    </>}
    {!checking && loaded && !secret && !connectedSession && !busy && <section className="phone-card"><span className="eyebrow">{ended ? 'A PRESTO, PLAYER' : 'IL PRIMO PASSO È SULL’IPAD'}</span><h2>{ended ? 'Il posto è libero.' : 'Scansiona il QR.'}</h2><p>{ended ? 'La sessione sull’iPad è terminata. Il tuo wallet resta nel tuo account: scansiona un nuovo QR per tornare.' : 'Apri il QR mostrato sull’iPad per collegare il tuo wallet a quel terminale.'}</p></section>}
    {ready && authenticated && !connectedSession && !secret && !recovering && <button className="phone-account-exit" disabled={!canAct} onClick={() => run('Uscita dall’account', async () => {clearSession(); await logout();})}>Esci anche dall’account Privy ↗</button>}
  </Shell>;
}
