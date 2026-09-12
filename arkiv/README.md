# Arkiv seasonal leaderboard

The iPad's **Ranks** button and the phone's **Leaderboard** card display the same
season. Each season ends at one Arkiv block; every seasonal contribution expires
there. History records last longer. The source game and payouts remain on Base.
See the [schema and trade-offs](schema.md).

## Setup

1. Use the existing web service with one always-on replica. Install dependencies
   with `npm ci` inside `apps/web`.
2. Choose the server signing wallet, obtain test GLM and a Tiramisu access key from the
   [Arkiv Hub](https://hub.arkiv.network/). Keep secrets server-side.
3. Configure the `ARKIV_*` values in `apps/web/.env.example` in your local ignored
   `.env.local`. The Base contract configuration must already be valid.
4. Choose one signer source: a separate `ARKIV_PRIVATE_KEY`, or explicit reuse of
   the existing keeper via `ARKIV_USE_SLOT_BACKEND_KEY=true` with `ARKIV_PRIVATE_KEY`
   empty. Reuse reads `SLOT_BACKEND_PRIVATE_KEY` directly. The public writer address
   is derived automatically; an explicit `ARKIV_WRITER_ADDRESS` must match. A
   read-only viewer uses the address with both signing sources disabled.
   Player and shared admin Privy wallets remain separate from the keeper.
   Base and Tiramisu use independent nonce sequences; keep only one writer per chain.
   Reusing the key couples custody across those networks, so an incident affects both.
   Set `ARKIV_API_KEY` and leave the HTTP/WebSocket URLs as base URLs. The server
   attaches the key to both; do not also embed it in the URLs.
5. Set `ARKIV_SEASON_ANCHOR_BLOCK` to an explicitly chosen Tiramisu block, ideally
   shortly ahead of the current head, and keep it fixed across restarts. Set
   `ARKIV_BASE_FROM_BLOCK` to the first Base block to import, at or after deployment.
6. Use `ARKIV_SEASON_BLOCKS=1296000` for approximately 30-day seasons (the default).
   Use `60` only for the approximately two-minute bounty demo. Season expiry and
   the separate `ARKIV_HISTORY_DAYS=30` retention are independent. Keep
   `ARKIV_HISTORY_DAYS=30` for history independent of season expiry. Start with
   `ARKIV_ENABLED=true` only when configuration is complete.
7. Start the app using `npm run dev`. After an authorized real spin, wait for its
   Base confirmations and Arkiv publication, then open Ranks and the phone card.

The read-only diagnostic can use the anonymous endpoints without configuration:

```sh
cd apps/web
node --import tsx scripts/arkiv-check.ts
```

For authenticated endpoints, load the ignored local environment:

```sh
node --env-file=.env.local --import tsx scripts/arkiv-check.ts
```

This queries data, subscribes to events, deliberately drops its own socket and
checks recovery. It never writes. Do not print endpoint URLs containing API keys.
The supplied branch does not configure production secrets or deploy the service.

## Reproducible bounty evidence

### Mission 02: built to expire

- Use a short season and publish an eligible confirmed spin through the app.
- Run `node --env-file=.env.local --import tsx scripts/arkiv-evidence.ts` in apps/web.
- Save its JSON output: the fixed season predicate returns entities before expiry
  and zero after it. The script contains no mutation or delete call.
- Record iPad and phone: a populated ranking, countdown, then the next empty season.
  If the chain pauses, the countdown waits; it cannot manufacture a reset.

### Mission 03: live wire

- Show the WebSocket client in `apps/web/lib/arkiv/store.ts` and subscriptions in
  `service.ts`; no live subscription receives `fromBlock`.
- Open two independent player sessions/devices. One plays; the other's leaderboard
  receives the Arkiv-driven change over SSE without refresh. The backend is the
  entity writer for both players.
- Drop the connection and record stale state, reconnect and snapshot reconciliation.
- Capture traffic showing `eth_subscribe` on the upstream socket. Browser SSE alone
  is not proof of an Arkiv socket subscription.

Local browser tests use controlled fixtures. They are not evidence of a real
Arkiv write/expiry or a two-wallet live gameplay demo. See [friction.md](../friction.md)
for the observed read-only testnet checks and outstanding live evidence.

## Submission

Include schema, feedback report, public repository, deployed demo, recording and
command output. Declare the existing Base slot and identify only the new Arkiv work.
Submit through both the event process and the Arkiv form linked from the
[official ETHRome page](https://hub.arkiv.network/ethrome).
Keep the brief's team conversation deadline (Saturday 20:00) and submission
checkpoint (Sunday 10:00) until the organizers explicitly confirm otherwise.
The live page and the supplied brief disagree about judging weights and prize
currency; ask the team to resolve that discrepancy before submitting.

## Explorer and My summary

Open **Explore** in the iPad toolbar, or **Explorer** in the phone navigation.
The workspace offers **Game Explorer** and **My summary** tabs. The iPad uses the
paired player's wallet; the phone uses the authenticated account wallet. Without a
wallet, public exploration remains available and the personal tab explains how to
connect. A wallet-address filter also allows inspecting another public game record.

Combine time, player, result, match count, winning symbol and prize type filters.
Open a spin for its full 3×5 grid and Base receipt. My summary shows recorded spins,
wins, points and combination/symbol distributions for the season or a recent window.
Use Refresh for new data: these views are labeled snapshots, while Ranks remains live.
The archive covers retained indexed results only; it is not a lifetime or ROI report.

For example (public, read-only):

```sh
curl 'https://web-production-e2628.up.railway.app/api/explorer?period=week&won=true&matches=5&symbol=2'
curl 'https://web-production-e2628.up.railway.app/api/explorer?mode=summary&period=season&player=0xbb2fee9fda8a023220d34cdd9cb2843acc23a0b6'
```

These routes become available when the Explorer PR is deployed. No additional env
variables, Privy permissions, signing keys or contract changes are required. See
[schema/query limits](schema.md#game-explorer-and-personal-summaries).
