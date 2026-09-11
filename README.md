# Lucky Signal — ETHRome 2026

Monorepo della slot per iPad con wallet Privy e USDC su Base.

| Cartella | Contenuto |
| --- | --- |
| [`apps/web`](apps/web) | Next.js, terminale iPad, login dal telefono, admin e backend keeper |
| [`contracts`](contracts) | Contratti Solidity, test e script Foundry |
| [`.railway`](.railway) | Configurazione del servizio web su Railway |

Le due componenti sono autonome: npm e il lockfile dell'app restano in
`apps/web`, Foundry e i suoi submodule restano in `contracts`. La build web non
richiede Solidity né le dipendenze dei contratti. Il package npm alla radice
contiene comandi di comodo e l'SDK per la configurazione Railway.

## Sviluppo

Node.js 22; Foundry serve solo per compilare/testare i contratti.

```sh
git clone --recurse-submodules https://github.com/francescocirulli/rwa-slot-ethrome26.git
cd rwa-slot-ethrome26
npm ci
npm run setup:web
cp apps/web/.env.example apps/web/.env.local
# Compilare apps/web/.env.local con la configurazione Privy.
npm run dev
```

- `/`: terminale iPad Air orizzontale, iOS 12.5.8 / Safari 12.1.2.
- `/phone`: autenticazione personale, wallet, pairing e budget.
- `/admin`: wallet condiviso, collaboratori, swap LI.FI e inventory.

```sh
npm test
npm run build
npm run test:browser      # prima: cd apps/web && npx playwright install chromium
npm run test:chain        # richiede Anvil
npm run test:contracts    # richiede Foundry e submodule
```

Se il clone esiste già, `git submodule update --init --recursive` installa le
dipendenze dei contratti. Non eseguire `forge install` da `apps/web`.

## Deploy Railway

Il servizio `web` usa `/apps/web` come root, il suo Dockerfile multi-stage,
Next standalone e l'healthcheck `/api/health`. Le impostazioni sono in
[`.railway/railway.ts`](.railway/railway.ts); procedura e variabili in
[`.railway/README.md`](.railway/README.md).

I segreti vengono inseriti nelle variabili del servizio, mai nei file
versionati o nell'immagine. `SLOT_BACKEND_PRIVATE_KEY=REPLACE_ME` è un
placeholder esplicitamente disabilitato: non rappresenta un wallet e non può
firmare transazioni. Sostituirlo con la chiave di una EOA dedicata quando il
contratto sarà deployato. La chiave backend paga il gas in ETH; i wallet Privy
usano USDC con fallback ETH secondo la configurazione dell'app.

Una sola replica sempre accesa, nessun database. Un riavvio chiude i pairing;
le giocate già registrate si recuperano dal contratto. Prima di abilitare il
keeper seguire anche le indicazioni sui deploy in `.railway/README.md`.

Dettagli: [app e wallet](apps/web/README.md),
[contratti](contracts/README.md),
[integrazione onchain](apps/web/docs/contracts.md),
[wallet admin condiviso](apps/web/docs/shared-admin.md),
[swap e inventory](apps/web/docs/assets-and-swaps.md).
