# Lucky Signal

Slot arcade per iPad condiviso, con accesso dal telefono, wallet embedded
Privy e USDC su Base. Integra `DigitalSlotMachine` in [`../../contracts`](../../contracts):
giocate a pagamento, free spin, reveal automatico e console admin onchain.
Il contratto non è ancora deployato: senza indirizzo configurato, wallet e
pairing funzionano e le operazioni di gioco restano disabilitate.

Per contribuire leggere [../../CONTRIBUTING.md](../../CONTRIBUTING.md),
[../../AGENTS.md](../../AGENTS.md) e le [regole web](AGENTS.md).

## Avvio

Node.js 22. Copiare `.env.example` in `.env.local` e compilare le variabili
necessarie senza condividere segreti in chat o nel repository.

```sh
npm ci
npm run dev
```

- `/`: terminale iPad, HTML/CSS/ES5, senza runtime React o SDK wallet.
- `/phone`: accesso Privy, pairing, saldo, ricezione USDC e consenso al budget.
- `/admin`: account Privy personali, wallet condiviso, collaboratori, catalogo, riserve e comandi.

Telefono e iPad devono raggiungere la stessa origine HTTPS. `APP_ORIGIN` è
l'origine pubblica esatta, senza path. `NEXT_PUBLIC_PRIVY_APP_ID` è pubblico;
`PRIVY_APP_SECRET` e `SLOT_BACKEND_PRIVATE_KEY` sono esclusivamente server-side.
Le credenziali vengono lette a runtime, anche nella build standalone.

## Privy e sessioni

Abilitare email, passkey e registrazione con passkey, wallet embedded Ethereum
di proprietà dell'utente e l'origine pubblica dell'app. L'email usa un codice
OTP: Privy non offre password tradizionali. Per conservare le passkey fra
accessi usare un dominio stabile. Un account email può aggiungere una passkey
senza creare un secondo wallet.

Il QR monouso dura 5 minuti e contiene il segreto nel fragment dell'URL, rimosso
dal telefono dopo la lettura. Il pairing richiede confronto del codice e JWT
Privy verificato sul backend. L'indirizzo proviene dai wallet embedded verificati
dell'account, non dal browser. Cookie HttpOnly, SameSite=Lax e Secure su HTTPS;
mutazioni protette con origine esatta e header dedicato.

La sessione condivisa termina dopo **3 minuti di inattività globale** su iPad e
telefono. Polling, animazioni e letture non rinnovano il timer. Il terminale
nasconde i dati alla scadenza anche offline e ignora risposte tardive. Un nuovo
pairing dello stesso account chiude il precedente. Il wallet e i fondi restano
all'utente; il logout admin segue invece la sessione personale Privy.

