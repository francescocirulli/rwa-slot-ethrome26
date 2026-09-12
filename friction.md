# Arkiv feedback — Wall Street Slot

Observed on 2026-09-12. SDK **@arkiv-network/sdk 0.8.1**, Node 22.21.1,
viem from the web package lockfile. Target: Tiramisu, chain 7738577.
This report separates observed behavior from remaining tests. Initial diagnostics
used anonymous RPC access. Credentials were subsequently entered through a secure
local form for setup; they are never included here. Production was subsequently
configured and funded writes verified after correcting the attribute-name failure
described below.

## 1. Leaderboard ordering requires complete pagination

The current query documentation and leaderboard recipe correctly explain that
server-side score sorting is unavailable. Older indexed API documentation exposes
an `orderBy()` method marked deprecated/no-op, which is easy to mistake for support.

Reproduction: compare the current [leaderboard recipe](https://docs.arkiv.network/cookbook/leaderboard/)
with the older [BaseQueryBuilder reference](https://docs.arkiv.network/typescript-sdk/api-reference/query/classes/basequerybuilder/).
A limit of 20 before application sorting cannot produce a global top 20.

Workaround: use pinned 0.8.1, walk every page of a scoped season snapshot, then
aggregate and sort. We validate aggregation with more than 200 contributions.
Suggestion: redirect obsolete SDK reference pages and keep the pagination warning
next to every leaderboard example. This is a documentation trap, not a claimed
network defect.

## 2. Event documentation obscures the transport distinction

The [live-events page](https://docs.arkiv.network/typescript-sdk/live-events/) describes
`watchEntityEvents` as polling and demonstrates HTTP. The published SDK delegates
to viem.watchEvent, which subscribes over WebSocket when no fromBlock is present.
Providing fromBlock changes the default to polling even on a WebSocket transport.

Reproduction: inspect SDK `src/actions/public/watchEntityEvents.ts` and installed
viem `actions/public/watchEvent.ts`; compare HTTP, WebSocket and WebSocket with
fromBlock. The application uses WebSocket without fromBlock. Historical recovery
uses separate queries. The SDK's public type does not expose watchBlocks, so we
use viem's standalone watchBlocks action with `poll:false` on that same client.

Observed public-network diagnostic output from `scripts/arkiv-check.ts`:

```json
{"check":"compound-query","block":"366933","entities":0}
{"check":"before-drop","block":"366934"}
{"check":"after-reconnect","block":"366935"}
{"check":"socket-recovery","blocks":2,"errors":4,"entityEvents":2}
```

The script queried our empty project namespace, subscribed, closed its own socket,
and received a subsequent pushed block after recovery. The entity events were
network activity, not our game's writes. Closure raised four error callbacks across
the two subscriptions; these are counted and not exposed with secret-bearing URLs.
This verifies connectivity/recovery, not the full two-wallet mission demo.
Suggestion: document the three transport/backfill cases side by side, with network
traffic expectations and explicit reconnect examples.

## 3. Expiration is silent and block-based

The [mutation documentation](https://docs.arkiv.network/typescript-sdk/mutating-data/)
states that expiration emits no event. An entity-event-only cache can display a
finished season forever. A relative lifetime on each score also expires scores at
different moments, which is wrong for a shared season.

Workaround: all contribution entities use one absolute atBlock deadline, with no
minimum lifetime. Subscribe to new heads to detect that boundary and query again.
The visible countdown estimates remaining time; it waits for network confirmation.
A failed query retains the previous ranking visibly stale. History lives separately.
Local tests cover the exact boundary, late submissions, disconnection and failure
at rollover. Live funded publication is now verified; populated expiry evidence
is still outstanding for a separate short demo season.
Suggestion: add a shared-deadline season recipe and explain how UI caches detect
expiry without an expiration event.

## 4. Bounty page and supplied brief disagree

On inspection, [the event page](https://hub.arkiv.network/ethrome) lists EUR prizes
and judging weights 30/25/20/25. The supplied participant brief lists USDC amounts
in dollars and 30/20/20/20/10. The live page also links a dedicated Arkiv submission
form. This has not been resolved with the team. A single versioned rules document,
with a dated change log and explicit controlling source, would remove uncertainty.

## Remaining live validation

- Write-fee and publishing-latency measurements under sustained load. The writer
  started with 10 GLM; three atomic history/contribution batches are now verified.
- Same populated query before and empty query after an actual season expiry.
- Two-player gameplay recording and application-level reconnect recording.
- Rate limits under event load and any quota changes with an access key.
- Conversation with the Arkiv team and final qualification/submission.

These are not reported as passed. The branch includes read-only diagnostic and
expiry-evidence scripts, setup instructions and automated local coverage.

## Live write failure: uppercase attribute names (2026-09-12)

Environment: SDK 0.8.1, Tiramisu chain 7738577. The initial production query and
WebSocket checks passed, but the first confirmed Base round (#17, block 51229696)
was not stored. Gas estimation for a create batch failed before broadcast because
`gameId` contains uppercase `I` at byte 4. The SDK's `EntityMutationError` claimed
that `A-Z` was part of the accepted charset, contradicting the deployed node.
The same fields had been accepted in read predicates, so an empty query was not
a sufficient write compatibility check.

Reproduction: build a create with a `gameId` attribute and estimate `execute`
against the entity contract. The node returns a name-character revert. Rename
attributes to lowercase snake_case (`game_id`, `source_chain`, `played_at`,
`prize_kind`, `season_end`): the same confirmed result then passes gas estimation.
The diagnostic transport blocks broadcast, so no duplicate transaction is sent.

Workaround: use lowercase attribute names consistently in writes and queries;
keep camelCase only inside JSON payloads. No existing Arkiv entities required
migration because every attempted production create had failed before broadcast.
The Base replay cursor remains at the original activation block, allowing recovery.
Read-only connectivity checks should be complemented by create gas estimation;
SDK charset validation and revert explanations should match the live node.

## Production recovery verified

After release PR #49 (commit `db6e788`), a direct Arkiv query at block `370524`
returned six entities: history and season contributions for Base rounds 17, 18
and 19. Their scores are 100, 30 and 30. The three contributions share expiry
block `1666002`; their independent history records expire at blocks `1666504`,
`1666508` and `1666513`. The public leaderboard returned 160 points, three spins
and three wins with ingestion caught up.

The production iPhone viewport check found the Leaderboard shortcut above the
wallet and successfully navigated to standings with a day/hour countdown. This
validates recovery of real confirmed gameplay and atomic publication, not the
still-outstanding two-player recording or populated before/after expiry demo.
