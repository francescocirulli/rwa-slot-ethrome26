# Digital Slot Machine

A Foundry project for a 5x3 slot machine on Base. Users pay for a spin in native Base USDC; prizes are paid
immediately as ERC-20 tokens, ERC-1155 tokens, or free-spin credits held by the contract.

Before contributing, read [../CONTRIBUTING.md](../CONTRIBUTING.md),
[../AGENTS.md](../AGENTS.md) and the [contract rules](AGENTS.md).

> This is prototype code and has not been audited. Future L2 block hashes are influenced by Base's sequencer.
> Replace the entropy provider with verifiable randomness before using material prize value.

## Grid and paylines

The 15 cells use row-major indexes:

```text
 0   1   2   3   4
 5   6   7   8   9
10  11  12  13  14
```

Both 3/5 and 5/5 results can appear on any of these three paylines:

```text
Line 0:  5,  6, 7,  8,  9   (horizontal middle)
Line 1:  0,  1, 7, 13, 14   (top, top, middle, bottom, bottom)
Line 2: 10, 11, 7,  3,  4   (bottom, bottom, middle, top, top)
```

A 3/5 result uses the first three cells of the selected line, read from left to right. A 5/5 result uses all five.
Each spin selects exactly one paytable outcome and one line; the remaining cells are generated so they cannot create
an additional accidental win. Within each vertical column, the three symbols are always different: the same symbol
can appear at most once per column.

## Confirmed paytable

Probabilities use 1,000 buckets, so one weight unit is exactly 0.1%. Jackpot is currently excluded. The physical
prize expansion reduces `NOTHING` to 1% and assigns the released 9.1% to Books, Water Bottle, and Caps.

| Symbol ID | Frontend label | 3/5 weight | 3/5 probability | 5/5 weight | 5/5 probability | Prize kind |
|---:|---|---:|---:|---:|---:|---|
| 0 | MAGNET | 94 | 9.4% | 62 | 6.2% | ERC-1155 |
| 1 | FREE_SPIN | 73 | 7.3% | 48 | 4.8% | onchain counter |
| 2 | STOCK1 | 48 | 4.8% | 32 | 3.2% | ERC-20 |
| 3 | GADGET | 45 | 4.5% | 30 | 3.0% | ERC-1155 |
| 4 | STOCK2 | 38 | 3.8% | 26 | 2.6% | ERC-20 |
| 5 | STOCK3 | 38 | 3.8% | 26 | 2.6% | ERC-20 |
| 6 | STOCK4 | 38 | 3.8% | 26 | 2.6% | ERC-20 |
| 7 | STOCK5 | 30 | 3.0% | 20 | 2.0% | ERC-20 |
| 8 | ENS_REGISTRATION | 0 | — | 100 | 10.0% | ERC-1155 |
| 9 | URBE_HUB_DAY_PASS | 0 | — | 67 | 6.7% | ERC-1155 |
| 10 | SHIRT | 0 | — | 45 | 4.5% | ERC-1155 |
| 11 | GOLD | 0 | — | 13 | 1.3% | ERC-20 |
| 12 | BOOKS | 0 | — | 20 | 2.0% | ERC-1155 |
| 13 | WATER_BOTTLE | 0 | — | 21 | 2.1% | ERC-1155 |
| 14 | CAPS | 0 | — | 50 | 5.0% | ERC-1155 |
| — | NOTHING | — | — | 10 | 1.0% | none |

Totals:

- 3/5 outcomes: 404 buckets, or 40.4%.
- 5/5 outcomes: 586 buckets, or 58.6%.
- Nothing: 10 buckets, or 1.0%.
- Complete table: 1,000 buckets, or 100%.

Names such as `STOCK1` and `STOCK2`, artwork, and descriptions are frontend metadata. The contract stores stable
numeric IDs, token addresses, token IDs, amounts, and probabilities.

The Base mainnet deployment maps the stable labels to these assets:

