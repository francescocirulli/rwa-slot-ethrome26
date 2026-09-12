# Arkiv seasonal leaderboard

The iPad's **Ranks** button and the phone's **Leaderboard** card display the same
season. Each season ends at one Arkiv block; every seasonal contribution expires
there. History records last longer. The source game and payouts remain on Base.
See the [schema and trade-offs](schema.md).

## Setup

1. Use the existing web service with one always-on replica. Install dependencies
   with `npm ci` inside `apps/web`.
2. Obtain a dedicated Arkiv wallet, test GLM and a Tiramisu access key from the
   [Arkiv Hub](https://hub.arkiv.network/). Keep secrets server-side.
3. Configure the `ARKIV_*` values in `apps/web/.env.example` in your local ignored
   `.env.local`. The Base contract configuration must already be valid.
4. Set `ARKIV_WRITER_ADDRESS` to the dedicated writer. Leave `ARKIV_PRIVATE_KEY`
   empty for a read-only viewer. Never reuse the keeper or admin wallet key.
5. Set `ARKIV_SEASON_ANCHOR_BLOCK` to an explicitly chosen Tiramisu block, ideally
   shortly ahead of the current head, and keep it fixed across restarts. Set
   `ARKIV_BASE_FROM_BLOCK` to the first Base block to import, at or after deployment.
6. Use `ARKIV_SEASON_BLOCKS=60` for the approximately two-minute demo. Keep
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
