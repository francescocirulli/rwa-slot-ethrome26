# Game design report

## Confirmed model

- Grid: five columns by three rows.
- Winning shapes: exactly the three paylines documented in the README.
- Winning levels: three consecutive symbols from the left (3/5), or five equal symbols (5/5).
- Outcome probabilities: direct paytable probabilities, not per-cell symbol probabilities.
- Payment: Base USDC only. USDC cannot be configured as a prize.
- Rewards: ERC-20, ERC-1155, or free-spin counter credits.
- Dividend: an ERC-20 3/5 result pays exactly half the configured 5/5 amount.
- Jackpot: disabled; its 0.1% bucket is assigned to the no-win result.
- Column reroll: removed from the current version.
- Column uniqueness: the same symbol may appear at most once among the three cells of any vertical column.
- Player concurrency: one pending paid or free spin per address.

## Outcome-first generation

The previous design drew every cell independently and calculated whether the resulting grid happened to contain a
win. That cannot reproduce a paytable whose percentages describe complete outcomes.

The current design instead uses 1,000 explicit probability buckets:

```text
0 ... 100       -> NOTHING       (101 buckets / 10.1%)
remaining range -> configured 3/5 and 5/5 symbol entries
```

The eight 3/5 entries occupy 404 buckets and the twelve 5/5 entries occupy 495 buckets. Together with the 101
no-win buckets, every random roll maps to exactly one outcome.

After choosing the outcome, separate entropy chooses one of the three paylines. The contract fills the remaining
cells column by column, without repeating a symbol vertically. In a 3/5 result, the winning symbol is placed away
from the selected payline in columns four and five so each column remains complete without extending the win to
5/5. A no-win grid is sanitized by swapping two cells in the first column if a payline accidentally begins with
three matching symbols; swapping preserves vertical uniqueness.

Consequences:

- The configured percentages describe the final result directly.
- A result cannot accidentally create a second prize or a larger 5/5 prize from a selected 3/5 outcome.
- Filler-symbol frequency is cosmetic and does not affect prize probability.
- At most one prize is paid per spin.
- Every generated column contains three distinct configured symbols.

## Combination-to-prize mapping

Each symbol stores one prize definition and two outcome weights:

```text
symbolId -> {
    prize kind,
    token address,
    token ID,
    configured 5/5 amount,
    3/5 probability weight,
    5/5 probability weight
}
```

The payout is resolved as follows:

```text
ERC-20 + 5/5   -> fiveMatchAmount
ERC-20 + 3/5   -> fiveMatchAmount / 2
ERC-1155       -> fiveMatchAmount units for either configured match level
FreeSpin       -> fiveMatchAmount credits for either configured match level
```

An ERC-20 symbol with a nonzero 3/5 weight must have an even base-unit amount so the dividend division is exact.
For example, `STOCK1` is stored once; its dividend and full-token outcomes reuse the same token address without
duplicating prize configuration.

## Exact paytable invariants

One weight is 0.1%, and the complete table must satisfy:

```text
noWinWeight
+ sum(all threeMatchWeight)
+ sum(all fiveMatchWeight)
= 1,000
```

Configuration is allowed while the total is temporarily below 1,000, but paid and free spins revert until it is
exactly complete. Configuration that would exceed 1,000 is rejected. Changes are blocked while any reveal is
pending, so a committed spin always uses the catalog version it was opened against. Spins also require at least
three configured symbols, the mathematical minimum needed to populate a three-cell column without repetition.

`getOutcomeForRoll(roll)` exposes the outcome assigned to any bucket from 0 through 999, allowing tests, admin
tools, and frontend diagnostics to verify the live paytable without statistical sampling.

## Inventory invariant

For each active spin, the contract reserves the maximum possible payout of every configured external prize:

- An ERC-20 with a possible 5/5 outcome reserves the full configured amount.
- A dividend-only ERC-20 reserves half the configured amount.
- An ERC-1155 reserves the configured quantity for its token ID.
- A free-spin outcome needs no external inventory.

Although only one prize can win, reserving every possible asset guarantees immediate delivery for whichever bucket
is selected. If two symbols reference the same token, their reservations are added. A spin reverts atomically if
any prize inventory is insufficient, so its USDC payment is not retained.

## Free-spin accounting

`freeSpins[player]` is the single source of truth for both promotional and won credits:

- An owner or game manager can set the balance with `setFreeSpins` or add to it safely with `grantFreeSpins`.
- An owner or game manager starts a credited spin on behalf of the player with `startFreeSpin`.
- A `FreeSpin` prize increments the same balance.
- `FreeSpinConsumed` and `FreeSpinsAwarded` expose both directions to indexers and frontends.

## Active-game indexing and settings

`activeGameId[player]` prevents the same player from opening another paid or free spin until the current one is
revealed or expired. A swap-and-pop active-game set also exposes paginated pending IDs to admin dashboards and
keepers without scanning the entire game history.

Ticket price, reveal delay, reveal window, no-win weight, prize assets, prize quantities, outcome weights, free-spin
balances, roles, and pause state can all be changed through privileged writes without redeployment. Prize,
probability, price, and reveal-setting changes are blocked while a round is active. Operationally, the contract
should also be paused while applying a multi-transaction configuration update.

## Randomness limitation

The request commitment includes the chain, contract, game, player, request block, free/paid flag, and catalog
version. Reveal entropy includes the hash of the configured future target block. This prevents the player from
choosing the result after seeing the target block, while permissionless reveal prevents the player from being the
only party able to publish an unfavorable result.

It does not remove Base sequencer influence. Historical block hashes are also available for only 256 blocks.
Material-value deployment should use verifiable randomness and an independent smart-contract audit.
