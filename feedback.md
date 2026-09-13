# Arkiv feedback — Wall Street Slot

Observed on 2026-09-12 and 2026-09-13. SDK **@arkiv-network/sdk 0.8.1**,
**viem 2.56.0**, **Node 22.21.1** (see the [package lockfile](apps/web/package-lock.json)).
Target: **Arkiv Tiramisu, chain 7738577**; source gameplay: Base, chain 8453.
This is the single feedback report for our ETHRome submission.
This report separates observed behavior from remaining tests. Initial diagnostics
used anonymous RPC access. Credentials were subsequently entered through a secure
local form for setup; they are never included here. Production was subsequently
configured and funded writes verified after correcting the attribute-name failure
described below.

## What worked

Arkiv gave us a queryable index of confirmed Base results without introducing a
separate SQL database. Typed attributes support wallet, time, win, match-count,
symbol and prize filters; JSON payloads retain the complete grid and receipt
reference. The same records support the shared leaderboard and personal summaries.
See the [schema](arkiv/schema.md) and [query implementation](apps/web/lib/arkiv/store.ts).

Atomic batches let us publish a history record and its seasonal contribution
together. Independent expiration settings fit the product: contributions share a
season deadline while history remains available longer. Real funded publication
and compound queries succeeded, as documented below; a filmed natural-expiration
demo is still outstanding.

The viem-compatible SDK let us reuse our existing TypeScript stack. Public reads
and WebSocket diagnostics worked without a player wallet or access key. After an
intentional socket closure, pushed blocks resumed. These are observed successes,
not a claim of production-scale reliability.

## Surfaces used and coverage

| Surface | What we used or verified | Coverage limit |
| --- | --- | --- |
| TypeScript SDK | Typed compound queries, snapshot pagination, atomic entity creation, absolute expiry and subscriptions | Version 0.8.1; no comparative SDK benchmark |
| Documentation | Query and leaderboard recipes, event transport, mutation/expiry documentation and installed SDK source | Some observations concern documentation seen on September 12, not a claim that every page remains unchanged |
| Hub | ETHRome mission definitions, submission link and judging criteria | No full Hub UX audit; current event page rechecked September 13 |
| Access keys / faucet | Anonymous diagnostics, followed by configured authenticated endpoints and a writer funded with 10 test GLM | No retained recording of key issuance or faucet claiming; no measured quota, claim latency or rate-limit comparison |
| Explorers | Our own Game Explorer queries Arkiv and links to source Base receipts | Arkiv Data Explorer and Tiramisu Block Explorer were not independently exercised in a recorded test |
| Network | Real Tiramisu writes, public JSON-RPC reads, pushed blocks and deliberate socket recovery | No sustained-load, outage-duration or finality study |
| MCP / tools | Local SDK diagnostic and evidence scripts; direct JSON-RPC queries | The ETHRome MCP gateway was not used or tested for this integration |

## 1. Leaderboard ordering requires complete pagination

**Expected:** a documented ranking recipe should make global ordering and
pagination requirements clear before a developer applies a top-20 limit.

**Actual (September 12):** the query documentation and leaderboard recipe explain that
server-side score sorting is unavailable. At the time, older indexed API
documentation exposed an `orderBy()` method marked deprecated/no-op, which was
easy to mistake for support.