Il wallet player e quello condiviso dell'admin hanno selezioni separate. Ogni
admin accede con il proprio account Privy; tutti gli autorizzati vedono lo
stesso wallet, saldo e QR per il funding. I ruoli onchain vengono assegnati a
questo indirizzo condiviso. Il proprietario gestisce gli accessi; i collaboratori
possono operare senza modificare proprietà o ruoli. Un semplice login non
conferisce accesso. Configurazione e collaudo: [docs/shared-admin.md](docs/shared-admin.md).
`ADMIN_OWNER_USER_ID` indica l'account autorizzato a creare il wallet condiviso;
il codice è visibile dopo il login nell'admin. L'access token autentica le API.
La sessione Privy nel browser firma ogni richiesta wallet con
`useAuthorizationSignature`; gli identity token non sono necessari.
`ADMIN_WALLET_EXTERNAL_ID` seleziona il wallet condiviso: lasciarlo vuoto conserva
quello esistente. Per inizializzare un wallet distinto dopo una prova con un altro
account, seguire [la procedura dedicata](docs/shared-admin.md#cambio-account-dopo-una-prova).
L'admin usa un browser moderno; il terminale è destinato a iPad Air orizzontale,
iOS 12.5.8 / Safari 12.1.2, come la repo sperimentale di riferimento.

## Gioco e separazione dei wallet

| Operazione | Wallet che firma |
| --- | --- |
| `USDC.approve(slot, budget)` | Player Privy, con conferma sul telefono |
| `startSpin()` | Player Privy, attraverso il signer temporaneo della sessione |
| `startFreeSpin(player)` | EOA backend, con `GAME_MANAGER_ROLE` |
| `revealRound(gameId)` e chiusura delle giocate scadute | EOA backend |
| Configurazione, ruoli, tesoreria, deposito premi | Admin Privy, con conferma nel browser |

Sul telefono l'utente sceglie un budget USDC limitato. Il backend verifica
l'approvazione esatta prima di abilitare il signer. La sua policy ammette
esclusivamente `eth_sendTransaction`, rete Base, indirizzo della slot, valore
nativo zero e funzione `startSpin()`. Non ammette approvazioni token, trasferimenti
arbitrari o typed data. Il contratto scala il prezzo corrente dall'allowance
ad ogni giocata; il signer non può aumentarla. Le autorizzazioni e gli addebiti
al paymaster per il gas sono gestiti separatamente da Privy e non fanno parte
del budget approvato alla slot.

Logout e scadenza distruggono immediatamente la chiave P-256 temporanea in
memoria e tentano la cancellazione remota del quorum. La policy non ha una
scadenza autonoma: il timer è applicato dal backend, che custodisce la sola
chiave capace di usare quel signer. Metadati Privy possono restare se la pulizia
remota fallisce. **L'allowance USDC residua non viene azzerata dal logout**:
il telefono offre un comando esplicito per azzerarla. Per scegliere un nuovo
budget si chiude il collegamento e si scansiona un nuovo QR.

I rulli girano dall'invio della giocata fino a due conferme del reveal. Il
backend aspetta il blocco richiesto dal contratto e conclude la giocata anche
se il telefono è chiuso o la sessione è terminata. Il premio viene pagato dal
contratto al player originale. Nessun risultato viene inventato o anticipato
con `previewPendingResult`.

Stato corrente da read call; premi storici da `RoundRevealed` e `PrizePaid`.
Il keeper recupera le giocate pendenti con `getActiveGameIds` dopo ogni riavvio.
**Nessun database.** Dettagli, mapping ABI, limiti e configurazione in
[docs/contracts.md](docs/contracts.md).

La precedente prova di `personal_sign` resta disponibile quando il contratto
non è collegato. Usa una policy separata limitata all'esatto messaggio con
nonce/sessione, viene eseguita una sola volta e verifica la firma del wallet.

## Dopo il deploy del contratto

Impostare `SLOT_CONTRACT_ADDRESS`, il suo `SLOT_DEPLOYMENT_BLOCK` esatto e una
`SLOT_BACKEND_PRIVATE_KEY` dedicata. L'app verifica Base mainnet (8453), presenza
del codice e token di pagamento USDC nativo
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimali).

Assegnare i ruoli all'admin Privy tramite owner e `GAME_MANAGER_ROLE` al wallet
backend. Finanziare quest'ultimo con ETH su Base; configurare almeno 3 simboli,
pesi totali pari a 1000 e riserve dei premi. Il reveal è permissionless, mentre
la partenza dei free spin richiede il ruolo manager.

Per player e admin, `PRIVY_GAS_MODE=usdc` (default) richiede **User pays**, con
USDC su Base abilitato nel dashboard Privy. Il gas viene addebitato al wallet
dell'utente in USDC, oltre all'importo della giocata/operazione. Solo un rifiuto
esplicito di saldo insufficiente prima dell'invio abilita un tentativo in ETH
dallo stesso wallet; timeout e risposte ambigue non attivano il fallback.
Con `PRIVY_GAS_MODE=eth` si usa direttamente ETH. La vecchia variabile
`PRIVY_SPONSOR_TRANSACTIONS` non è più utilizzata. L'EOA backend paga sempre
il proprio gas in ETH. Dettagli e limiti: [docs/gas.md](docs/gas.md).
`BASE_RPC_URL` resta privato; l'RPC pubblico è un default per sviluppo.

## Railway

