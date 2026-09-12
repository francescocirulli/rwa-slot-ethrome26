# Arkiv feedback — Wall Street Slot

Observed on 2026-09-12. SDK **@arkiv-network/sdk 0.8.1**, Node 22.21.1,
viem from the web package lockfile. Target: Tiramisu, chain 7738577.
This report separates observed behavior from remaining tests. Initial diagnostics
used anonymous RPC access. Credentials were subsequently entered through a secure
local form for setup; they are never included here. No funded writes or production
configuration changes have been performed.

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
at rollover. Live funded publication/expiry evidence is still outstanding.
Suggestion: add a shared-deadline season recipe and explain how UI caches detect
expiry without an expiration event.

## 4. Bounty page and supplied brief disagree

On inspection, [the event page](https://hub.arkiv.network/ethrome) lists EUR prizes
and judging weights 30/25/20/25. The supplied participant brief lists USDC amounts
in dollars and 30/20/20/20/10. The live page also links a dedicated Arkiv submission
form. This has not been resolved with the team. A single versioned rules document,
with a dated change log and explicit controlling source, would remove uncertainty.

## Remaining live validation

- Actual write fees and publishing latency. The selected writer balance was verified
  at 10 GLM on Tiramisu through authenticated read-only RPC.
- Atomic history/contribution writes on the selected public endpoint.
- Same populated query before and empty query after an actual season expiry.
- Two-player gameplay recording and application-level reconnect recording.
- Rate limits under event load and any quota changes with an access key.
- Conversation with the Arkiv team and final qualification/submission.

These are not reported as passed. The branch includes read-only diagnostic and
expiry-evidence scripts, setup instructions and automated local coverage.