| Stable label | Base mainnet asset | Token ID | 5/5 amount | 3/5 amount |
|---|---|---:|---:|---:|
| MAGNET | `LSPRIZE` (`0x8D411D8efCDb0d528E4F6659B44223264Fd0B719`) | 5 | 1 | 1 |
| FREE_SPIN | onchain counter | — | 1 | 1 |
| STOCK1 | `NVDAc` (`0xb20000000000000000000078ee7ce2fE4908108C`) | — | 0.001 | 0.0005 |
| GADGET | `LSPRIZE` (`0x8D411D8efCDb0d528E4F6659B44223264Fd0B719`) | 1 | 1 | 1 |
| STOCK2 | `SPCXc` (`0xb2000000000000000000007b9fcbd005511aCBd5`) | — | 0.001 | 0.0005 |
| STOCK3 | `AAPLc` (`0xb200000000000000000000C2e324d24d7eEcd1fb`) | — | 0.001 | 0.0005 |
| STOCK4 | `GOOGLc` (`0xb2000000000000000000002D0BA3164cc74f58B7`) | — | 0.001 | 0.0005 |
| STOCK5 | `AMZNc` (`0xb200000000000000000000d9192b6B456483C2E8`) | — | 0.001 | 0.0005 |
| ENS_REGISTRATION | `LSPRIZE` (`0x8D411D8efCDb0d528E4F6659B44223264Fd0B719`) | 2 | 1 | — |
| URBE_HUB_DAY_PASS | `LSPRIZE` (`0x8D411D8efCDb0d528E4F6659B44223264Fd0B719`) | 3 | 1 | — |
| SHIRT | `LSPRIZE` (`0x8D411D8efCDb0d528E4F6659B44223264Fd0B719`) | 4 | 1 | — |
| GOLD | `DGLD` (`0xe908475f8Beb7A138B0dc6eb5A05cb27068ffB9A`) | — | 0.001 | — |
| BOOKS | `LSPRIZE` (`0x8D411D8efCDb0d528E4F6659B44223264Fd0B719`) | 6 | 1 | — |
| WATER_BOTTLE | `LSPRIZE` (`0x8D411D8efCDb0d528E4F6659B44223264Fd0B719`) | 7 | 1 | — |
| CAPS | `LSPRIZE` (`0x8D411D8efCDb0d528E4F6659B44223264Fd0B719`) | 8 | 1 | — |

The original catalog was configured on Base mainnet at blocks `51,216,125` through `51,216,136`; the physical
prize expansion was applied at block `51,226,098`. Its onchain state is `configuredPrizeCount == 15`,
`catalogVersion == 16`, `noWinWeight == 10`, and `totalOutcomeWeight == 1,000`.

## Prize configuration

The owner or `GAME_MANAGER_ROLE` configures a symbol with:

```solidity
configurePrize(
    symbolId,
    prizeKind,
    tokenAddress,
    tokenId,
    fiveMatchAmount,
    threeMatchWeight,
    fiveMatchWeight
);
```

Prize behavior:

- ERC-20 5/5 pays `fiveMatchAmount`.
- ERC-20 3/5 is a dividend and pays `fiveMatchAmount / 2`; the amount must be exactly divisible by two.
- ERC-1155 3/5 and 5/5 both pay `fiveMatchAmount` units of the configured token ID.
- `FreeSpin` adds `fiveMatchAmount` credits to `freeSpins[player]` for either match level.
- Base USDC is accepted only as payment and is explicitly rejected as a prize.

The configured weights plus `noWinWeight` must equal exactly 1,000 before any paid or free spin can start.
`getPrizeCatalog()` returns the complete configured catalog in one frontend-friendly call, while
`getOutcomeForRoll()` makes every probability bucket directly auditable. At least three prize symbols must be
configured because each column needs three distinct symbols; the confirmed paytable configures fifteen.

## ERC-1155 prize collection

`SlotPrize1155` provides four constructor-defined launch rewards with JSON and SVG artwork returned entirely as
base64 data URIs. The recorded Base mainnet collection also includes Magnet, created after deployment with the
same fully on-chain metadata format:

| Token ID | Reward |
|---:|---|
| 1 | Gadget |
| 2 | ENS registration |
| 3 | Urbe Hub day pass |
| 4 | Shirt |
| 5 | Magnet |
| 6 | Books |
| 7 | Water Bottle |
| 8 | Caps |

