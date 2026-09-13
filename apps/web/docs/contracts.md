# DigitalSlotMachine integration

The ABI matches [`../../../contracts/abi/DigitalSlotMachine.json`](../../../contracts/abi/DigitalSlotMachine.json),
compiled from `contracts/src/DigitalSlotMachine.sol` in this monorepo.
The source keccak256 is recorded in `lib/slot/abi.ts` and test fixtures.
The constructor accepts a separate initial game manager so the deployment EOA
can operate games without owning the contract. The current source adds welcome
credit interfaces beyond the original immutable Base deployment.

## Two-stage flow

1. The player authenticates their embedded wallet on the phone and pairs the
   iPad. A verified positive USDC allowance is reused without another token
   approval, even when the remainder is below a ticket price. With zero allowance,
   they choose a budget and sign `USDC.approve(slot, budget)`. They authorize a
   fresh session signer with a policy restricted to `startSpin()` on this slot/network, with zero ETH value.
2. The lever/button sends a request authenticated by the iPad session. The
   backend derives the player from that session and checks state, balance,
   allowance, the reveal service and consent. The signer sends `startSpin()`
   from the **player** wallet. The call immediately returns a status to monitor.
3. The ID comes from the receipt's `SpinStarted` event, filtered by contract
   and player. The ticket is charged in this transaction, not during reveal.
4. The keeper reads active games. At `targetBlock + 1`, it can send
   `revealRound(gameId)` from its own EOA; `targetBlock` itself is too early.
   The grid keeps moving until reveal.
5. The contract stores the result and pays the original player atomically.
   The app reads `getGame`, `getGameStatus`, `RoundRevealed` and `PrizePaid`,
   then waits for two confirmations before stopping the grid. Two confirmations
   are an L2 UX threshold, not equivalent to Ethereum finality. An accepted spin
   keeps animating for at least five seconds. A fast confirmed result waits only
   for the remaining visual time; a slower result is never revealed early.
   New inputs remain locked until the result is shown, and session cleanup
   cancels the presentation timer.

`POST /api/relay/phone/play/prepare` accepts `reuseAllowance: true` with the
exact integer `budget` displayed on the phone. Reuse requires a fresh matching
onchain allowance greater than zero; it does not require one full ticket or
request a token approval. Activation rechecks the allowance and signer permission.
An inactive prepared signer can adopt that verified remaining limit.

When credits are available, the backend EOA signs `startFreeSpin(player)` with
`GAME_MANAGER_ROLE`: the recipient is bound to the session, with no USDC charge
or token approval required. The same reveal flow follows.

Logout destroys authorization for new games, but an already submitted transaction
may still be included. The keeper finishes the round for the original player.
It does not use browser sessions to choose the recipient.

## Welcome credits

After verified onboarding, the keeper calls the existing `grantFreeSpins(player, 2)`
with a fixed public welcome marker appended to its calldata. The deployed contract
accepts the marker and emits `FreeSpinsGranted`. The backend verifies the marked
transaction and its receipt in the player's event history before allowing another
send. Admin promotions use ordinary unmarked calldata and remain independent.
Neither spending credits nor resetting their balance permits a second bonus.

The history scan must be complete, and its keeper nonce must still match before
signing. Reveals, free-spin starts and welcome credits share one nonce queue.
RPC failures never establish that a bonus is unclaimed. No deployment change is
needed; see [welcome free spins](welcome-free-spins.md) for the marker, recovery
rules and the single-writer assumption.

## Reads, events and grid

`getContractSettings`, `getPrizeCatalog`, `getPlayerState`, `getGame`,
`getGameStatus`, `getActiveGameIds`, ERC20/ERC1155 inventories, `owner`, `hasRole`,
pending ownership transfers and welcome grant history are read through server-side RPC.
RPC URLs and keys are not passed to the browser.

The contract grid is **row-major**: index `row * 5 + column`. The iPad converts
it to the order of its five reels. The three paylines are:

```text
[ 5,  6, 7,  8,  9]
[ 0,  1, 7, 13, 14]
[10, 11, 7,  3,  4]
```

