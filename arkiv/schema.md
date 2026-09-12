# Wall Street Slot — Arkiv schema v1

Draft for ETHRome 2026. Missions: **02 Built to expire** and **03 Live wire**.
The existing slot contract and wallet flows predate this integration. The new
contribution is the Arkiv history, seasonal leaderboard and subscription-driven UI.
No pre-existing subgraph/Ponder/Postgres pipeline is being decommissioned.

## Product behavior

A season is a shared competition window on the Tiramisu chain. A confirmed
Base spin earns 100 points for five matching symbols, 30 for three, and zero
for a loss. Paid and free spins use the same rules. Rank by total points,
then wins, then normalized wallet address. Display the first 20 players.
These are game points, not a comparison of monetary values across assets.

Every contribution in a season has the exact same Arkiv expiry block. At that
block, Arkiv removes the contributions from live queries. The app reads the new
season and displays an empty ranking until new eligible spins are published.
There is no delete job or client-side score reset. The independent spin history
has longer retention, so leaderboard expiry does not erase it immediately.

## Networks and trust

- Results and actual prizes: the configured DigitalSlotMachine on Base (8453).
- Queryable index: Arkiv Tiramisu (7738577), SDK pinned to 0.8.1.
- Writer/owner/creator: one dedicated server wallet funded with test GLM.
- Player: a typed address attribute, not the owner of the Arkiv entity.
- Every query filters immutable `$creator`, project, schema, source chain and slot.
- Never store Privy IDs, names, emails, JWTs, pairing secrets or private keys.
- Base receipt/event verification is performed by the writer. Arkiv verifies the
  writer's signature; it does not independently prove the Base result.

## Entity attributes

Shared by `spin` and `season-spin`:

| Attribute | Arkiv type | Purpose |
| --- | --- | --- |
| `project` | str | Application namespace |
| `schema` | i32 | Version 1 |
| `kind` | str | `spin` or `season-spin` |
| `sourceChain` | u64 | Base chain ID |
| `slot` | addr | Source contract |
| `gameId` | u256 | Source round ID; logical deduplication key within source scope |
| `player` | addr | Wallet for history and ranking |
| `playedAt` | u64 | Base reveal block timestamp, in seconds |
| `won` | bool | Verified result |
| `points` | i32 | 0, 30 or 100 |
| `matches` | i32 | Match count |
| `symbol` | i32 | Winning symbol ID |
| `prizeKind` | i32 | Original payout kind, zero for a loss |

Additional seasonal attributes:

| Attribute | Arkiv type | Purpose |
| --- | --- | --- |
| `schedule` | str | `<anchorBlock>:<seasonBlocks>`; scopes schedule revisions |
| `season` | u64 | One-based season number |
| `seasonEnd` | u64 | Shared absolute expiry block |

The `spin` JSON payload contains the source transaction hash, result block,
wallet, complete symbol grid, actual payout token/ID/amount and match result.
Big integers are decimal strings. The contribution payload holds the source
transaction hash. Artwork remains in the web app, outside Arkiv.
Both entity kinds use `readonly: true`; permissionless expiry extension is off.

## Season schedule and expiry

Given anchor `A`, length `L`, and Arkiv block `B >= A`:

- index = `(B - A) / L`, using integer division;
- season ID = index + 1;
- start = A + index × L;
- end = start + L;
- contribution expiry = `ExpirationTime.atBlock(end)` with no minimum lifetime.

Before A the UI displays the upcoming first season. Anchor and length must be
configured identically across restarts. Change the project namespace if changing
the schedule after publishing data. The default length of 60 blocks is roughly
two minutes; longer seasons use the same mechanism. The countdown estimates two
seconds per remaining block. Network progress, not the browser clock, decides the
boundary. Zero displays "Waiting for season change" until a successful query.

Eligibility uses the actual Arkiv season-start block timestamp. Recovered Base
results older than that are written to history only. A batch landing after its
season expiry must revert; on retry an old result cannot score in a later season.
A missed season is not recreated. There is no permanent winners archive in v1.
History retention defaults to approximately 30 days from publication; source
results older than the configured retention are not imported again on restart.

## Queries and ranking

The leaderboard predicate combines source/creator scope with:

```text
kind = str('season-spin')
AND schedule = str('<anchor>:<length>')
AND season = u64(<season>)
AND playedAt >= u64(<actual season-start timestamp>)
AND seasonEnd = u64(<shared end block>)
```

The timestamp range excludes entries attributed to the wrong time window;
project and creator filters alone are not a complete leaderboard query.
The SDK walks every page at the same block before aggregation. There is no
server-side score ordering. Do not use `limit(20)` as a top-20 optimization.
The reader validates types and expiry, collapses duplicate game IDs, sums per
wallet, sorts, and slices. History uses source/creator plus player and returns
the 50 most recently created records, explicitly not the complete history.

## Process coordination and recovery

Arkiv is the added database. Coordination remains in the existing single,
always-on Node service: one scanner and one dedicated Arkiv signer. No second
keeper, distributed writer or service replica is introduced. Never share the
writer with another deployment. Reads need no private key.

The Base scanner processes bounded, confirmed RoundRevealed log pages every eight
seconds. It verifies source block hash and the existing reader's confirmed result.
The cursor advances only after all writes in a page finish. On restart it replays
from ARKIV_BASE_FROM_BLOCK. Existing history prevents repeat publication; history
and a seasonal contribution are created in one atomic Arkiv batch. Rank deduplication
also protects against duplicate records after ambiguous restart recovery.

The signer captures its transaction hash before broadcast. A missing receipt blocks
new submissions in that process. No blind retry, replacement nonce, fee bump or
rebroadcast occurs. A mined receipt allows reconciliation; a still-pending writer
nonce blocks new writes after restart. A signed transaction that never reaches the
network can require operator investigation. No persistent transaction journal is
implemented. Confirmations match the existing app (two Base blocks), not full Base
finality; deeper reorgs are not automatically repaired in the Arkiv index.

## Live reads

`store.ts` builds a WebSocket client. `service.ts` subscribes to entity events
without `fromBlock`, and to `newHeads` with polling disabled. Relevant entity
creation invalidates the ranking. New heads synchronize the countdown and trigger
queries when a season changes, a connection recovers or an invalidation is pending.
There is no expiration event. Browser clients receive SSE from the Node service;
the ES5 iPad never loads the Arkiv SDK. SSE and animations do not refresh sessions.
A local watchdog marks stale connections; it performs no RPC queries.

On reconnect, reconcile a complete current-season snapshot. Do not add fromBlock
to the live subscription: viem would switch it to polling. Older Base recovery is
separate from this Arkiv subscription. Public read endpoints expose only public
onchain information and are not authenticated wallet/write endpoints.

## API and validation

- `GET /api/leaderboard`: current shared snapshot, status and countdown estimate.
- `GET /api/leaderboard/stream`: SSE `standings` snapshots; up to 100 connections
  per process, with heartbeat and bounded slow-client queues.
- `GET /api/leaderboard/history?player=0x...`: recent public results from Arkiv.
- `npm test`, `npm run build`, `npm run test:browser` in apps/web.
- Read-only diagnostics: `node --import tsx scripts/arkiv-check.ts`.
- Expiry evidence after a real eligible spin:
  `node --env-file=.env.local --import tsx scripts/arkiv-evidence.ts`.

See [setup and evidence](README.md) and [friction report](../friction.md).
