'use client';
import {useEffect, useState} from 'react';
import {useSigners} from '@privy-io/react-auth';
import {formatUnits, parseUnits, parseEther} from 'viem';
import {portfolioApprovalError, approvalFundingError} from '@/lib/approval-funding';
import type {Portfolio} from '@/lib/portfolio';
import type {PhoneTransaction} from './wallet';
import type {SessionView} from '@/lib/types';
import type {SlotEngine} from '@/lib/slot/engine';
type GameState = Awaited<ReturnType<SlotEngine['playView']>>;
export function PhoneGame({session, api, onSession, transaction, portfolio}: {portfolio:Portfolio|null|undefined;transaction:PhoneTransaction; session: SessionView; api: (path: string, data?: unknown, auth?: boolean) => Promise<any>; onSession: (session: SessionView) => void}) {
  const [state, setState] = useState<GameState | null>(null), [budget, setBudget] = useState('5'), [consent, setConsent] = useState(false);
  const [error, setError] = useState(''), [working, setWorking] = useState(false);
  const {addSigners} = useSigners();
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {const value = await api('/phone/game'); if (!cancelled) setState(value.configured ? value : null);}
      catch {if (!cancelled) setState(null);}
      if (!cancelled) timer = setTimeout(poll, 3000);
    }
    void poll(); return () => {cancelled = true; clearTimeout(timer);};
  }, [session.id, api]);
  if (!state) return null;
  const player = state.player, grant = session.playGrant, active = grant?.active;
  const fundingError=portfolioApprovalError(portfolio,true);
  const roundBusy=!!player?.busy;
  const amount = grant ? formatUnits(BigInt(grant.budget), 6) : budget;
  async function authorize() {
    if (working || !consent || transaction.busy || transaction.pending || roundBusy || fundingError || !portfolio?.canTransact) return;
    setWorking(true); setError('');
    try {
      if (!/^\d+(\.\d{1,6})?$/.test(amount) || parseUnits(amount, 6) <= 0n) throw new Error('Enter a valid USDC budget (up to 6 decimals).');
      const latest = await api('/phone/game');
      if (!latest.configured || !latest.player || latest.player.busy) throw new Error('Refresh the game state before approving.');
      const balanceError=approvalFundingError(latest.player.balance == null ? null : BigInt(latest.player.balance), portfolio.eth === null ? null : parseEther(portfolio.eth), latest.gasMode, BigInt(latest.settings.ticketPrice));
      if (balanceError) throw new Error(balanceError);
      const prepared: SessionView = grant ? session : await api('/phone/play/prepare', {budget: parseUnits(amount, 6).toString(), gasConsent: 'usdc-then-eth-v1'});
      onSession(prepared);
      const permission = prepared.playGrant; if (!permission) throw new Error('Permission unavailable.');
      if (latest.player.allowance !== permission.budget) await transaction.execute('approveBudget', [permission.budget]);
      await addSigners({address: session.address!, signers: [{signerId: permission.signerId, policyIds: [permission.policyId]}]});
      onSession(await api('/phone/play/activate', {}));
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Approval not completed. Try again.');}
    finally {setWorking(false);}
  }
  return <section className="phone-card phone-play-card"><span className="eyebrow">THE SLOT IS LINKED · BASE</span><h2>{active ? 'Luck is up.' : 'Pick your budget.'}</h2>
    <div className="play-facts"><span>Current spin <b>{formatUnits(BigInt(state.settings.ticketPrice),6)} USDC</b></span><span>Free spins available <b>{player?.freeSpins || '0'}</b></span></div>
    {player && BigInt(player.freeSpins) > 0n && !active && <div className="permission-note"><b>You can already play for free on the iPad.</b><p>You have {player.freeSpins} free spins. Pull the lever or press FREE SPIN: no USDC top-up or approval needed. Gas is included.</p></div>}
    {active ? <><div className="permission-note"><b>Spins enabled on the iPad.</b><p>Remaining USDC budget: {formatUnits(BigInt(player?.allowance || '0'),6)}. You can close your phone and use the lever or the button on the tablet.</p></div>{player?.game?.pending && <p className="small">Spin #{player.game.id} is waiting for the reveal. The keeper settles it even if you leave.</p>}</> : <>
      {fundingError&&<p className="permission-note">{fundingError} <a href="#wallet-funding">Fund your wallet on Base ↗</a></p>}
      <p>Approve a maximum USDC amount for the slot. Each confirmed spin deducts the current price from this budget.</p>
      <label className="budget-label" htmlFor="play-budget">USDC budget</label><input id="play-budget" inputMode="decimal" value={amount} disabled={!!grant || working || transaction.busy} onChange={event => setBudget(event.target.value.replace(',', '.'))}/>
      <div className="permission-note"><b>Spins on this slot only.</b><p>The signer can start spins but cannot raise the budget approved for the slot. Fees are handled by Privy. The permission ends at logout or after 3 minutes of global inactivity.</p></div>
      <label className="check-row"><input type="checkbox" checked={consent} disabled={working} onChange={event => setConsent(event.target.checked)}/><span>I authorize spins within this budget, plus my wallet fees. With USDC gas I also authorize the ETH fallback if USDC is not enough.</span></label>
      <button className="phone-primary" disabled={!consent || working || transaction.busy || transaction.pending || roundBusy || !!fundingError || !portfolio?.canTransact} onClick={() => void authorize()}>{working ? 'Approving…' : grant ? 'Complete the approval' : 'Approve and play'} <span>↗</span></button>
    </>}
    {transaction.pending && <div className="phone-progress" role="status">Request under verification. Waiting for a definite result.<button className="phone-text" disabled={transaction.busy} onClick={() => void transaction.check()}>Check transaction</button></div>}
    {(error || transaction.error) && <p className="phone-error" role="alert">{error || transaction.error}</p>}
    <p className="small">{state.gasMode === 'usdc' ? 'Extra fees in USDC. If they are not enough, we use ETH from your wallet on Base after a rejection before sending.' : 'Gas needs ETH in your wallet on Base.'} Free spins do not charge USDC.</p>
    {active && <p className="small">You can change or revoke the USDC approval in the “Your USDC limit” section below, even after ending the link.</p>}
    {transaction.gasToken && <p className="small">Fees for the last request: {transaction.gasToken}.</p>}
  </section>;
}
