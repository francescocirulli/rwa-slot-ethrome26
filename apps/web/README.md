# Wall Street Slot

Retro arcade slot machine for a shared iPad, with phone login, embedded Privy
wallets and USDC on Base. The terminal, phone and admin copy is in English; the
iPad skin uses system fonts only because the terminal CSP has no `font-src`.
The terminal opens straight on the slot with the wallet QR code in a side
panel; there is no attract screen. The header holds Info (how it works, odds,
prizes), Sound, Full screen, Settings (log out, demo switch, Arduino link) and
a toggle that hides the wallet panel so the slot fills the page. The full-screen
button uses the Fullscreen API with the WebKit prefix and hides itself where the
browser does not support it. Decorative dice, cards and chips live in
`public/decor` and are never part of the layout. Integrates `DigitalSlotMachine` from [`../../contracts`](../../contracts):
paid spins, free spins, automatic reveal and an onchain admin console.
Without a configured contract address, wallet login, holdings and pairing remain
available while game operations and reviewed wallet writes are disabled.

Before contributing, read [../../CONTRIBUTING.md](../../CONTRIBUTING.md),
[../../AGENTS.md](../../AGENTS.md) and the [web rules](AGENTS.md).

## Getting started

Use Node.js 22. Copy `.env.example` to `.env.local` and fill in the required
variables without sharing secrets in chat or the repository.

```sh
npm ci
npm run dev
```

- `/`: iPad terminal, HTML/CSS/ES5, without a React runtime or wallet SDK.
- `/phone`: standalone personal wallet, optional iPad pairing, USDC allowance,
  token/NFT balances and reviewed transfers on Base.
- `/admin`: personal Privy accounts, shared wallet, collaborators, catalog, reserves and controls.

The phone and iPad must reach the same HTTPS origin. `APP_ORIGIN` is the exact
public origin, without a path. `NEXT_PUBLIC_PRIVY_APP_ID` is public;
`PRIVY_APP_SECRET` and `SLOT_BACKEND_PRIVATE_KEY` are server-only.
Credentials are read at runtime, including in the standalone build.

## Privy and sessions

Enable email, passkeys and passkey registration, user-owned embedded Ethereum
wallets and the app's public origin. Email uses an OTP code: Privy does not
offer traditional passwords. Use a stable domain to retain passkeys between
visits. An email account can add a passkey without creating a second wallet.

The single-use QR code lasts 5 minutes and carries its secret in the URL
fragment, which the phone removes after reading it. Pairing requires comparing
the code and a backend-verified Privy JWT. The address comes from the account's
verified embedded wallets, not from the browser. Cookies are HttpOnly,
SameSite=Lax and Secure over HTTPS; mutations require the exact origin and a
dedicated header.

The shared session ends after **3 minutes of global inactivity** across iPad
and phone. Polling, animations and reads do not reset the timer. The terminal
hides data at expiry even offline and ignores late responses. Pairing the same
account again closes its previous session. The user retains the wallet and
funds. Ending or expiring the iPad pairing keeps the phone wallet signed in.
“Esci dal wallet” explicitly ends the personal Privy session.

