import {BaseError, ContractFunctionRevertedError} from 'viem';
export class SlotError extends Error {constructor(public code: string, message: string, public status = 409) {super(message);}}
const messages: Record<string, string> = {
  EnforcedPause: 'La macchina è in pausa.', ExpectedPause: 'Metti prima in pausa la macchina.',
  PlayerAlreadyHasActiveGame: 'C’è già una giocata in corso per questo wallet.',
  IncompletePaytable: 'La tabella premi non è completa: il totale deve essere 100%.',
  InsufficientConfiguredPrizes: 'Servono almeno tre simboli configurati.',
  InsufficientPrizeInventory: 'Le riserve dei premi non bastano per una nuova giocata.',
  ActiveRoundsExist: 'Attendi la conclusione delle giocate attive prima di modificare la configurazione.',
  NoFreeSpins: 'Non ci sono free spin disponibili.', RevealTooEarly: 'Attendiamo il blocco previsto dal contratto.',
  RevealWindowExpired: 'Il termine per il reveal è scaduto.', RevealWindowStillOpen: 'Il termine per il reveal è ancora aperto.',
  NoPendingRound: 'La giocata è già stata conclusa.', GameNotFound: 'Giocata non trovata.',
  AccessControlUnauthorizedAccount: 'Questo wallet non ha il ruolo onchain richiesto.',
  ERC20InsufficientAllowance: 'Autorizza un budget USDC sufficiente dal telefono.',
  ERC20InsufficientBalance: 'Saldo del token insufficiente.', ProbabilityTotalExceeded: 'Il totale delle probabilità supera il 100%.',
  InvalidDividendAmount: 'L’importo ERC-20 deve essere divisibile per due nelle unità minime.',
  PaymentTokenCannotBePrize: 'USDC è il token di pagamento e non può essere un premio.',
};
export function slotError(error: unknown): SlotError {
  if (error instanceof SlotError) return error;
  const revert = error instanceof BaseError ? error.walk(cause => cause instanceof ContractFunctionRevertedError) : null;
  if (revert instanceof ContractFunctionRevertedError) {
    const name = revert.data?.errorName || 'ContractReverted';
    return new SlotError(name, messages[name] || `Il contratto ha rifiutato l’operazione (${name}).`);
  }
  return new SlotError('Unavailable', 'Connessione onchain non disponibile. Verifica lo stato prima di riprovare.', 503);
}
