'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {PrivyProvider, useLoginWithEmail, useLoginWithPasskey, usePrivy, useSignupWithPasskey} from '@privy-io/react-auth';
import {base} from 'viem/chains';
import type {AdminAccountView} from '@/lib/admin/model';
import {AdminWorkspace} from './workspace';

function Brand() {return <a className="admin-brand" href="/admin"><span aria-hidden="true">✳</span><b>LUCKY<br/>SIGNAL<sup>®</sup></b></a>;}
function Gate({children}: {children: React.ReactNode}) {
  return <div className="admin-gate"><header><Brand/><a className="back-link" href="/">Apri il terminale ↗</a></header><main className="admin-entry"><section className="entry-story"><span className="eyebrow">BEHIND THE GOOD LUCK</span><h1>CONTROL<br/><em>ROOM.</em></h1><p>Il tuo wallet.<br/>Il tuo arcade, sotto controllo.</p><div className="entry-reels" aria-hidden="true">{['symbol-2', 'symbol-1', 'symbol-11'].map(symbol => <div key={symbol}><img src={`/symbols/${symbol}.svg`} alt=""/></div>)}</div><div className="entry-note"><span>↗</span><p><b>Un accesso, il tuo spazio.</b><br/>Wallet reale su Base. Macchina e risultati onchain.</p></div></section><section className="admin-access">{children}</section></main><footer>OPERATOR CONSOLE <span>GOOD ENERGY. YOUR CONTROL. ✦</span></footer></div>;
}
export function AdminProvider({appId, configured}: {appId: string; configured: boolean}) {
  if (!appId || !configured) return <Gate><span className="eyebrow">CONFIGURAZIONE IN CORSO</span><h2>Quasi pronti.</h2><p>L’accesso Privy sarà disponibile dopo la configurazione dell’app.</p></Gate>;
  return <PrivyProvider appId={appId} config={{loginMethods: ['passkey', 'email'], appearance: {theme: 'dark', accentColor: '#e8f77a'},
    defaultChain: base, supportedChains: [base], embeddedWallets: {ethereum: {createOnLogin: 'off'}}}}><Admin/></PrivyProvider>;
}
function Admin() {
  const {ready, authenticated, user, getAccessToken, logout} = usePrivy();
  const [account, setAccount] = useState<AdminAccountView | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [leaving, setLeaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const userId = ready && authenticated ? user?.id : undefined;
  const currentUser = useRef(userId), epoch = useRef(0), inFlight = useRef(false);
  if (currentUser.current !== userId) {currentUser.current = userId; epoch.current++;}
  const refresh = useCallback(async () => {
    const generation = epoch.current, id = currentUser.current;
    if (!id) return;
    const token = await getAccessToken();
    if (!token) throw new Error('Accedi di nuovo per aprire il wallet.');
    const response = await fetch('/api/admin/account', {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store', signal: AbortSignal.timeout(25000)});
    const result = await response.json();
    if (generation !== epoch.current || currentUser.current !== id) return;
    if (!response.ok) {
      setAccount(null);
      throw new Error(result.error || 'Wallet non disponibile. Riprova.');
    }
    if (result.userId !== id) throw new Error('Account non corrispondente. Accedi di nuovo.');
    setAccount(result); setError('');
    return result as AdminAccountView;
  }, [getAccessToken]);
  useEffect(() => {
    setAccount(null); setCopied(false); setError('');
    if (!userId || leaving) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {await refresh();} catch (cause) {if (!cancelled) setError(cause instanceof Error ? cause.message : 'Connessione interrotta. Riprova.');}
      if (!cancelled) timer = setTimeout(poll, 15000);
    }
    void poll(); return () => {cancelled = true; clearTimeout(timer);};
  }, [userId, refresh, leaving]);
  async function run(label: string, action: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(label); setError(''); const generation = epoch.current;
    try {await action();} catch (cause) {if (generation === epoch.current) setError(cause instanceof Error ? cause.message : 'Operazione non completata. Riprova.');}
    finally {inFlight.current = false; setBusy('');}
  }
  async function create() {
    const generation = epoch.current;
    const token=await getAccessToken();if(!token)throw new Error('Accedi di nuovo.');
    const response=await fetch('/api/admin/create',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Slot-Request':'1'},body:JSON.stringify({confirm:true}),signal:AbortSignal.timeout(60000)});
    const result=await response.json();if(generation!==epoch.current)return;
    if(!response.ok)throw new Error(result.error||'Creazione da verificare. Aggiorna il wallet.');
    if(result.userId!==currentUser.current)throw new Error('Account cambiato.');
    setAccount(result);
  }
  async function exit() {
    setLeaving(true); epoch.current++; setAccount(null); setError('');
    try {await logout();} catch {setError('Uscita non completata. Riprova.');}
    finally {setLeaving(false);}
  }
  const visibleAccount = userId && !leaving && account?.userId === userId ? account : null;
  if (visibleAccount?.wallet) return <AdminWorkspace key={userId+':'+visibleAccount.wallet.address} account={visibleAccount as AdminAccountView & {wallet: NonNullable<AdminAccountView['wallet']>}} identity={user?.email?.address || 'Account con passkey'} error={error} busy={!!busy} onRefresh={() => void run('Aggiornamento', refresh)} onLogout={() => void exit()}/>;
  return <Gate>
    {!ready || leaving ? <div className="access-loading" role="status"><span className="admin-spinner"/><h2>{leaving ? 'A presto.' : 'Un momento.'}</h2><p>{leaving ? 'Uscita dall’account in corso…' : 'Verifichiamo il tuo accesso.'}</p></div> : !authenticated ? <AdminLogin/> : <>
      <span className="eyebrow">IL TUO ACCOUNT · IL WALLET DEL TEAM</span><h2>{visibleAccount?.state==='create'?'Un wallet.\nIl vostro arcade.':visibleAccount?'Entriamo nel team.':'Verifichiamo\nil tuo accesso.'}</h2><p className="access-identity">{user?.email?.address || 'Accesso con passkey'}</p>
      {visibleAccount?.state==='create'?<><p>Crea un wallet Privy dedicato all’arcade. Sarai il proprietario e potrai autorizzare il collaboratore: stesso indirizzo, saldo e ricariche.</p><button className="admin-primary" disabled={!!busy} onClick={()=>void run('Creazione wallet condiviso',create)}>Crea wallet condiviso <span>↗</span></button></>:visibleAccount?<><p>{visibleAccount.state==='unconfigured'?'Configuriamo prima l’account del proprietario. Questo è il codice del tuo account Privy.':'Il proprietario deve autorizzare il tuo account. Inviagli questo codice: non servono email o passkey condivise.'}</p><div className="admin-account-code"><span>IL TUO CODICE ACCOUNT</span><code>{userId}</code><button className="admin-text" onClick={()=>void navigator.clipboard.writeText(userId!).then(()=>setCopied(true)).catch(()=>setError('Seleziona e copia il codice account.'))}>{copied?'Copiato ✓':'Copia codice account'}</button></div><button className="admin-secondary" disabled={!!busy} onClick={()=>void run('Verifica accesso',refresh)}>Verifica accesso ↗</button></>:<><p>Verifichiamo i permessi del tuo account sul wallet condiviso.</p>{!error&&<span className="admin-spinner"/>}{error&&<button className="admin-secondary" disabled={!!busy} onClick={()=>void run('Aggiornamento',refresh)}>Riprova</button>}</>}
      <button className="admin-text" disabled={!!busy} onClick={() => void exit()}>Esci dall’account</button>
    </>}
    {busy && <p className="admin-message" role="status">{busy}…</p>}{error && <p className="admin-error" role="alert">{error}</p>}
  </Gate>;
}
function AdminLogin() {
  const {loginWithPasskey} = useLoginWithPasskey();
  const {signupWithPasskey} = useSignupWithPasskey();
  const {sendCode, loginWithCode} = useLoginWithEmail();
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const inFlight = useRef(false);
  async function run(label: string, action: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(label); setError('');
    try {await action();} catch {setError('Accesso non completato. Riprova o usa il codice via email.');}
    finally {inFlight.current = false; setBusy('');}
  }
  return <><span className="eyebrow">01 / ACCESSO ADMIN</span><h2>Benvenuto<br/>ai comandi<span>.</span></h2><p>Accedi con il tuo account Privy.<br/>Il wallet dell’arcade è condiviso con il team.</p>
    <button className="admin-primary" disabled={!!busy} onClick={() => void run('Accesso', loginWithPasskey)}>Accedi con passkey <span>↗</span></button>
    <button className="admin-secondary" disabled={!!busy} onClick={() => void run('Creazione passkey', signupWithPasskey)}>Prima volta? Crea una passkey</button>
    <div className="admin-divider">OPPURE CON EMAIL</div><form onSubmit={event => {event.preventDefault(); void run(sent ? 'Verifica codice' : 'Invio codice', async () => {if (sent) await loginWithCode({code}); else {await sendCode({email}); setSent(true);}});}}>
      <label htmlFor="admin-email">La tua email</label><input id="admin-email" type="email" autoComplete="email" value={email} disabled={sent || !!busy} onChange={e => setEmail(e.target.value)} required placeholder="tu@esempio.it"/>
      {sent && <><label htmlFor="admin-code">Codice ricevuto via email</label><input id="admin-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={!!busy} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required placeholder="000000"/></>}
      <button className="admin-primary" type="submit" disabled={!!busy}>{sent ? 'Conferma codice' : 'Ricevi il codice'} <span>↗</span></button>
      {sent && <button className="admin-text" disabled={!!busy} type="button" onClick={() => {setSent(false); setCode('');}}>Cambia email o richiedi un nuovo codice</button>}
    </form>{busy && <p className="admin-message" role="status">{busy}…</p>}{error && <p className="admin-error" role="alert">{error}</p>}
    <p className="fine-print">Ogni persona usa la propria email o passkey. L’accesso al wallet condiviso richiede l’autorizzazione del proprietario.</p>
  </>;
}