Player and shared admin wallets have separate selection paths. Each admin
signs in with their own Privy account; all authorized users see the same wallet,
balance and funding QR code. Onchain roles are assigned to this shared address.
The owner manages access; collaborators can operate without changing ownership
or roles. Login alone does not grant access. Setup and testing:
[docs/shared-admin.md](docs/shared-admin.md).
`ADMIN_OWNER_USER_ID` identifies the account allowed to create the shared wallet;
its account code is visible after admin login. The access token authenticates APIs.
The browser's Privy session signs each wallet request with
`useAuthorizationSignature`; identity tokens are not required.
`ADMIN_WALLET_EXTERNAL_ID` selects the shared wallet: leaving it empty preserves
the existing default. To initialize a separate wallet after a trial with another
account, follow [the recovery procedure](docs/shared-admin.md#changing-accounts-after-a-trial).
The admin panel requires a modern browser; the terminal targets iPad Air in
landscape, iOS 12.5.8 / Safari 12.1.2, matching the experimental reference repo.

## Personal phone wallet

The wallet card always shows the full Base wallet address and a **Copy address**
button, without opening the receive/QR section.

Open `/phone` directly and sign in with email or passkey. A new account can create
its embedded wallet without scanning a QR. The page shows USDC, ETH for gas, all
supported equity tokens, GOLD/DGLD, and the known ERC1155 prize IDs with quantities.
`GET /api/account` verifies the Privy JWT and reads only that account's default
embedded wallet; address query parameters and pairing cookies do not select it.
Portfolio reads share a five-second cache and report unavailable values on errors.

The USDC limit is the current onchain allowance to the configured slot. A new
approval replaces that limit rather than adding to it. Revocation approves zero.
Both require explicit transaction review and wallet authorization, including gas.
Stock tokens, GOLD, USDC and NFT quantities can be sent to an external Base address.
Free spins cannot be transferred. Each transfer validates the supported asset,
verified decimals, positive integer units, recipient and current balance on the
server, then rechecks after review. ERC1155 transfers use `safeTransferFrom`;
recipients must support that token standard. No redemption of physical prizes is
performed by transferring their NFTs.

Personal approvals/transfers and lever submissions share a wallet write coordinator.
A prepared review holds a lease until cancellation or expiry; a submitted operation
holds it until a definite outcome. Spins hold it through confirmed reveal or onchain
invalidation, including after the phone disconnects. Unknown submissions cannot be
retried as new transactions. Transaction IDs are retained in session storage for
recovery; once a hash is known, receipt recovery survives a service restart. This
uses the existing single-service, in-memory architecture and adds no database or
replica. User-owned wallet requests still use exact Privy SDK request authorization,
never the keeper or shared admin wallet.

The “Scansiona QR dell’iPad” button opens the rear camera from `/phone`. Camera
access is requested only after tapping it; closing, backgrounding or decoding a QR
stops every track, including a permission response arriving after closure. If camera
access is unavailable, a photo can be selected and decoded locally. Images are not
uploaded. Only a `/phone#pair=…` URL on the current app origin with a valid secret is
accepted; scanned URLs never cause navigation. The backend still checks QR expiry
and the user must confirm the matching iPad code before pairing.

Allowance and wallet-write readiness use current contract reads and the confirmation
block, independently of spin/bonus history scans. Pending local submissions and
rounds settling within the confirmation window still block writes. RPC errors are
shown as unavailable chain data, not an expired login. Gameplay history and bonus
recovery still require an RPC supporting historical `eth_getLogs` ranges of up to
2,000 blocks. Providers with smaller plan limits must be upgraded or configured
with a compatible endpoint; the RPC URL belongs in server-side `BASE_RPC_URL`,
never in committed source.

Scanning a QR while signed in asks only to confirm the matching iPad code. The
phone distinguishes ending that pairing, revoking USDC allowance and logging out.
Three-minute inactivity applies to the shared arcade session, not wallet access.

## Gameplay and wallet separation

| Operation | Signing wallet |
| --- | --- |
| `USDC.approve(slot, budget)` | Player Privy wallet, confirmed on the phone |
| `startSpin()` | Player Privy wallet, through the session's temporary signer |
| `startFreeSpin(player)` | Backend EOA with `GAME_MANAGER_ROLE` |
| Marked `grantFreeSpins(player, 2)` | Backend EOA with `GAME_MANAGER_ROLE`; welcome history prevents repeated awards |
| `revealRound(gameId)` and expired-game cleanup | Backend EOA |
| Configuration, roles, treasury and prize deposits | Admin Privy wallet, confirmed in the browser |

On the phone, the user chooses a limited USDC budget. The backend verifies the
exact approval before enabling the signer. Its policy permits only
`eth_sendTransaction` on Base, to the slot address, with zero native value and
the `startSpin()` function. It does not allow token approvals, arbitrary
transfers or typed data. The contract deducts the current ticket price from
the allowance on each spin; the signer cannot increase it. Privy handles
paymaster authorizations and gas charges separately; they are outside the
budget approved for the slot.

Logout and expiry immediately destroy the temporary in-memory P-256 key and
attempt to delete the remote quorum. The policy does not expire independently:
the backend enforces the timer and holds the only key capable of using that
signer. Privy metadata may remain if remote cleanup fails.
**Logout does not reset the remaining USDC allowance**: the phone offers an
explicit onchain action to revoke it or replace it with another finite amount,
including without iPad pairing. If a play signer is active, it can use the new
allowance during that session. Approving USDC alone never authorizes an iPad.

The reels spin from submission until the reveal has two confirmations. The
backend waits for the block required by the contract and finishes the game even
if the phone is closed or the session has ended. The contract pays the prize to
the original player. Results are neither fabricated nor shown early through
`previewPendingResult`.

The paired phone/iPad poll reads only current USDC balance, allowance, free spins,
settings and the current round. It does not scan spin or welcome history, read the
prize catalog, or poll reserves. The iPad uses this same response for its USDC display;
the separate balance endpoint is a fallback when game reads are unavailable.
Results come from `getGame` at the confirmation depth. Known keeper receipts add
exact prize amounts and a transaction link; missing receipt details do not block a
confirmed result. Welcome history runs separately from play, and reserve checks run
before submission. Historical results remain available in admin.

The keeper recovers pending games through `getActiveGameIds` after each restart.
A new session recovers an active round from `getPlayerState`; it does not restore
old completed rounds. **No database.** Details: [docs/contracts.md](docs/contracts.md).

The earlier `personal_sign` proof remains available when no contract is connected.
It uses a separate policy limited to the exact message with a nonce/session,
runs once and verifies the wallet signature.

## Welcome bonus

New first embedded player wallets automatically receive two free spins after
creation and pairing. Eligibility uses the verified Privy creation time and the
contract deployment timestamp as the launch cutoff. The backend uses the existing
`grantFreeSpins` function and verifies marked transactions in onchain history to
prevent repeated awards, including after a restart. No contract redeployment is
needed. The iPad prominently shows the live free-spin balance;
free play needs no USDC approval and the keeper pays its gas. See
[welcome free spins](docs/welcome-free-spins.md) for eligibility, recovery and setup.

## After contract deployment

Set `SLOT_CONTRACT_ADDRESS`, its exact `SLOT_DEPLOYMENT_BLOCK` and a dedicated
`SLOT_BACKEND_PRIVATE_KEY`. The app verifies Base mainnet (8453), deployed code
and native USDC as the payment token:
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals).