`Dockerfile` multi-stage, output Next standalone e [`../../.railway/railway.ts`](../../.railway/railway.ts) con
healthcheck `/api/health`. Impostare le variabili nel servizio e usare un dominio
HTTPS registrato anche in Privy. `PORT` è fornita da Railway. I file `.env*`
sono esclusi dall'immagine Docker.

Usare **una sola replica, sempre attiva, senza sospensione automatica**. Il
keeper deve continuare a lavorare senza richieste browser. Sessioni, chiavi e
coordinamento dei nonce sono in memoria: un deploy chiude i pairing, ma non
cancella giocate, premi o crediti già onchain. Il backend riprende i reveal dal
contratto. Non usare la stessa EOA contemporaneamente in altri processi.

Per provare l'output di produzione:

```sh
npm run build
APP_ORIGIN=http://localhost:3000 HOSTNAME=0.0.0.0 PORT=3000 node --env-file=.env.local .next/standalone/server.js
```

Procedura monorepo e variabili: [`../../.railway/README.md`](../../.railway/README.md).
Il contratto non è ancora deployato. `SLOT_BACKEND_PRIVATE_KEY=REPLACE_ME`
mantiene il keeper disattivato finché non viene inserita una chiave reale.
Arduino non è ancora collegato: `window.slotPullLever()` è il punto d'ingresso
del terminale per il futuro adapter della leva.

## Verifica

```sh
npm test
npm run typecheck
npm run test:browser
npm run test:chain
npm run build
```

I test chain richiedono `anvil` sul PATH e usano il bytecode del contratto reale
con token di test, esclusivamente su una blockchain locale. Coprono addebito
player, deduplicazione, attesa del blocco, reveal dopo riavvio, premi ERC20 e
ERC1155, crediti free spin, scadenze, ruoli e transazioni admin. I fixture sono
separati dal runtime di produzione e nessun fondo reale viene movimentato.

I test browser del terminale usano API di pairing di test e snapshot onchain
controllati: verificano entrambi i tempi, conferme, griglia row-major, linea
vincente, logout e layout 1024×768 / 1024×650. Backend: autenticazione, budget
esatto, isolamento e revoca anche durante operazioni asincrone. Entrambi i
bundle del terminale sono verificati come ES5.

I collaudi manuali `scripts/live-privy-check.mjs` e `scripts/live-admin-check.mjs`
creano account Privy di prova con passkey virtuali e wallet vuoti. Non salvano
credenziali né inviano transazioni. Il secondo esegue
`scripts/live-shared-admin-check.ts`: due identità, un wallet di test distinto
da quello dell'app, firme reali, revoca, ripartenza e funding condiviso.
L'invio onchain resta intercettato nel browser per verificare consenso gas,
risposta persa e recupero dopo refresh senza un secondo invio.
Non fanno parte dei test automatici ordinari.
Il nuovo invio di transazioni tramite Privy richiede ancora un collaudo sul
deployment effettivo. Restano anche le verifiche su iPad fisico ed email OTP.

## Riferimenti

- [Privy: signer](https://docs.privy.io/wallets/using-wallets/signers/quickstart)
- [Privy: policy](https://docs.privy.io/controls/policies/overview)
- [Privy: invio transazioni](https://docs.privy.io/wallets/using-wallets/ethereum/send-a-transaction)
- [Privy: gas sponsorship](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup)
- [Privy: email OTP](https://docs.privy.io/authentication/user-authentication/login-methods/email)

## Token inventory and swaps

The admin panel includes **Swap** (LI.FI API, USDC or native ETH → six supported Base RWA tokens) and
**Inventory** (shared wallet balances, NFT placeholders, free-spin counter and
reviewed contract deposits). See [assets and swap setup](docs/assets-and-swaps.md)
for the token addresses, decimal precision, deployment mapping, Privy gas setup,
collaborator permission upgrades and recovery behavior. Both owner and authorized collaborators can swap; gas uses the shared USDC balance with ETH fallback. Brand sources are recorded in
[public/brands/SOURCES.md](public/brands/SOURCES.md).