The collection owner can call `mint(recipient, tokenId, amount)` or `mintBatch(...)` for existing IDs. New
sequential IDs start from 5 on a fresh deployment and can be created with an initial receiver, supply, and complete
metadata URI through `createAndMint(recipient, amount, metadataURI)`. On Base mainnet, the three expansion rewards
occupy IDs 6 through 8 and `nextTokenId` is now 9. Their JSON metadata and SVG artwork are both base64 data URIs.
The slot held exactly 20 units of every collection ID from 1 through 8 immediately after the expansion.

## Solvency

Every pending spin reserves the maximum payout for every possible ERC-20 and ERC-1155 result. A new spin reverts
before taking payment unless all possible prizes are fully backed. Free-spin prizes require no token inventory.

Because only one outcome is selected per spin, each symbol is reserved once rather than once per payline.

## Lifecycle

1. `startSpin()` transfers the ticket price in USDC and commits to a future block. The configurable delay defaults
   to five blocks.
2. Once the target block is sealed, anyone can call `revealRound(gameId)` during the configured reveal window,
   which defaults to 256 blocks and can never exceed the EVM blockhash limit.
3. The reveal selects one exact paytable bucket, chooses one of the three lines, builds the 5x3 result, and pays the
   stored player immediately.
4. If the window is missed, anyone can call `expireRound(gameId)`. The ticket remains in the contract and reserved
   prizes are released.

There is currently no column-reroll mechanism.

Each address can have at most one pending game across paid and free spins. A new request reverts with
`PlayerAlreadyHasActiveGame(player, gameId)` until the existing game is revealed or expired.

The owner or a game manager can replace a player's free-spin balance with `setFreeSpins(player, count)`, add credits
without overwriting existing ones with `grantFreeSpins(player, amount)`, and consume one credit with
`startFreeSpin(player)`. Winning a free spin increments the same onchain counter.

## Welcome bonus

The deployed Base slot supports welcome credits through the app's existing
`grantFreeSpins(player, 2)` integration. The backend distinguishes a marked
welcome transaction from manual credits, verifies its event/receipt history and
serializes submissions. This requires no contract redeployment; repeat prevention
is enforced by the app. See the [app integration](../apps/web/docs/welcome-free-spins.md).

The following native alternative exists only in the newer, undeployed source:

The owner or a game manager can call `grantWelcomeFreeSpins(player)` to add
exactly `WELCOME_FREE_SPINS` (2) credits once per wallet. Existing credits are
preserved. `welcomeFreeSpinsGranted(player)` permanently records the award, and
repeated calls revert with `WelcomeFreeSpinsAlreadyGranted`, even after the
balance is spent or reset. Both `FreeSpinsGranted` and
`WelcomeFreeSpinsGranted` are emitted on the first successful grant. The trusted
backend verifies new-wallet eligibility; the contract enforces the fixed amount
and prevents duplicates. The current app does not require this alternative.

## Frontend interface

User-facing reads:

- `getPlayerState(player)` returns free-spin balance and the single pending game ID, if any.
- `getGame(gameId)` returns the complete stored game.
- `getGameStatus(gameId)` returns `WaitingForTarget`, `Revealable`, `Expired`, `Won`, `Lost`, or `Invalidated`.
- `previewPendingResult(gameId)` returns the exact grid, symbol, match level, and line once revealable.
- `getPrizeCatalog()` returns all configured paytable entries in one call.
- `getPayline(line)` returns the five grid indexes for UI highlighting.
- `payoutAmount(symbol, matchCount)` returns the effective prize, including the 50% dividend rule.

Admin and keeper reads:

- `getContractSettings()` returns payment token, prices, reveal settings, paytable totals, pause state, active count,
  catalog version, and next game ID.
- `getActiveGameIds(offset, pageSize)` returns a bounded page of pending games for reveal/expiry automation.
- `getERC20Inventory(token)` and `getERC1155Inventory(token, tokenId)` return balance, reserved, and available
  inventory.
- `owner()`, `hasRole()`, `getRoleAdmin()` and the public role constants expose permissions.