Have the owner assign roles to the Privy admin wallet and `GAME_MANAGER_ROLE`
to the backend wallet. Fund the latter with ETH on Base; configure at least
3 symbols, weights totaling 1000 and prize reserves. Reveal is permissionless;
starting free spins requires the manager role.

For players and admins, `PRIVY_GAS_MODE=usdc` (the default) requires **User pays**
with USDC on Base enabled in the Privy dashboard. Gas is charged to the user's
wallet in USDC, in addition to the spin/operation amount. Only an explicit
insufficient-balance rejection before submission allows an ETH attempt from
the same wallet; timeouts and ambiguous responses do not trigger fallback.
`PRIVY_GAS_MODE=eth` uses ETH directly. The old `PRIVY_SPONSOR_TRANSACTIONS`
variable is no longer used. The backend EOA always pays its own gas in ETH.
Details and limits: [docs/gas.md](docs/gas.md).
`BASE_RPC_URL` stays private; the public RPC is a development default.

## Railway

Uses a multi-stage `Dockerfile`, Next standalone output and
[`../../.railway/railway.ts`](../../.railway/railway.ts) with the `/api/health`
healthcheck. Set service variables and use an HTTPS domain also registered in
Privy. Railway supplies `PORT`. `.env*` files are excluded from the Docker image.

Run **one always-on replica with automatic sleep disabled**. The keeper must
continue without browser requests. Sessions, keys and nonce coordination are
in memory: a deployment ends pairings but does not delete games, prizes or
credits already onchain. The backend resumes reveals from the contract.
Do not use the same EOA concurrently in other processes.

To test the production output:

```sh
npm run build
APP_ORIGIN=http://localhost:3000 HOSTNAME=0.0.0.0 PORT=3000 node --env-file=.env.local .next/standalone/server.js
```

Monorepo deployment procedures and variables:
[`../../.railway/README.md`](../../.railway/README.md).
The contract has not been deployed yet. `SLOT_BACKEND_PRIVATE_KEY=REPLACE_ME`
keeps the keeper disabled until a real key is supplied.
Arduino input now reaches `window.slotPullLever()` through the authenticated
hardware API, called directly over HTTPS by the board. No local bridge or Mac is
required. The real mode remains default;
the terminal can switch to an isolated demo without wallet or onchain requests.
Motion reveals the QR from an idle screensaver; iPad audio requires one initial
touch. See [cabinet wiring, firmware, pairing and demo setup](../../arduino/README.md).

## Validation

```sh
npm test
npm run typecheck
npm run test:browser
npm run test:chain
npm run build
```

Chain tests require `anvil` on PATH and use real contract bytecode with test
tokens, exclusively on a local blockchain. They cover player charges,
deduplication, block waiting, reveal after restart, ERC20 and ERC1155 prizes,
free-spin credits, expiry, roles and admin transactions. Fixtures are separate
from the production runtime and no real funds are moved.

Terminal browser tests use test pairing APIs and controlled onchain snapshots.
They verify both transaction stages, confirmations, the row-major grid, winning
line, logout and 1024×768 / 1024×650 layouts. Backend tests cover authentication,
exact budgets, isolation and revocation during asynchronous operations.
All terminal bundles are checked for ES5 compatibility.

