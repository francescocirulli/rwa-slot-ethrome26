# Wall Street Slot — ETHRome 2026

Monorepo for Wall Street Slot, the retro iPad slot machine that pays real-world
asset prizes, with Privy wallets and USDC on Base. Every spin is a Base
transaction and every result is verifiable on BaseScan.

**Live:** [iPad terminal](https://web-production-e2628.up.railway.app) ·
[admin](https://web-production-e2628.up.railway.app/admin) ·
[Railway project](https://railway.com/project/c3367565-9058-4341-9795-e9de185dfea0).

## Live contracts

| Network | Contract | Address |
| --- | --- | --- |
| Base mainnet | `DigitalSlotMachine` | [`0xc0253B67E835500aC9a69214fa4F2Bbce61CA72c`](https://basescan.org/address/0xc0253B67E835500aC9a69214fa4F2Bbce61CA72c) |
| Base mainnet | `SlotPrize1155` | [`0x8D411D8efCDb0d528E4F6659B44223264Fd0B719`](https://basescan.org/address/0x8D411D8efCDb0d528E4F6659B44223264Fd0B719) |
| Ethereum Sepolia | Official ENSv2 `ETHRegistry` | [`0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2`](https://sepolia.etherscan.io/address/0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2) |

The deployed game uses native Base USDC at `0.05 USDC` per paid spin. Its live
configuration has a 5x3 grid, three paylines, 15 outcome symbols, a 1% no-prize
outcome, a two-block randomness target and a 256-block reveal window. A reveal is
permissionless; the backend keeper normally submits it as soon as the target block
is sealed. Because the target block hash is only available in the following block,
a spin included in block `N` can be revealed from `N + 3` with the current delay.

ERC-20 and ERC-1155 prizes are transferred immediately by the slot. The ERC-1155
collection contains IDs 1 through 8 and stores JSON metadata and SVG artwork fully
onchain as base64 data URIs. ENS Registration vouchers use collection ID 2. Their
Base transfer is verified by the backend before the Sepolia registrar creates a
`*.wallstreetslot.eth` ENSv2 name owned by the player.

We registered `wallstreetslot.eth` as the parent ENS name on Sepolia using the
official `ensdomains/contracts-v2` deployment. A player who wins and redeems an
ENS Registration voucher chooses an available label and receives the corresponding
subdomain, for example `elon.wallstreetslot.eth`, in their own wallet. The official
`ETHRegistry` delegates these `wallstreetslot.eth` subnames to the project's
[`UserRegistry`](https://sepolia.etherscan.io/address/0x6D9E4b4a02D966D460D5fFBA87fDE09a7Ba34b21).
The project-specific
[`SlotENSRegistrar`](https://sepolia.etherscan.io/address/0x84f6ddfe529D5f38AF2a95e38B6a23f9b4CDAA69)
verifies the backend-attested Base voucher consumption and registers the subname
through that ENSv2 registry; it is not the official ENS contract listed above.

| Directory | Contents |
| --- | --- |
| [`apps/web`](apps/web) | Next.js, iPad terminal, phone login, admin panel and backend keeper |
| [`contracts`](contracts) | Solidity contracts, Foundry tests and scripts |
| [`arduino`](arduino) | UNO R4 WiFi firmware, direct Railway HTTPS connection and cabinet setup |
| [`.railway`](.railway) | Railway web service configuration |

The components are independent: the app's npm dependencies and lockfile stay
in `apps/web`; Foundry and its submodules stay in `contracts`. The web build does
not require Solidity or contract dependencies. The root npm package provides
convenience commands and the Railway configuration SDK.

## Collaboration

The required workflow is **work branch → PR into `dev` → PR from `dev` into `main`**.
Do not commit or push directly to `dev` or `main`. `main` feeds production;
`dev` integrates the team's work and does not yet have a staging deployment.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. Shared agent rules
are in [AGENTS.md](AGENTS.md); component instructions are in
[`apps/web/AGENTS.md`](apps/web/AGENTS.md) and [`contracts/AGENTS.md`](contracts/AGENTS.md).
Each `CLAUDE.md` imports its corresponding `AGENTS.md` without duplicating rules.
Commits use the human contributor's Git identity, with no AI co-authors or
automatic tool attribution in commits or PRs. Write repository Markdown in English.

## Architecture

The iPad terminal uses HTML/CSS/ES5 and generates a QR code for `/phone`. On the
phone, the user signs in through Privy and authorizes the terminal session. The
Next.js backend coordinates pairing and temporary signers; global inactivity
ends the session after three minutes. `/admin` uses personal accounts to operate
the shared wallet.

Spins have two stages: the player wallet sends the initial transaction, then the
permissionless reveal settles the round; the backend EOA is the normal reveal
keeper. The reels keep spinning while waiting, and confirmed contract state and
events determine the result. Admins sign management operations with the shared
Privy wallet and use LI.FI for swaps. The contract stores games, prizes and free-spin
credits; app sessions and write locks are held in memory. One player can have at
most one pending paid or free spin.

The physical cabinet uses an UNO R4 WiFi (joystick, PIR, LCD and RGB strip) with a
direct Wi-Fi connection to the Railway HTTPS backend. No Mac or tunnel is needed
in production. The iPad provides audio and an
idle screensaver. The terminal defaults to real play; its explicit demo switch
opens a browser-only simulation without wallets or transactions. See
[hardware and demo setup](arduino/README.md).

## Development

Use Node.js 22. Foundry is only required to build and test contracts.

```sh
git clone --recurse-submodules https://github.com/francescocirulli/rwa-slot-ethrome26.git
cd rwa-slot-ethrome26
npm ci
npm run setup:web
cp apps/web/.env.example apps/web/.env.local
# Fill in apps/web/.env.local with your Privy configuration.
npm run dev
```

- `/`: iPad Air terminal in landscape, iOS 12.5.8 / Safari 12.1.2.
- `/phone`: personal authentication, wallet, pairing and budget.
- `/admin`: shared wallet, collaborators, LI.FI swaps and inventory.

```sh
npm test
npm run build
npm run test:browser      # First install Chromium: npm exec --prefix apps/web -- playwright install chromium
npm run test:chain        # Requires Anvil
npm run test:contracts    # Requires Foundry and submodules
```

For an existing clone, run `git submodule update --init --recursive` to install
contract dependencies. Do not run `forge install` from `apps/web`.

## Railway deployment

The `web` service uses `/apps/web` as its root, the app's multi-stage Dockerfile,
Next standalone output and the `/api/health` healthcheck. Settings are in
[`.railway/railway.ts`](.railway/railway.ts); procedures and variables are in
[`.railway/README.md`](.railway/README.md).

Set secrets in the service variables, never in tracked files or the image.
`SLOT_BACKEND_PRIVATE_KEY=REPLACE_ME` is an explicitly disabled placeholder:
it does not represent a wallet and cannot sign transactions. Replace it with
a dedicated EOA's key once the contract is deployed. The backend wallet pays
gas in ETH; Privy wallets use USDC with ETH fallback according to app configuration.

Run one always-on replica, with no database. A restart ends pairings; games
already recorded onchain can be recovered from the contract. Before enabling
the keeper, also follow the deployment instructions in `.railway/README.md`.

Details: [app and wallets](apps/web/README.md),
[contracts](contracts/README.md),
[onchain integration](apps/web/docs/contracts.md),
[ENSv2 redemption](apps/web/docs/ens.md),
[shared admin wallet](apps/web/docs/shared-admin.md),
[swaps and inventory](apps/web/docs/assets-and-swaps.md).

## Arkiv seasonal leaderboard

The optional Arkiv integration indexes confirmed Base spins and displays the same
season on iPad and phone. Contributions expire together at the season boundary;
spin history has independent retention. See [setup and bounty evidence](arkiv/README.md),
[schema](arkiv/schema.md), and [feedback](friction.md).
