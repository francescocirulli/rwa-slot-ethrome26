# Wallet admin condiviso

Ogni persona accede a `/admin` con il proprio account Privy (email OTP o
passkey). Un wallet dedicato all'arcade raccoglie tutte le ricariche; lo stesso
saldo paga le operazioni e il gas USDC/ETH. Il wallet player e l'EOA keeper
restano ruoli distinti: il wallet admin non viene offerto al pairing dell'iPad.

## Attivazione

1. Il proprietario accede a `/admin` e copia il proprio codice `did:privy:…`.
2. Impostare **`ADMIN_OWNER_USER_ID`** nell'ambiente del server. Non è una
   credenziale segreta. La configurazione vuota non nomina automaticamente
   proprietario il primo visitatore.
3. Il proprietario sceglie **Crea wallet condiviso**. Il backend crea un wallet
   con un quorum composto soltanto dal suo user ID, soglia 1. Nessuna chiave
   di firma condivisa viene creata nell'env.
4. Il collaboratore accede con il proprio account, copia il suo codice e lo
   comunica al proprietario. Nella sezione Wallet admin, il proprietario lo
   aggiunge e conferma i permessi. L'app non manda email o inviti automatici.
5. Entrambi verificano la firma e possono finanziare l'indirizzo/QR condiviso.
6. Dopo il deploy assegnare i ruoli onchain al nuovo indirizzo condiviso. Il
   proprietario sceglie **Aggiorna permessi** per abilitare il collaboratore
   sul contratto configurato. Prima del deploy sono disponibili funding,
   saldo, condivisione e firma di prova.

Privy consente di creare quorum e signer tramite API: non occorre creare una
chiave comune nel dashboard. Servono email/passkey e **User pays → Base → USDC**
per le commissioni. Gli identity token non sono richiesti per autorizzare il wallet.

L'access token verifica l'identità sulle API dell'app. Per ogni modifica o firma,
il backend prepara la richiesta esatta con il Node SDK; il browser la autorizza
con `useAuthorizationSignature`. La firma torna al Node SDK tramite `sign_fns`.
Il canale dura al massimo 90 secondi ed è vincolato all'account e all'endpoint,
utilizzabile da una sola operazione. Le chiavi restano nel SDK Privy del browser.
Una pagina chiusa, un cambio account o una firma rifiutata non autorizzano l'invio.
Servono una sola replica sempre attiva e nessun database; al riavvio, un canale
interrotto richiede una nuova conferma. Le operazioni già inviate si verificano
attraverso i loro riferimenti esistenti, senza ripeterle.

La precedente implementazione passava un identity token a `user_jwts`:
Privy rispondeva `400 Invalid JWT token provided` su `/v1/wallets/authenticate`,
sia per la firma di prova sia per l'aggiunta di un collaboratore. La prova reale
ha rifiutato anche l'access token; abilitare gli identity token non risolveva.
La firma nativa nel browser evita quello scambio e non cambia la proprietà.

## Permessi

Il proprietario del wallet approva l'aggiunta/rimozione di signer con il proprio
sessione Privy nel browser, autenticata anche sulle API dell'app. Il collaboratore ha un quorum personale e una policy controllata
dal proprietario. Può gestire la slot e finanziare/prelevare premi quando il
contratto lo consente. Sono esclusi cambi di proprietà, ruoli, rinunce ai ruoli,
approvazioni di budget player e modifiche al wallet Privy. Le policy limitano
Base, valore ETH diretto zero, funzioni admin ammesse sul contratto configurato
e trasferimenti ERC20/ERC1155 diretti alla slot.

La proprietà onchain è dell'indirizzo condiviso: i limiti del collaboratore
sono imposti dall'app e dalla policy Privy. Il contratto da solo non distingue
quale persona usa quel wallet. Gli eventi indicano l'indirizzo comune.

Per ogni lettura privata e invio, l'app ricontrolla wallet, proprietario,
quorum e policy su Privy. La revoca impedisce nuovi invii, incluso il fallback
ETH non ancora iniziato. Le transazioni già inoltrate non vengono annullate.

Le conferme sono vincolate all'utente che ha preparato l'operazione. Gli altri
admin possono seguirne lo stato, ma non confermarla al suo posto. Un lock
comune al wallet evita invii concorrenti delle due persone. I limiti di
recupero senza hash restano quelli descritti in [gas.md](gas.md).

## Persistenza e test