Manual checks in `scripts/live-privy-check.mjs` and `scripts/live-admin-check.mjs`
create test Privy accounts with virtual passkeys and empty wallets. They neither
save credentials nor send transactions. The latter runs
`scripts/live-shared-admin-check.ts`: two identities, a test wallet separate
from the app wallet, real signatures, revocation, restart and shared funding.
Onchain submissions remain intercepted in the browser to verify gas consent,
lost responses and recovery after refresh without a second submission.
These checks are not part of the ordinary automated test suite.
The new Privy transaction submission flow still needs validation on the actual
deployment. Physical iPad and email OTP checks also remain outstanding.

## References

- [Privy: signers](https://docs.privy.io/wallets/using-wallets/signers/quickstart)
- [Privy: policies](https://docs.privy.io/controls/policies/overview)
- [Privy: sending transactions](https://docs.privy.io/wallets/using-wallets/ethereum/send-a-transaction)
- [Privy: gas sponsorship](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup)
- [Privy: email OTP](https://docs.privy.io/authentication/user-authentication/login-methods/email)

## Token inventory and swaps

The admin panel includes **Swap** (LI.FI API, USDC or native ETH → six supported
Base RWA tokens) and **Inventory** (shared wallet balances, ERC1155 prizes,
free-spin counter and reviewed contract deposits). The Swap tab also offers a
quick-fund action that adds a chosen number of rounds (1–99) to the current reserve,
buys the shortfall of the six RWA tokens with USDC and prepares the deposit
transactions in sequence. Completed top-ups can be repeated. An interrupted top-up
keeps its target across page reloads, so resuming skips confirmed deposits.
Start once, then confirm each requested signature;
approvals, swaps, balance checks and deposits advance automatically. The manual
swap form is available in a collapsed section. Admin RPC reads share batching and
`BASE_RPC_FALLBACK_URLS`; the funding path skips NFT reads and reuses concurrent
inventory requests. See
[assets and swap setup](docs/assets-and-swaps.md) for token addresses, decimal
precision, deployment mapping, Privy gas setup, collaborator permission
upgrades and recovery behavior. Both owner and authorized collaborators can
swap; gas uses the shared USDC balance with ETH fallback. Brand sources are
recorded in [public/brands/SOURCES.md](public/brands/SOURCES.md).

## Prize funding and ERC1155 management

Inventory compares the shared Privy wallet with the slot's total, reserved and
available balances, including ETH, USDC, RWA tokens and configured ERC1155 IDs.
Deposit forms accept quantities; mint can create existing NFT IDs into the shared
wallet or directly into the slot. Both use reviewed Privy transactions. The default
collection is the deployed Base address; `SLOT_PRIZE1155_ADDRESS` is optional.
Mint requires collection ownership and the updated collaborator policy. See
[setup and ownership requirements](docs/assets-and-swaps.md#inventory-and-erc1155-minting).
Admin Operations also supports two-step collection ownership transfers, including
explicitly confirmed acceptance signed by the configured backend wallet with ETH gas.

The prize catalog includes Books (symbol 12 / token ID 6), Water Bottle (13 / 7),
and Caps (14 / 8). They appear in the phone portfolio and transfer flow, admin
inventory/deposit/mint forms, prize configuration, history, terminal reels and
win displays. The terminal help and offline demo use their 2.0%, 2.1% and 5.0%
five-match odds, with 1.0% no prize. Live payouts and reserves come from the contract.

The backend rejects paid/free submissions when reserves cannot cover a round or
reserve reads fail. These checks do not block idle balance reads or settlement
polling. Confirmed wins include the exact award and BaseScan link when the keeper
receipt is available; otherwise they show the confirmed grid and win/loss without
inventing a payout amount. Gold uses jackpot artwork only on the reels.

While the server checks a requested spin, the terminal keeps the reels still and
locks repeated input. Animation starts when submission is reported or a current
round is observed. A rejected request keeps its explanation visible across polls,
without hiding the remaining free-spin balance. Railway receives structured
`slot.spin_rejected` and `slot.spin_submission_failed` records containing the
public wallet, mode, previous round and normalized error code; request payloads,
credentials and raw SDK errors are never logged.

### Phone approval and funding

During paired play setup, the phone shows one USDC approval form. Once play is
enabled, the wallet limit controls remain available for changes and revocation.
Paid play requires a verified USDC balance covering a spin before requesting
approval; free spins remain available without funding. Approval and revocation
check for USDC gas funds or ETH on Base (ETH only in ETH gas mode), including a
fresh server check before review and submission. These checks do not quote fees;
Privy determines the actual fee. Missing required balance reads block approval. The wallet
receive section provides the Base address and QR code; refresh after funding.

RPC reads and backend transaction preparation use the configured fallback endpoints
when QuickNode reports its daily request quota through JSON-RPC error `-32003`.
Genuine transaction rejections and contract reverts keep their existing behavior;
ambiguous backend submissions retain the same signed transaction and nonce.
