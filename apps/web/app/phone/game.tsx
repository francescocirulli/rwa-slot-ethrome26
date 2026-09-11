'use client';
import {useEffect, useState} from 'react';
import {useSigners} from '@privy-io/react-auth';
import {formatUnits, parseUnits} from 'viem';
import {TransactionConfirmation} from '@/lib/slot/transaction-review';
import {useContractTransaction} from '@/lib/slot/use-transaction';
import type {SessionView} from '@/lib/types';
import type {SlotSnapshot} from '@/lib/slot/reader';
type GameState = SlotSnapshot & {keeper: {configured: boolean; canStartFreeSpin: boolean}};
export function PhoneGame({session, api, onSession, onConfigured}: {session: SessionView; api: (path: string, data?: unknown, auth?: boolean) => Promise<any>; onSession: (session: SessionView) => void; onConfigured: (configured: boolean) => void}) {
  const [state, setState] = useState<GameState | null>(null), [budget, setBudget] = useState('5'), [consent, setConsent] = useState(false);
  const [error, setError] = useState(''), [working, setWorking] = useState(false);
  const {addSigners} = useSigners(), transaction = useContractTransaction(session.address!);
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {const value = await api('/phone/game'); if (!cancelled) {setState(value.configured ? value : null); onConfigured(!!value.configured);}}
      catch { /* Parent session poll handles expiry. */ }
      if (!cancelled) timer = setTimeout(poll, 3000);
    }
    void poll(); return () => {cancelled = true; clearTimeout(timer);};
  }, [session.id, api, onConfigured]);
  if (!state) return null;
  const player = state.player, grant = session.playGrant, active = grant?.active;
  const amount = grant ? formatUnits(BigInt(grant.budget), 6) : budget;
  async function authorize() {
    if (working || !consent) return;
    setWorking(true); setError('');
    try {
      if (!/^\d+(\.\d{1,6})?$/.test(amount) || parseUnits(amount, 6) <= 0n) throw new Error('Inserisci un budget USDC valido (massimo 6 decimali).');
      const prepared: SessionView = grant ? session : await api('/phone/play/prepare', {budget: parseUnits(amount, 6).toString(), gasConsent: 'usdc-then-eth-v1'});
      onSession(prepared);
      const permission = prepared.playGrant; if (!permission) throw new Error('Permesso non disponibile.');
      const latest = await api('/phone/game');
      if (latest.player.allowance !== permission.budget) await transaction.execute('approveBudget', [permission.budget]);
      await addSigners({address: session.address!, signers: [{signerId: permission.signerId, policyIds: [permission.policyId]}]});
      onSession(await api('/phone/play/activate', {}));
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Autorizzazione non completata. Riprova.');}
    finally {setWorking(false);}
  }
  return <section className="phone-card phone-play-card"><span className="eyebrow">LA SLOT È COLLEGATA · BASE</span><h2>{active ? 'Tocca alla fortuna.' : 'Scegli il tuo budget.'}</h2>
    <div className="play-facts"><span>Giocata attuale <b>{formatUnits(BigInt(state.settings.ticketPrice),6)} USDC</b></span><span>Free spin disponibili <b>{player?.freeSpins || '0'}</b></span></div>
    {active ? <><div className="permission-note"><b>Giocate abilitate sull’iPad.</b><p>Budget USDC residuo: {formatUnits(BigInt(player?.allowance || '0'),6)}. Puoi chiudere il telefono e usare la leva o il pulsante sul tablet.</p></div>{player?.game?.pending && <p className="small">Giocata #{player.game.id} in attesa del reveal. Il backend la conclude anche se esci.</p>}</> : <>
      <p>Autorizza alla slot un importo massimo di USDC. Ogni giocata confermata scala il prezzo corrente da questo budget.</p>
      <label className="budget-label" htmlFor="play-budget">Budget USDC</label><input id="play-budget" inputMode="decimal" value={amount} disabled={!!grant || working || transaction.busy} onChange={event => setBudget(event.target.value.replace(',', '.'))}/>
      <div className="permission-note"><b>Solo giocate su questa slot.</b><p>Il signer può avviare giocate senza aumentare il budget autorizzato alla slot. Le commissioni sono gestite da Privy. Il permesso termina al logout o dopo 3 minuti di inattività globale.</p></div>
      <label className="check-row"><input type="checkbox" checked={consent} disabled={working} onChange={event => setConsent(event.target.checked)}/><span>Autorizzo le giocate entro questo budget, più le commissioni del mio wallet. Con gas USDC autorizzo il fallback in ETH se gli USDC non bastano.</span></label>
      <button className="phone-primary" disabled={!consent || working || transaction.busy || transaction.pending} onClick={() => void authorize()}>{working ? 'Autorizzazione in corso…' : grant ? 'Completa autorizzazione' : 'Autorizza e gioca'} <span>↗</span></button>
    </>}
    {transaction.pending && <div className="phone-progress" role="status">Richiesta in verifica. Attendiamo un esito certo.<button className="phone-text" disabled={transaction.busy} onClick={() => void transaction.check()}>Verifica transazione</button></div>}
    {(error || transaction.error) && <p className="phone-error" role="alert">{error || transaction.error}</p>}
    <p className="small">{state.gasMode === 'usdc' ? 'Commissioni aggiuntive in USDC. Se non bastano, usiamo ETH del tuo wallet su Base dopo un rifiuto prima dell’invio.' : 'Per il gas serve ETH nel tuo wallet su Base.'} I free spin non addebitano USDC.</p>
    {active && <><button className="phone-text" disabled={transaction.busy || transaction.pending} onClick={() => void transaction.execute('approveBudget', ['0']).catch(() => {})}>Azzera il budget residuo</button><p className="small">Per scegliere un nuovo budget, termina il collegamento all’iPad e scansiona il nuovo QR. Al logout il signer viene disattivato; l’approvazione USDC residua resta sul contratto finché la azzeri.</p></>}
    {transaction.gasToken && <p className="small">Commissioni dell’ultima richiesta: {transaction.gasToken}.</p>}
    <TransactionConfirmation review={transaction.review} onDecision={transaction.decide}/>
  </section>;
}
