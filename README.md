# Lucky Signal — ETHRome 2026

Monorepo della slot per iPad con wallet Privy e USDC su Base.

**Online:** [terminale iPad](https://web-production-e2628.up.railway.app) ·
[admin](https://web-production-e2628.up.railway.app/admin) ·
[progetto Railway](https://railway.com/project/c3367565-9058-4341-9795-e9de185dfea0).

| Cartella | Contenuto |
| --- | --- |
| [`apps/web`](apps/web) | Next.js, terminale iPad, login dal telefono, admin e backend keeper |
| [`contracts`](contracts) | Contratti Solidity, test e script Foundry |
| [`.railway`](.railway) | Configurazione del servizio web su Railway |

Le due componenti sono autonome: npm e il lockfile dell'app restano in
`apps/web`, Foundry e i suoi submodule restano in `contracts`. La build web non
richiede Solidity né le dipendenze dei contratti. Il package npm alla radice
contiene comandi di comodo e l'SDK per la configurazione Railway.

## Collaborazione

Il flusso richiesto è **branch di lavoro → PR in `dev` → PR da `dev` in `main`**.
Nessun commit o push diretto su `dev` o `main`. `main` alimenta la produzione;
`dev` integra il lavoro del team e non ha ancora un deploy staging.

Leggere [CONTRIBUTING.md](CONTRIBUTING.md) prima di contribuire. Le regole comuni
per gli agenti sono in [AGENTS.md](AGENTS.md); le istruzioni specifiche sono in
[`apps/web/AGENTS.md`](apps/web/AGENTS.md) e [`contracts/AGENTS.md`](contracts/AGENTS.md).
Ogni `CLAUDE.md` importa il corrispondente `AGENTS.md`, senza duplicare le regole.
I commit usano l'identità Git del contributore umano; niente co-autori AI o
firme automatiche degli strumenti nei commit e nelle PR.

## Architettura

Il terminale iPad usa HTML/CSS/ES5 e genera un QR per `/phone`. Sul telefono
l'utente accede a Privy e autorizza la sessione del terminale. Il backend Next.js
coordina il pairing e i signer temporanei; l'inattività globale chiude la sessione
dopo tre minuti. `/admin` usa account personali per operare sul wallet condiviso.

Le giocate hanno due tempi: il wallet player invia la transazione iniziale, poi
la EOA backend rivela il round. Nel frattempo la slot gira; lo stato del contratto
e gli eventi determinano il risultato. L'admin firma le operazioni di gestione
con il wallet Privy condiviso e usa LI.FI per gli swap. Il contratto mantiene
giocate, premi e crediti; le sessioni e i lock dell'app sono in memoria.

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