Important receipt events are `SpinStarted`, `RoundRevealed`, `PrizePaid`, `FreeSpinsAwarded`, and `RoundExpired`.
The `gameId` for a transaction must be read from `SpinStarted`; transaction return values are not exposed in a
normal wallet receipt. Admin changes emit `PrizeConfigured`, `NoWinWeightUpdated`, `TicketPriceUpdated`,
`RevealSettingsUpdated`, `FreeSpinsSet`, `FreeSpinsGranted`, and the inherited pause/role events. User and admin
failure cases use parameterized custom errors so a frontend can show the blocking game, invalid setting, incomplete
paytable, unavailable inventory, or missing permission.

## Pause, roles, and withdrawal

- `GAME_MANAGER_ROLE`: configure the ticket, paytable, and free spins.
- `PAUSER_ROLE`: pause or unpause new paid and free spins.
- `TREASURER_ROLE`: withdraw ERC-20, ERC-1155, or accidentally received native ETH.

Reveals and expiry cleanup remain callable while paused. Withdrawals require both `paused == true` and
`activeRoundCount == 0`. The default admin/owner uses OpenZeppelin's delayed two-step transfer.

Without redeployment, the owner or game manager can change:

- ticket price;
- future-block delay and reveal-window duration;
- no-win probability;
- each symbol's token, token ID, prize amount, 3/5 probability, and 5/5 probability;
- promotional free-spin balances;
- delegated roles and pause state through the corresponding privileged functions.

The payment token remains immutable Base USDC. Grid dimensions, paylines, vertical uniqueness, the 1,000-bucket
probability denominator, and the 256-block maximum window are protocol rules rather than operational settings.

## Base deployment

- Base chain ID: `8453`
- Native USDC payment token: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- ERC-1155 prizes: [`0x8D411D8efCDb0d528E4F6659B44223264Fd0B719`](https://base.blockscout.com/address/0x8D411D8efCDb0d528E4F6659B44223264Fd0B719) (verified source)
- Slot machine: [`0xc0253B67E835500aC9a69214fa4F2Bbce61CA72c`](https://base.blockscout.com/address/0xc0253B67E835500aC9a69214fa4F2Bbce61CA72c) (verified source)
- Ticket: `0.05 USDC` (`50,000` base units)
- Slot owner: `0xC81f6728a10B20a8981d5C2601Aa185417229035`
- Initial game manager and current ERC-1155 owner: `0x8e251547f0fD650e0573711EF733F13eBA1505aD`

The deployed slot was built from the source pinned in
[`deployments/base-mainnet.json`](deployments/base-mainnet.json). It predates
`grantWelcomeFreeSpins` and is not upgradeable. The current source and generated
ABI include welcome credits for a future deployment. Do not assume new source
features exist at the recorded address. The app awards welcome credits on that
existing deployment through `grantFreeSpins` and verified transaction history.

```sh
forge test
forge script script/DeployBase.s.sol:DeployBase --rpc-url "$BASE_RPC_URL" --broadcast
```

The deployment starts with the 10.1% no-win weight and an otherwise empty paytable. The configuration script first
reduces it to 1%, then configures all 15 entries with their real token addresses, token IDs, and prize amounts.
Fund every prize and confirm `totalOutcomeWeight() == 1000` before opening spins.

Machine-readable addresses and deployment transactions are recorded in
[`deployments/base-mainnet.json`](deployments/base-mainnet.json). Standalone frontend ABIs are available in
[`abi/DigitalSlotMachine.json`](abi/DigitalSlotMachine.json) and [`abi/SlotPrize1155.json`](abi/SlotPrize1155.json).

See [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) for the outcome-generation and inventory rationale.

## ENS voucher redemption

The existing ENS prize (ID 2) is transferred directly to
`0x000000000000000000000000000000000000dEaD` on Base. No Base redemption
contract is deployed. The transfer calldata binds the reservation and the
backend verifies the finalized receipt and ERC1155 event before fulfilling it.
This transfer does not burn the token or reduce its supply.
`SlotENSRegistrar` uses the real ENSv2 UserRegistry and PermissionedResolver on
Sepolia, with a backend-attested Base transaction/log identifier that can be
used only once. The player owns the name and resolver; the backend controls the
parent namespace. See the [ENS setup and trust model](../apps/web/docs/ens.md)
for configuration, fees, finality and recovery requirements.