The first `matchCount` cells of `winningLine` are highlighted. For ERC20,
a 3/5 result pays half the 5/5 amount; ERC1155 and free spins pay the full
quantity. The client does not randomly reconstruct the result or show it
early through `previewPendingResult`. Amounts are transmitted as integer
strings, without floating-point arithmetic for monetary calculations.

`PrizePaid` preserves the token, token ID, kind and actual amount paid. History
does not use the current catalog to calculate past prizes. ERC20 formatting
reads `symbol` and `decimals`; if the token does not expose them, it displays
base units. Visual symbol labels are defined in the app and match the contract
design IDs, including Books (12), Water Bottle (13), Caps (14), and the reserved placeholder 15.

The paired play endpoint does not call `eth_getLogs`. It reads current and
confirmation-depth player state, USDC balance/allowance, settings, and the current
round. A round ID is retained from an observed active game or a verified start
receipt. The keeper also retains the IDs it recovers before revealing. Browser
reloads reuse this process state; after a process restart sessions must pair again
and recover active games only. Previously completed rounds belong in admin history.

A result is displayed only when `getGame` at the configured confirmation depth
contains the result. A known keeper reveal receipt supplies `PrizePaid` details and
the transaction link after checking its successful status, recipient/game and
canonical block hash. Receipt or token-metadata failures do not block a confirmed
grid. An outside reveal can settle the UI without a receipt hash; no amount is
inferred from the current prize catalog. An unreadable current round locks new
spins while still returning readable wallet balances.

Admin history continues to scan bounded event ranges: reveal events within the
reveal window and player spins in resumable pages. Automatic welcome grants retain
the separate marked-history check for duplicate prevention; the play poll only
reads its in-memory status. A bonus scan failure cannot hide existing free spins.

## Play availability and confirmed results

Reserve checks run before paid/free submission, rather than on every paired poll.
The backend mirrors `_maximumPayout` and sums requirements when multiple symbols
share one ERC20 or one ERC1155 collection/ID. Existing reservations cannot cover a
new round. Missing reserve data rejects the new request. Simulation and onchain
reservation remain the final check against changes before transaction inclusion.
The terminal displays the submission error and retains balances and completed
results. It no longer presents reserve RPC failures as indefinite initialization.

Per-wallet write coordination, idempotent start receipts, session authorization
and the confirmation-depth active-game check remain required. An uncertain send
never permits a second ticket. Jackpot artwork is limited to reel symbol 11;
DGLD payouts remain Gold.

## Admin commands

The console reads real roles. The backend prepares calldata from a closed set
of actions, validates inputs and simulates using the shared wallet address
resolved from the authenticated Privy account's permissions. The browser shows
the transaction and fees for confirmation. The backend retains an immutable
request, rechecks roles and parameters, and forwards submission to Privy after
the browser's `useAuthorizationSignature` signs the exact Node SDK request bytes.
The channel is bound to the access-token account and passes the signature through
`sign_fns`: the shared admin wallet signs, without the keeper key or iPad signer.
The contract enforces roles and preconditions again when the transaction is mined.

