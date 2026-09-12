# DigitalSlotMachine integration

The ABI matches [`../../../contracts/abi/DigitalSlotMachine.json`](../../../contracts/abi/DigitalSlotMachine.json),
compiled from `contracts/src/DigitalSlotMachine.sol` in this monorepo.
The source keccak256 is recorded in `lib/slot/abi.ts` and test fixtures.
The constructor accepts a separate initial game manager so the deployment EOA
can operate games without owning the contract. No additional interfaces are
required for the implemented player flow.

## Two-stage flow

1. The player authenticates their embedded wallet on the phone and pairs the
   iPad. They choose a budget, sign `USDC.approve(slot, budget)` and add a signer
   with a policy restricted to `startSpin()` on this slot/network, with zero ETH value.
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
   are an L2 UX threshold, not equivalent to Ethereum finality.

When credits are available, the backend EOA signs `startFreeSpin(player)` with
`GAME_MANAGER_ROLE`: the recipient is bound to the session, with no USDC charge
or token approval required. The same reveal flow follows.

Logout destroys authorization for new games, but an already submitted transaction
may still be included. The keeper finishes the round for the original player.
It does not use browser sessions to choose the recipient.

## Reads, events and grid

`getContractSettings`, `getPrizeCatalog`, `getPlayerState`, `getGame`,
`getGameStatus`, `getActiveGameIds`, ERC20/ERC1155 inventories, `owner`, `hasRole`
and pending ownership transfers are read through server-side RPC.
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
design IDs, including placeholders 12–15.

Reveal events are searched only between the target and deadline (at most
256 blocks). The player's latest game is recovered from `SpinStarted` in
2,000-block pages, up to 12 pages per request, resuming on subsequent reads.
The cache verifies block hashes and rereads a 12-block margin. For wallets
without history on a very old contract, initial synchronization requires
multiple polls; new games stay blocked until it finishes. Admins browse global
IDs in pages of 20. No persistent indexer is required.

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

The owner can perform role operations. `startFreeSpin` and `revealRound` are
excluded from admin transactions: the backend handles them. No endpoint lets
the backend EOA sign arbitrary calldata.

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
The Base deployment is live but still has an empty prize catalog and zero
prize inventory. Do not enable real spins until all prizes and weights are
configured, funded and checked on-chain.