Il wallet è ritrovato con `ADMIN_WALLET_EXTERNAL_ID`. Se la variabile è vuota o
assente, l'external ID rimane `lucky_signal_shared_admin_v1`, preservando i wallet
già creati. I membri sono letti dai signer/quorum Privy. Un riavvio non perde funding o accessi.
Serve sempre una sola replica del server per il coordinamento delle scritture.
Non è stato aggiunto un database.

### Cambio account dopo una prova

Creare una passkey tramite una nuova registrazione può creare un altro account
Privy. L'account con cui si accede è distinto dal wallet condiviso, che ha un
proprietario registrato su Privy. Cambiare `ADMIN_OWNER_USER_ID` non trasferisce
quella proprietà: l'app blocca l'accesso se i due proprietari non corrispondono.
Non vengono nominati proprietari automaticamente gli utenti più recenti.

Per inizializzare **un nuovo wallet con un nuovo indirizzo**, dopo aver deciso
di non usare quello di prova:

1. Accedere con l'account da mantenere e impostare il suo `did:privy:…` in
   `ADMIN_OWNER_USER_ID`.
2. Scegliere un nuovo `ADMIN_WALLET_EXTERNAL_ID`, per esempio
   `rwa_slot_admin_production_v1`, distinto dagli identificatori già usati in
   questa app Privy. Sono ammessi 1–128 caratteri: lettere, cifre, `_` e `-`.
3. Riavviare il servizio con entrambe le variabili. Il proprietario accede a
   `/admin` e conferma **Crea wallet condiviso**. Il quorum iniziale contiene
   soltanto il suo account. Nessun altro utente può crearlo.
4. Il collaboratore accede con il proprio account e comunica il suo codice;
   il proprietario lo aggiunge dall'app. Entrambi usano l'indirizzo del nuovo
   wallet, con funding comune e permessi distinti.

Conservare questo external ID anche quando si aggiungono collaboratori o si
aggiorna l'app. Il vecchio wallet, i suoi accessi e i suoi fondi restano intatti;
non vengono trasferiti al nuovo. Aggiornare eventuali indirizzi di funding e
ruoli onchain separatamente. Per mantenere invece il vecchio indirizzo serve
un trasferimento autorizzato dal proprietario attuale su Privy, non un cambio
di external ID.

### Verifica

`npm test` copre ownership, assenza di accesso implicito, utenti distinti con
saldo/QR comune, policy, revoca, scope player/admin, conferme e richieste
simultanee. Per il test manuale con Privy reale e due account usa:

```sh
LIVE_CHECK_ORIGIN=https://tuo-dominio node scripts/live-admin-check.mjs
```

Lo script carica `.env.local` senza stamparlo e usa un external ID di test
casuale, mai quello del wallet operativo. Crea due account e un wallet vuoto;
firma messaggi benigni e revoca l'accesso del collaboratore alla fine.
Le transazioni restano intercettate. Evidenza in
`artifacts/live-shared-admin-check.json`. Non carica fondi né deploya contratti.

Il collaudo deve completare aggiunta, firma di entrambe le persone e revoca
con il provider reale: un login riuscito o un test con provider simulato non
provano che Privy accetti l'autorizzazione del wallet.

Collaudo del 2026-09-12 completato con la build locale: due registrazioni
passkey indipendenti, wallet condiviso vuoto, aggiunta del collaboratore,
firma verificata da entrambi sullo stesso indirizzo, persistenza dopo il
riavvio del servizio e revoca. Anche il recupero della UI dopo una risposta
persa è verificato; invii onchain e pagamento del gas restano simulati.
Lo script crea account di prova nell'app Privy: non usare l'ultimo account
registrato per dedurre chi debba essere `ADMIN_OWNER_USER_ID`.

- [Privy: owner e signer](https://docs.privy.io/controls/authorization-keys/owners/overview)
- [Privy: quorum con user ID](https://docs.privy.io/api-reference/key-quorums/create)
- [Privy: firma nativa delle richieste](https://docs.privy.io/controls/authorization-keys/using-owners/sign/utility-functions)
- [Privy: policy Ethereum](https://docs.privy.io/controls/policies/example-policies/ethereum)

### Swap capability

LI.FI API swaps support both owner and collaborators, with USDC or native ETH input.
Existing members need the owner to click **Aggiorna permessi**. The new policy grants
constrained `eth_sendTransaction` approval/router calls, including before slot deploy;
old exact policies retain their previous capabilities until explicitly upgraded.
Gas uses the shared USDC balance with ETH fallback after a definitive rejection.
See [asset and swap integration](assets-and-swaps.md) for boundaries and recovery.
