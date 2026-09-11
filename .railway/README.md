# Railway

Un progetto `rwa-slot-ethrome26`, ambiente `production`, servizio `web`.
La configurazione in `railway.ts` usa l'SDK `railway/iac`; `npm ci` alla radice
installa la versione fissata nel lockfile. Richiede Railway CLI >= 5.42.1.
Il vecchio formato `railway.json` non viene usato per questo nuovo servizio.

Deployment pubblico: [app](https://web-production-e2628.up.railway.app),
[admin](https://web-production-e2628.up.railway.app/admin),
[dashboard Railway](https://railway.com/project/c3367565-9058-4341-9795-e9de185dfea0).
Primo deploy verificato dal commit `93b1164`: build Docker, healthcheck, QR
di pairing e schermate di login. Il contratto e la chiave keeper restano da
configurare; non sono state inviate transazioni durante il collaudo del deploy.

| Impostazione | Valore |
| --- | --- |
| GitHub | `francescocirulli/rwa-slot-ethrome26`, branch `main` |
| Root directory | `/apps/web` |
| Builder | Dockerfile, percorso `Dockerfile` relativo alla root del servizio |
| Avvio | `node server.js`, definito nel Dockerfile |
| Healthcheck | `/api/health`, timeout 60 secondi |
| Rete | `0.0.0.0`, porta 3000, dominio HTTPS Railway |
| Scalabilità | una replica; serverless/sleep disabilitato |
| Watch paths | `/apps/web/**` |

Il Dockerfile riceve come contesto **apps/web**, non la radice della monorepo:

```sh
docker build -t rwa-slot-web apps/web
docker run --rm -p 3000:3000 --env-file apps/web/.env.local rwa-slot-web
```

Non servono segreti durante la build. L'app legge la configurazione Privy
sul server al momento della richiesta; `.env*` è escluso dal contesto Docker.

## Variabili

Usare le variabili del servizio Railway. L'elenco completo, con spiegazioni,
è in [`../apps/web/.env.example`](../apps/web/.env.example).

- `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`: app Privy già configurata.
- `APP_ORIGIN`: URL HTTPS pubblico esatto, senza slash finale. Registrare
  questo dominio anche fra le origini consentite di Privy, se vengono limitate.
- `ADMIN_OWNER_USER_ID`: account proprietario del wallet admin condiviso.
- `PRIVY_GAS_MODE=usdc`: gas USDC con fallback ETH per i wallet Privy.
- `BASE_RPC_URL`: endpoint Base mainnet; preferire un RPC dedicato in produzione.
- `SLOT_CONTRACT_ADDRESS` e `SLOT_DEPLOYMENT_BLOCK`: vuoti finché il contratto
  non è deployato. Login, wallet e swap funzionano anche senza contratto.
- `SLOT_BACKEND_PRIVATE_KEY=REPLACE_ME`: placeholder disabilitato. Sostituire
  con `0x` + 64 cifre esadecimali della EOA dedicata, finanziata in ETH su Base.
  Per i free spin serve `GAME_MANAGER_ROLE`. Questa non è la chiave del wallet
  Privy admin. Non usare nomi con prefisso `NEXT_PUBLIC_` per questo segreto.
- `LIFI_API_KEY`: facoltativa, può rimanere vuota.

`PRIVY_APP_SECRET` e `SLOT_BACKEND_PRIVATE_KEY` sono variabili sealed su Railway.
`preserve()` conserva le variabili già impostate, incluse le chiavi sostituite
successivamente, senza inserirne il contenuto in Git.

## Modifiche e deploy

Da questa directory o dalla radice della monorepo, collegare la CLI al progetto
e all'ambiente corretti, poi:

```sh
railway status
railway config plan
railway config apply
```

Controllare sempre il piano prima dell'apply. Questo file descrive l'intero
ambiente: aggiungere qui eventuali nuovi servizi prima di applicare modifiche.
Le modifiche di infrastruttura richiedono l'apply. Il codice dell'app arriva in
produzione solo dopo il flusso branch di lavoro → PR in `dev` → PR `dev` in
`main`; l'aggiornamento di `main` avvia il deploy dalla sorgente GitHub collegata.
Non pushare direttamente su `main` e non usare un deploy manuale per aggirare
questo flusso. Vedi [../CONTRIBUTING.md](../CONTRIBUTING.md).

Per un deploy manuale, eseguire dalla **radice della monorepo**, in modo che
Railway possa applicare la root directory configurata:

```sh
railway up --service web --environment production --detach -m "Deploy web"
railway logs --service web --build --lines 100
railway logs --service web --lines 100
```

Le sessioni e i lock sono in memoria. Un riavvio richiede un nuovo pairing;
fondi, premi e giocate già onchain persistono nel contratto. Non aumentare le
repliche né eseguire altrove un keeper con la stessa EOA.

Con un keeper reale attivo, fare i deploy in manutenzione: sospendere nuove
giocate, attendere la chiusura delle giocate attive e fermare il deployment
precedente prima di avviare il nuovo (`railway down --service web`, poi deploy).
Overlap e draining sono impostati a zero, ma la fase di avvio di un rolling
deploy può comunque eseguire due processi per un breve periodo: non è un lock
distribuito. Dopo l'avvio il keeper recupera le giocate dal contratto.
