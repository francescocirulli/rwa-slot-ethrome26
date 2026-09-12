# Railway

One project, `rwa-slot-ethrome26`, with the `production` environment and `web` service.
The configuration in `railway.ts` uses the `railway/iac` SDK; running `npm ci` at
the repository root installs the version pinned in the lockfile. Railway CLI
>= 5.42.1 is required. This service does not use the older `railway.json` format.

Public deployment: [app](https://web-production-e2628.up.railway.app),
[admin](https://web-production-e2628.up.railway.app/admin),
[Railway dashboard](https://railway.com/project/c3367565-9058-4341-9795-e9de185dfea0).
The first deployment was verified from commit `93b1164`: Docker build,
healthcheck, pairing QR code and login screens. The contract and keeper key
still need configuration; no transactions were sent during deployment testing.

| Setting | Value |
| --- | --- |
| GitHub | `francescocirulli/rwa-slot-ethrome26`, branch `main` |
| Root directory | `/apps/web` |
| Builder | Dockerfile, path `Dockerfile` relative to the service root |
| Start command | `node server.js`, defined in the Dockerfile |
| Healthcheck | `/api/health`, 60-second timeout |
| Network | `0.0.0.0`, port 3000, Railway HTTPS domain |
| Scaling | One replica; serverless/sleep disabled |
| Watch paths | `/apps/web/**` |

The Dockerfile receives **apps/web**, not the monorepo root, as its build context:

```sh
docker build -t rwa-slot-web apps/web
docker run --rm -p 3000:3000 --env-file apps/web/.env.local rwa-slot-web
```

No secrets are required at build time. The server reads Privy configuration
when handling requests; `.env*` is excluded from the Docker context.

## Variables

Use Railway service variables. The full list, with explanations, is in
[`../apps/web/.env.example`](../apps/web/.env.example).

- `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`: credentials for the configured Privy app.
- `APP_ORIGIN`: exact public HTTPS URL without a trailing slash. Register this
  domain in Privy's allowed origins too, if origin restrictions are enabled.
- `ADMIN_OWNER_USER_ID`: owner account for the shared admin wallet.
- `ADMIN_WALLET_EXTERNAL_ID`: stable identifier for the shared wallet in Privy.
  Leaving it empty preserves `lucky_signal_shared_admin_v1`. Changing it selects
  a different wallet; it does not transfer ownership or funds. See
  [admin configuration recovery](../apps/web/docs/shared-admin.md#changing-accounts-after-a-trial).
- `PRIVY_GAS_MODE=usdc`: USDC gas with ETH fallback for Privy wallets.
- `BASE_RPC_URL`: Base mainnet endpoint; prefer a dedicated RPC in production.
- `BASE_RPC_FALLBACK_URLS`: optional comma-separated public RPC URLs tried in
  order when `BASE_RPC_URL` fails, rate-limits or rejects a bounded log request.
  Reads and keeper transaction preparation fall back automatically, including
  QuickNode daily-quota errors. Backend signing stays local; uncertain submissions
  retain the same signed bytes and nonce.
- `SLOT_CONTRACT_ADDRESS` and `SLOT_DEPLOYMENT_BLOCK`: leave empty until the
  contract is deployed. Login, wallets and swaps work without the contract.
- `SLOT_LOG_PAGE_BLOCKS`: maximum blocks per `eth_getLogs` call; set it to the
  RPC provider's range limit (10 on Alchemy Free, 5 on QuickNode Discover).
  Default 2000. Bounded scans resume across polls, so a small page makes player
  history recovery slower but keeps it working on a capped endpoint.
- `SLOT_HISTORY_FROM_BLOCK`: earliest block scanned for a player's spins and
  welcome grants. Defaults to `SLOT_DEPLOYMENT_BLOCK`. Raise it on a range-capped
  RPC to skip old history; rounds older than this block are not recovered.
- `SLOT_BACKEND_PRIVATE_KEY=REPLACE_ME`: disabled placeholder. Replace it with
  `0x` plus 64 hexadecimal digits for a dedicated EOA funded with ETH on Base.
  Free spins require `GAME_MANAGER_ROLE`. This is not the Privy admin wallet's
  key. Do not use a `NEXT_PUBLIC_` prefix for this secret.
- `LIFI_API_KEY`: optional; may remain empty.
- Arkiv seasons: set `ARKIV_ENABLED=true`, `ARKIV_USE_SLOT_BACKEND_KEY=true`,
  `ARKIV_API_KEY`, and the expected public `ARKIV_WRITER_ADDRESS`. Keep the sealed
  `SLOT_BACKEND_PRIVATE_KEY` unchanged. Set a fixed `ARKIV_SEASON_ANCHOR_BLOCK`
  on Tiramisu and `ARKIV_BASE_FROM_BLOCK` on Base at activation; preserve both
  across restarts. `ARKIV_SEASON_BLOCKS=1296000` gives roughly 30-day seasons (60 for the demo),
  with `ARKIV_HISTORY_DAYS=30` for spin history. The writer needs GLM on Tiramisu.
  Base ingestion drains bounded pages serially while catching up, then checks
  every eight seconds. See [Arkiv setup](../arkiv/README.md).
- `SLOT_HARDWARE_TOKEN`: dedicated random hardware secret shared with the UNO R4
  WiFi firmware; server-only, at least 32 characters. The board calls
  `/api/hardware/device` directly over verified HTTPS, without a Mac bridge.
  See [Arduino setup](../arduino/README.md).

`PRIVY_APP_SECRET` and `SLOT_BACKEND_PRIVATE_KEY` are sealed Railway variables.
`preserve()` keeps existing variables, including keys replaced later, without
putting their values in Git.

## Changes and deployment

From this directory or the monorepo root, link the CLI to the correct project
and environment, then run:

```sh
railway status
railway config plan
railway config apply
```

Always review the plan before applying it. The configuration file describes the
entire environment: add any new services there before applying changes.
Infrastructure changes require an apply. App code reaches production only through
work branch → PR into `dev` → PR from `dev` into `main`; updating `main` triggers
a deployment from the linked GitHub source. Do not push directly to `main` or
use manual deployment to bypass this workflow. See [../CONTRIBUTING.md](../CONTRIBUTING.md).

For an explicitly authorized manual deployment, run from the **monorepo root**
so Railway can apply the configured root directory:

```sh
railway up --service web --environment production --detach -m "Deploy web"
railway logs --service web --build --lines 100
railway logs --service web --lines 100
```

Sessions and locks are held in memory. A restart requires pairing again;
funds, prizes and games already onchain persist in the contract. Do not increase
the replica count or run another keeper with the same EOA elsewhere.

With a real keeper active, deploy during maintenance: pause new spins, wait for
active games to finish and stop the previous deployment before starting the new
one (`railway down --service web`, then deploy). Overlap and draining are set to
zero, but rolling deployment startup can still briefly run two processes: this
is not a distributed lock. After startup, the keeper recovers games from the contract.
