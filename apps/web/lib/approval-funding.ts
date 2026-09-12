import {parseEther} from 'viem';
import type {Portfolio} from './portfolio';

// A balance precheck; the wallet provider still quotes the actual transaction fee.
export function approvalFundingError(usdc: bigint | null, eth: bigint | null, gasMode: string, ticketPrice?: bigint): string | null {
  if (ticketPrice !== undefined && usdc === null) return 'USDC balance unavailable. Refresh balances before approving.';
  if (ticketPrice !== undefined && usdc !== null && usdc < ticketPrice) return 'Add USDC on Base before enabling paid spins. Keep extra funds for fees.';
  if ((gasMode === 'usdc' && usdc !== null && usdc > (ticketPrice ?? 0n)) || (eth !== null && eth > 0n)) return null;
  if (eth === null || gasMode === 'usdc' && usdc === null) return 'Fee balance unavailable. Refresh balances before approving.';
  return gasMode === 'usdc' ? 'Add USDC or ETH on Base to pay approval fees.' : 'Add ETH on Base to pay approval fees.';
}

export function portfolioApprovalError(portfolio: Portfolio | null | undefined, paidPlay = false): string | null {
  if (!portfolio || paidPlay && portfolio.ticketPrice === null) return 'Balances unavailable. Refresh balances before approving.';
  const usdc = portfolio.assets.find(asset => asset.id === 'usdc');
  return approvalFundingError(usdc?.verified && usdc.balance !== null ? BigInt(usdc.balance) : null,
    portfolio.eth === null ? null : parseEther(portfolio.eth), portfolio.gasMode,
    paidPlay ? BigInt(portfolio.ticketPrice!) : undefined);
}
