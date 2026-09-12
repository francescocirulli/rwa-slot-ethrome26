'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {PrivyProvider, useLoginWithEmail, useLoginWithPasskey, usePrivy, useSignupWithPasskey} from '@privy-io/react-auth';
import {base} from 'viem/chains';
import type {AdminAccountView} from '@/lib/admin/model';
import {AdminWorkspace} from './workspace';

function Brand() {return <a className="admin-brand" href="/admin"><span aria-hidden="true">$</span><b>WALL STREET<br/>SLOT<sup>™</sup></b></a>;}
function Gate({children}: {children: React.ReactNode}) {
  return <div className="admin-gate"><header><Brand/><a className="back-link" href="/">Open the terminal ↗</a></header><main className="admin-entry"><section className="entry-story"><span className="eyebrow">BEHIND THE MARKET</span><h1>CONTROL<br/><em>ROOM.</em></h1><p>Your wallet.<br/>Your floor, under control.</p><div className="entry-reels" aria-hidden="true">{['symbol-2', 'symbol-1', 'symbol-11'].map(symbol => <div key={symbol}><img src={`/symbols/${symbol}.svg`} alt=""/></div>)}</div><div className="entry-note"><span>↗</span><p><b>One login, your space.</b><br/>Real wallet on Base. Machine and results onchain.</p></div></section><section className="admin-access">{children}</section></main><footer>OPERATOR CONSOLE <span>FULLY ONCHAIN. YOUR CONTROL. ★</span></footer></div>;
}
export function AdminProvider({appId, configured}: {appId: string; configured: boolean}) {
  if (!appId || !configured) return <Gate><span className="eyebrow">SETUP IN PROGRESS</span><h2>Almost ready.</h2><p>Privy login will be available once the app is configured.</p></Gate>;
  return <PrivyProvider appId={appId} config={{loginMethods: ['passkey', 'email'], appearance: {theme: 'dark', accentColor: '#d9a73a'},
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
    if (!token) throw new Error('Sign in again to open the wallet.');
    const response = await fetch('/api/admin/account', {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store', signal: AbortSignal.timeout(25000)});
    const result = await response.json();
    if (generation !== epoch.current || currentUser.current !== id) return;
    if (!response.ok) {
      setAccount(null);
      throw new Error(result.error || 'Wallet unavailable. Try again.');
    }
    if (result.userId !== id) throw new Error('Account mismatch. Sign in again.');
    setAccount(result); setError('');
    return result as AdminAccountView;
  }, [getAccessToken]);
  useEffect(() => {
    setAccount(null); setCopied(false); setError('');
    if (!userId || leaving) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {await refresh();} catch (cause) {if (!cancelled) setError(cause instanceof Error ? cause.message : 'Connection lost. Try again.');}
      if (!cancelled) timer = setTimeout(poll, 15000);
    }
    void poll(); return () => {cancelled = true; clearTimeout(timer);};
  }, [userId, refresh, leaving]);
  async function run(label: string, action: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(label); setError(''); const generation = epoch.current;
    try {await action();} catch (cause) {if (generation === epoch.current) setError(cause instanceof Error ? cause.message : 'Operation not completed. Try again.');}
    finally {inFlight.current = false; setBusy('');}
  }
  async function create() {
    const generation = epoch.current;
    const token=await getAccessToken();if(!token)throw new Error('Sign in again.');
    const response=await fetch('/api/admin/create',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Slot-Request':'1'},body:JSON.stringify({confirm:true}),signal:AbortSignal.timeout(60000)});
    const result=await response.json();if(generation!==epoch.current)return;
    if(!response.ok)throw new Error(result.error||'Creation to be verified. Refresh the wallet.');
    if(result.userId!==currentUser.current)throw new Error('Account changed.');
    setAccount(result);
  }
  async function exit() {
    setLeaving(true); epoch.current++; setAccount(null); setError('');
    try {await logout();} catch {setError('Sign-out not completed. Try again.');}
    finally {setLeaving(false);}
  }
  const visibleAccount = userId && !leaving && account?.userId === userId ? account : null;
  if (visibleAccount?.wallet) return <AdminWorkspace key={userId+':'+visibleAccount.wallet.address} account={visibleAccount as AdminAccountView & {wallet: NonNullable<AdminAccountView['wallet']>}} identity={user?.email?.address || 'Passkey account'} error={error} busy={!!busy} onRefresh={() => void run('Refreshing', refresh)} onLogout={() => void exit()}/>;
  return <Gate>
    {!ready || leaving ? <div className="access-loading" role="status"><span className="admin-spinner"/><h2>{leaving ? 'See you soon.' : 'One moment.'}</h2><p>{leaving ? 'Signing out of the account…' : 'Checking your access.'}</p></div> : !authenticated ? <AdminLogin/> : <>
      <span className="eyebrow">YOUR ACCOUNT · THE TEAM WALLET</span><h2>{visibleAccount?.state==='create'?'One wallet.\nYour floor.':visibleAccount?'Joining the team.':'Checking\nyour access.'}</h2><p className="access-identity">{user?.email?.address || 'Passkey login'}</p>
      {visibleAccount?.state==='create'?<><p>Create a Privy wallet dedicated to the floor. You will be the owner and can authorize a collaborator: same address, balance and top-ups.</p><button className="admin-primary" disabled={!!busy} onClick={()=>void run('Creating shared wallet',create)}>Create shared wallet <span>↗</span></button></>:visibleAccount?<><p>{visibleAccount.state==='unconfigured'?'Set up the owner account first. This is your Privy account code.':'The owner must authorize your account. Send them this code: no shared email or passkey needed.'}</p><div className="admin-account-code"><span>YOUR ACCOUNT CODE</span><code>{userId}</code><button className="admin-text" onClick={()=>void navigator.clipboard.writeText(userId!).then(()=>setCopied(true)).catch(()=>setError('Select and copy the account code.'))}>{copied?'Copied ✓':'Copy account code'}</button></div><button className="admin-secondary" disabled={!!busy} onClick={()=>void run('Checking access',refresh)}>Check access ↗</button></>:<><p>Checking your account permissions on the shared wallet.</p>{!error&&<span className="admin-spinner"/>}{error&&<button className="admin-secondary" disabled={!!busy} onClick={()=>void run('Refreshing',refresh)}>Retry</button>}</>}
      <button className="admin-text" disabled={!!busy} onClick={() => void exit()}>Sign out</button>
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
    try {await action();} catch {setError('Sign-in not completed. Try again or use the email code.');}
    finally {inFlight.current = false; setBusy('');}
  }
  return <><span className="eyebrow">01 / ADMIN LOGIN</span><h2>Welcome<br/>to the controls<span>.</span></h2><p>Sign in with your Privy account.<br/>The floor wallet is shared with the team.</p>
    <button className="admin-primary" disabled={!!busy} onClick={() => void run('Signing in', loginWithPasskey)}>Sign in with passkey <span>↗</span></button>
    <button className="admin-secondary" disabled={!!busy} onClick={() => void run('Creating passkey', signupWithPasskey)}>First time? Create a passkey</button>
    <div className="admin-divider">OR WITH EMAIL</div><form onSubmit={event => {event.preventDefault(); void run(sent ? 'Verifying code' : 'Sending code', async () => {if (sent) await loginWithCode({code}); else {await sendCode({email}); setSent(true);}});}}>
      <label htmlFor="admin-email">Your email</label><input id="admin-email" type="email" autoComplete="email" value={email} disabled={sent || !!busy} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com"/>
      {sent && <><label htmlFor="admin-code">Code from your email</label><input id="admin-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={!!busy} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required placeholder="000000"/></>}
      <button className="admin-primary" type="submit" disabled={!!busy}>{sent ? 'Confirm code' : 'Send me the code'} <span>↗</span></button>
      {sent && <button className="admin-text" disabled={!!busy} type="button" onClick={() => {setSent(false); setCode('');}}>Change email or request a new code</button>}
    </form>{busy && <p className="admin-message" role="status">{busy}…</p>}{error && <p className="admin-error" role="alert">{error}</p>}
    <p className="fine-print">Everyone uses their own email or passkey. Access to the shared wallet requires the owner's authorization.</p>
  </>;
}