- Pause/unpause (`PAUSER_ROLE`).
- Price, timing, probabilities, prizes and free-spin grants/balances (`GAME_MANAGER_ROLE`).
- ERC20/ERC1155/ETH withdrawals (`TREASURER_ROLE`, paused and zero pending rounds).
- Roles and delayed administration transfer (owner).
- Deposits of configured tokens through `transfer` / `safeTransferFrom`.
- ERC1155 mint to the shared wallet or slot, when the shared address owns the configured collection; ownership acceptance by the wallet owner account. See [inventory and mint](assets-and-swaps.md#inventory-and-erc1155-minting).

The owner can perform role operations. `startFreeSpin` and `revealRound` are
excluded from admin transactions: the backend handles them. Welcome grants
use the backend's fixed marked `grantFreeSpins(player, 2)` call; manual admin
grants use ordinary calldata. No endpoint lets the backend EOA sign arbitrary calldata.

Price, catalog and timing can change only with no pending rounds. At least
three symbols must be configured and weights must total 1000. One weight unit
is 0.1%. Forms specify the required base units: for USDC, 1 USDC = 1000000.
The payment token cannot be an ERC20 prize.

## Keeper without a database

The service starts through the Next server's Node instrumentation. Each cycle
reads `getActiveGameIds` in pages of 100 at a fixed block, then serves rounds
by deadline. Backend transactions share a queue and nonce stream. The hash is
calculated before submission: if the RPC response is lost, the same signed
transaction is rebroadcast. A pending nonce blocks new backend writes until
resolved. There is no automatic fee bump; admins see the pending hash and
service errors.

Player requests use a per-wallet lock and an idempotency key derived from the
network, contract, player and latest observed game. Duplicate clicks and
paid/free switches for the same request do not create two tickets. The key is
also passed to Privy. An ambiguous outcome remains under verification; it is
not presented as a definitive failure that immediately permits another send.
Onchain state takes precedence over temporary request records.

A restart loses pairings and temporary keys, but the keeper recovers active
games from the contract. If `block > revealDeadline`, it calls `expireRound`,
releasing reserves and invalidating the game. **The contract does not refund
an expired ticket**; the UI explains this. The keeper must stay online and funded.

Run one always-on Railway replica and a dedicated EOA unused by other processes.
A distributed database would only be needed for multiple replicas or services
requiring persistent coordination.

## Configuration after deployment

The current Base mainnet slot is
[`0xc0253B67E835500aC9a69214fa4F2Bbce61CA72c`](https://base.blockscout.com/address/0xc0253B67E835500aC9a69214fa4F2Bbce61CA72c),
deployed at block `51208577`. It uses native Base USDC and a `0.05 USDC`
ticket. Addresses and transaction hashes are recorded in
[`../../../contracts/deployments/base-mainnet.json`](../../../contracts/deployments/base-mainnet.json).
This immutable deployment predates the optional native welcome function. Automatic
welcome credits use its existing `grantFreeSpins` interface and verified transaction
history; retain the address and deployment block below.

```dotenv
SLOT_CONTRACT_ADDRESS=0xc0253B67E835500aC9a69214fa4F2Bbce61CA72c
SLOT_DEPLOYMENT_BLOCK=51208577
SLOT_BACKEND_PRIVATE_KEY=
BASE_RPC_URL=https://mainnet.base.org
PRIVY_GAS_MODE=usdc
ADMIN_OWNER_USER_ID=
```

The private key is `0x` plus 64 hexadecimal characters, server-only. The payment
token must be native Base USDC. Grant the backend the manager role for free
spins; reveal is permissionless. The Privy admin wallet must be the owner or
have the required roles. Fund the backend with ETH and supply prize reserves.

Configure **User pays → USDC on Base** in the Privy dashboard. The default mode
requests USDC gas from the Privy wallet and switches to ETH only after a definitive
insufficient-balance rejection before submission. Phone consent and admin
confirmation include this choice; gas is additional to the budget.
`PRIVY_GAS_MODE=eth` forces ETH. The backend wallet remains a regular EOA that
pays its own ETH gas. The `personal_sign` proof consumes no gas.
See [gas.md](gas.md) for submission, deduplication and recovery limits.

Budget approval is limited, not unlimited. Logout revokes the signer, not the
onchain allowance; it can be reset from the phone. A new visit requires new
consent. `startSpin()` uses the price in effect when mined and accepts no
`maxPrice` parameter: the app checks before submission and limits exposure
through allowance, but does not promise an atomic price lock between UI and mining.

## Validation

`npm run test:chain` starts local Anvil, deploys the exact bytecode and tests
ERC20, ERC1155, free spins, expiry, roles and keeper restart. Public Anvil keys
are confined to tests; fixtures are not imported by the app.
`npm run test:browser` verifies visual stages with controlled snapshots.
The Base deployment includes the 15-symbol catalog from the physical prize expansion.
Current configuration and reserves are always checked onchain before enabling spins;
the recorded deployment inventory is not a guarantee of remaining stock.
