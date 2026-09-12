import {BaseError, ContractFunctionRevertedError} from 'viem';
export class SlotError extends Error {constructor(public code: string, message: string, public status = 409) {super(message);}}
const messages: Record<string, string> = {
  EnforcedPause: 'The machine is paused.', ExpectedPause: 'Pause the machine first.',
  PlayerAlreadyHasActiveGame: 'This wallet already has a spin in progress.',
  IncompletePaytable: 'The prize table is incomplete: the total must be 100%.',
  InsufficientConfiguredPrizes: 'Servono almeno tre simboli configurati.',
  InsufficientPrizeInventory: 'Prize reserves are not enough for a new spin.',
  ActiveRoundsExist: 'Wait for active spins to settle before changing the configuration.',
  NoFreeSpins: 'No free spins available.', RevealTooEarly: 'Waiting for the block required by the contract.',
  RevealWindowExpired: 'The reveal window has expired.', RevealWindowStillOpen: 'The reveal window is still open.',
  NoPendingRound: 'This spin has already been settled.', GameNotFound: 'Spin not found.',
  AccessControlUnauthorizedAccount: 'This wallet does not have the required onchain role.',
  ERC20InsufficientAllowance: 'Approve a sufficient USDC budget from your phone.',
  ERC20InsufficientBalance: 'Insufficient token balance.', ProbabilityTotalExceeded: 'The probability total exceeds 100%.',
  InvalidDividendAmount: 'The ERC-20 amount must be divisible by two in base units.',
  PaymentTokenCannotBePrize: 'USDC is the payment token and cannot be a prize.',
};
export function slotError(error: unknown): SlotError {
  if (error instanceof SlotError) return error;
  const revert = error instanceof BaseError ? error.walk(cause => cause instanceof ContractFunctionRevertedError) : null;
  if (revert instanceof ContractFunctionRevertedError) {
    const name = revert.data?.errorName || 'ContractReverted';
    return new SlotError(name, messages[name] || `Il contratto ha rifiutato l’operazione (${name}).`);
  }
  return new SlotError('Unavailable', 'Onchain connection unavailable. Check the status before retrying.', 503);
}
