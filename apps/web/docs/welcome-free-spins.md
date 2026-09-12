# Welcome free spins

A player's first embedded Ethereum wallet receives **two free-spin credits**
automatically after Privy exposes it in the authenticated phone flow, without
requiring an iPad pairing or a working balance RPC. The backend
EOA pays the Base ETH gas. The player does not need ETH, USDC, a budget approval
or a transaction signature to receive or use these credits.

## Eligibility and trigger

- The server verifies the Privy access token and obtains the embedded wallet
  from the authenticated account. Client-supplied addresses, amounts and
  creation flags cannot select the recipient or change the award.
- Only the account's embedded Ethereum wallet at `wallet_index == 0` qualifies.
  Its address and creation timestamp are checked against Privy's wallet API;
  imported or archived wallets cannot receive the bonus. Missing or temporarily
  unavailable metadata stays retryable rather than permanently rejecting a new wallet.
- The contract's configured deployment block supplies a durable launch cutoff.
  The wallet must have been created at or after that block's timestamp. Existing
  wallets created before deployment do not receive an automatic welcome bonus;
  an admin can still grant them promotional credits through `grantFreeSpins`.
- The phone retries authenticated, same-origin `POST /api/account/welcome`
  every five seconds until crediting is confirmed. It accepts no payee or amount
  and works without a tablet session. Pairing retains its existing recovery
  endpoint too. Neither flow renews the three-minute idle timer.
- Signing in to the admin panel does not trigger a player welcome grant.

## Existing contract and keeper

The backend calls the already deployed `grantFreeSpins(player, 2)` function.
The recipient is bound to verified onboarding, and the amount is fixed by the
server. This adds to existing credits; it never uses `setFreeSpins` to replace
the balance. The keeper needs `GAME_MANAGER_ROLE` or contract ownership.
No new contract deployment, database, Privy setting or secret is required.

To distinguish welcome credits from ordinary admin promotions, the backend
appends a stable public 32-byte marker to the transaction input:
`keccak256("rwa-slot:welcome-free-spins:v1")`. The original Solidity contract
accepts the extra word after its two static arguments, ignores it when decoding,
and emits its existing `FreeSpinsGranted(player, amount, newCount)` event.
Compatibility is tested against the exact deployed creation bytecode on Anvil.
The marker is never added to normal admin `grantFreeSpins` calls.

Before crediting, the app scans that player's grant events from five minutes
before the server-verified key-creation timestamp, clamped to slot deployment.
A binary search resolves this block without scanning unrelated history. This
bound is only for verified generated, non-imported first wallets; internal calls
without that proof scan from deployment. The player-history floor is never used
for bonus deduplication. Only a successful transaction to this slot with zero ETH value,
the exact marked calldata, a two-credit event and matching transaction/receipt
block hashes establishes a welcome bonus. Manual credits, won credits and the
current free-spin balance cannot establish or reset that record. The history
also recognizes the native welcome function if used on a future contract, but
the app does not require or call that function.

Scans honor `SLOT_LOG_PAGE_BLOCKS` (2,000 by default; five on the current
production RPC), with at most 12 pages per request. A partial scan
leaves the bonus checking; it never authorizes a write. Progress stays in memory,
with block-hash checks to invalidate caches after a reorg. RPC, transaction or
receipt lookup failures do not advance a negative scan. Completed grants remain
recoverable from chain history after logout, spending, resetting the balance,
restarting the service or rotating the keeper key.

Claims are enqueued before RPC checks, so a failed initial request does not
lose the work. Pending claims rotate fairly, and incomplete scans are retried
without the old ten-second backoff.

The keeper repeats the history check inside its serialized nonce queue, after
pending reveals. A negative scan must cover the same keeper nonce used for the
new transaction. Nonces and the scanned block hash are checked again before
signing, so a stale negative history result cannot authorize a fresh nonce after
an earlier grant has mined. Pending keeper transactions block further sends.
The transaction hash is computed before broadcasting; an ambiguous response only
allows rebroadcasting identical signed bytes, never an automatic second nonce.

This is an application-level once-per-wallet bonus. The existing contract still
allows authorized managers to call `grantFreeSpins` repeatedly. The public marker
is not an authorization mechanism: an authorized manager deliberately submitting
the exact marked grant creates a real bonus and is recognized as such. Run one
always-on service, use a dedicated keeper EOA, and stop its previous process
before restarting or rotating its key. Multiple writers need durable coordination.
This is not proof of a unique person across separate accounts.

Unsent requests are in memory. If the process stops before broadcasting, the
player must reconnect to recreate the authenticated request. A submitted grant
is recovered from its pending nonce or mined event. Missing roles, insufficient
keeper ETH and temporary RPC errors leave the bonus available for retry.

## Player display

The main iPad screen shows a large free-spin balance above the reels, separate
from USDC. Available credits highlight the free-spin button, and the lever uses
free credits before paid spins. The pending welcome message does not increase
the displayed balance: only the contract read does. The counter follows spending
and rewards, shows an unavailable balance while offline, and clears on logout
or a change of player. The phone shows pending/credited welcome status and
refreshes the wallet after confirmation, without fabricating a balance. It explains that available free spins need no
USDC approval.

## Configuration and validation

The current Base slot at `0xc0253B67E835500aC9a69214fa4F2Bbce61CA72c`, deployed
at block `51208577`, supports this flow as it stands. Keep its existing address,
deployment block and server-only `SLOT_BACKEND_PRIVATE_KEY`. The keeper must have
the manager role and ETH on Base. An unset contract or the disabled backend-key
placeholder still permits login but cannot credit a bonus.

Unit tests cover eligibility, authenticated recovery, unchanged idle deadlines,
manual-versus-welcome history, bounded scans, lookup failures and reorgs. Anvil
tests use the deployed bytecode to verify additive crediting, zero player charge,
restart recovery, spent/reset balances, lost responses, pending nonces, stale
RPC snapshots and keeper rotation. Browser tests cover the counter states at
iPad sizes and standalone phone recovery with failed balance reads and reloads. These tests use disposable local accounts and do not send Base transactions.

Privy documents wallet `created_at` in milliseconds in its [wallet API](https://docs.privy.io/api-reference/wallets/get). The app does not use a browser-supplied timestamp.
