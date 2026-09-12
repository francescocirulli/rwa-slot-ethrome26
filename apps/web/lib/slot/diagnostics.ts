import type {Address} from 'viem';
import {slotError} from './errors';

// Log only explicit public identifiers and a normalized code. SDK error messages,
// request bodies, RPC URLs, session identifiers and signing material stay private.
export function logSpinFailure(event:'slot.spin_rejected'|'slot.spin_submission_failed', player:Address,
  mode:'paid'|'free', afterGameId:string, error:unknown, stage?:string) {
  const code=slotError(error).code;
  console.warn(JSON.stringify({event,player,mode,afterGameId,
    code:/^[A-Za-z0-9_]{1,64}$/.test(code)?code:'Unavailable',...(stage?{stage}: {})}));
}