**Reproduction:** follow the [leaderboard recipe](https://docs.arkiv.network/cookbook/leaderboard/)
and inspect the pinned SDK's `src/query/queryBuilder.ts`: rank a dataset larger
than a page only after collecting all pages, then compare with sorting its first
20 entities. A limit of 20 before application sorting cannot produce a global
top 20. Our [store](apps/web/lib/arkiv/store.ts) iterates the full scoped query.

The historical documentation URL was
`https://docs.arkiv.network/typescript-sdk/api-reference/query/classes/basequerybuilder/`.
It returned HTTP 404 during the September 13 link check, so its previous contents
cannot currently be reproduced at that URL. The historical observation should
not be read as a claim that the obsolete method remains in the current guide.

Workaround: use pinned 0.8.1, walk every page of a scoped season snapshot, then
aggregate and sort. We validate aggregation with more than 200 contributions.
Suggestion: redirect obsolete SDK reference pages and keep the pagination warning
next to every leaderboard example. This is a documentation trap, not a claimed
network defect.

## 2. Event documentation obscures the transport distinction

**Expected:** the live-events guide should clearly distinguish HTTP polling,
WebSocket subscriptions and historical backfill, including reconnect behavior.

**Actual:** the default example teaches polling; enabling the required push
transport meant checking the SDK and viem implementation. The wording and HTTP
example were still present when we rechecked the page on September 13.

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

**Expected:** a seasonal leaderboard recipe should explain both how records expire
and how a connected UI learns that the season has ended.

**Actual:** expiration emits no entity event. This is documented behavior, not a
reported deletion bug, but it requires a separate block subscription to avoid
stale standings.

**Reproduction:** configure a separate short demo season as described in
[Mission 02](arkiv/README.md#mission-02-built-to-expire), publish an eligible spin,
and run `scripts/arkiv-evidence.ts` before the deadline. The script repeats the
same season predicate before and after natural expiry without deleting anything.
An entity-event-only subscriber has no expiration notification to consume; our
[service](apps/web/lib/arkiv/service.ts) watches new blocks and reconciles the view.
The populated before/after recording has not yet been captured.

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

**Expected:** the Hub and distributed participant brief should agree on mission
requirements, currency and judging weights.

**Actual / reproduction:** compare the Hub ETHRome page's bounty and judging
sections with the participant brief supplied to the team. This discrepancy was
recorded on September 12. The Hub page rechecked on September 13 still lists the
weights below, including 25% for feedback. The original brief is not committed,
so the comparison cannot be independently reproduced from this repository alone.

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

**Expected:** SDK validation, query parsing and the deployed write path should agree
on valid attribute names, or fail early with the correct accepted character set.

**Actual:** read predicates accepted the field name, but write gas estimation
reverted; the surfaced error misleadingly listed uppercase characters as valid.

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

## Explorer query validation (2026-09-13)

A read-only check of the new Explorer at Arkiv block `371373` returned eight season
contributions (660 points). The personal season query for
`0xbb2fee9fda8a023220d34cdd9cb2843acc23a0b6` returned four contributions (260 points).
Combining a seven-day timestamp window, `won=true`, `matches=5` and `symbol=2`
returned one recorded NVIDIA win. No transaction was signed or broadcast for these
checks. This verifies real compound queries; it does not replace live expiry or
multi-device subscription evidence.

The Explorer applies the existing pagination lesson to both statistics and browsing:
aggregate every matching page before slicing display rows, and pin the snapshot
across pagination. Personal season totals use contributions, not just history timestamps,
because a late-ingested history record may be deliberately excluded from the season.

## Public read and recovery recheck (2026-09-13)

Running `node --import tsx scripts/arkiv-check.ts` against the anonymous endpoint
completed successfully on the first attempt:

```json
{"check":"compound-query","block":"379474","entities":54}
{"check":"before-drop","block":"379476"}
{"check":"after-reconnect","block":"379477"}
{"check":"socket-recovery","blocks":2,"errors":4,"entityEvents":6}
```

The diagnostic's broad project/season query returned 54 entities on its first
page. Its entity subscription is network-wide, so the six events are not claimed
as our gameplay events. Four error callbacks accompanied the deliberate closure,
and the next pushed block arrived after recovery. This confirms the standalone
read/reconnect command, not a two-client UI recording or a load test.

## Hub, access keys and faucet improvements

The [Hub](https://hub.arkiv.network/) collects the event, access-key, faucet,
documentation and explorer entry points in one place. Our recorded integration
progressed from anonymous reads to authenticated HTTP/WebSocket endpoints and
funded writes. We did not retain a step-by-step key-issuance or faucet-claim trace,
so we cannot report a specific failure or measure that onboarding flow.

Our [endpoint configuration](apps/web/lib/arkiv/config.ts) appends the access key
to both transport URLs on the server. The [setup guide](arkiv/README.md#setup)
warns against adding it twice or leaking it through logs. A useful onboarding
improvement would be one versioned connection checklist covering both transports,
key placement, redaction, funding, and a read plus write-estimation smoke test.
This is an integration suggestion, not an observed Hub credential leak or faucet
failure. Documented quotas and faucet limits alongside that checklist would help
teams estimate event-demo capacity; we have not measured either.

## Explorers

Our own [Game Explorer](arkiv/README.md#explorer-and-my-summary) worked with real
Arkiv records: a compound query isolated an NVIDIA win, and a personal query
returned the matching season contributions. That is evidence for Arkiv's query
surface, not a review of the Arkiv-hosted explorer UI.

We have no recorded test of [Arkiv Data Explorer](https://data.arkiv.network/) or
[Tiramisu Block Explorer](https://tiramisu.explorer.arkiv.network/), and report no
verified defect in either. For our debugging workflow, the most useful explorer
capabilities would be shareable creator/project/season predicates, visible typed
attributes and expiry blocks, and a clear distinction between a live query and a
historical snapshot. These are desired capabilities, not assertions that the
current explorers lack them.

## MCP and developer tools

We used the installed SDK source, direct `arkiv_query` calls, and our own
[read-only diagnostic](apps/web/scripts/arkiv-check.ts) and
[expiration evidence script](apps/web/scripts/arkiv-evidence.ts). The diagnostic
was useful because it exercised the transport, intentionally dropped its socket,
and produced small JSON records that could be included in a report without keys.

We did not connect to or evaluate the ETHRome MCP gateway linked from the
[event page](https://hub.arkiv.network/ethrome). We make no claims about its tool
availability, correctness or reliability. For a future evaluation, we would ask
it to discover the supported SDK version, produce a creator-scoped typed query,
and generate a WebSocket example with recovery and separate historical backfill.
Version-tagged recipes and an explicit read-only/write distinction would make
such tools easier to assess against the issues above.

## Commands and source evidence

From an installed checkout, inspect the exact dependency versions:

```sh
cd apps/web
node -p 'JSON.stringify({node:process.version,sdk:require("./package-lock.json").packages["node_modules/@arkiv-network/sdk"].version,viem:require("./package-lock.json").packages["node_modules/viem"].version})'
```

Run the public read and socket-recovery diagnostic (no wallet or access key needed):

```sh
node --import tsx scripts/arkiv-check.ts
```

For already configured authenticated endpoints:

```sh
node --env-file=.env.local --import tsx scripts/arkiv-check.ts
```

After setting up a separate short season and publishing an eligible confirmed
spin, run the read-only expiry check before its deadline:

```sh
node --env-file=.env.local --import tsx scripts/arkiv-evidence.ts
```

The last command does not create the prerequisite spin. Real gameplay still
requires its normal wallet authorization. The checker rejects an empty season
or one with more than 150 blocks remaining and times out after six minutes.

Implementation references:

- [Entity creation, queries and WebSocket client](apps/web/lib/arkiv/store.ts).
- [Subscriptions, stale-state handling and snapshot recovery](apps/web/lib/arkiv/service.ts).
- [Season schedule and ranking](apps/web/lib/arkiv/model.ts).
- [Explorer filters and aggregation](apps/web/lib/arkiv/explorer.ts).
- [Reproduction guide and outstanding mission evidence](arkiv/README.md#reproducible-bounty-evidence).

## Highest-priority improvements

1. Align SDK attribute validation and error messages with the deployed node;
   include a create-estimation compatibility check in the quickstart.
2. Publish a complete WebSocket/reconnect recipe and distinguish it from polling
   and backfill; show how expiration affects a live UI.
3. Keep SDK reference pages and leaderboard recipes versioned and consistent,
   with pagination and client-side aggregation limitations prominent.
4. Maintain one dated, authoritative event brief and a connection checklist that
   joins access keys, HTTP/WebSocket endpoints, faucet funding and diagnostics.
