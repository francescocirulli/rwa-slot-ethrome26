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
chiave comune nel dashboard. In **User management → Authentication → Advanced**
attivare **Return user data in an identity token**, poi accedere di nuovo.
L'access token autentica le API dell'app; l'identity token, verificato contro
lo stesso user ID, autorizza il wallet tramite `authorization_context.user_jwts`.
Il collaudo ha rilevato che passare l'access token alle API wallet restituisce
`Invalid JWT token provided`.
Servono inoltre email/passkey e **User pays → Base → USDC** per le commissioni. I quorum con
user ID vengono creati dal codice. Un eventuale rifiuto del provider deve
essere risolto sull'app Privy, senza ripiegare su wallet controllati dal server.

## Permessi

Il proprietario del wallet approva l'aggiunta/rimozione di signer con il proprio
identity token Privy, verificato insieme all'access token. Il collaboratore ha un quorum personale e una policy controllata
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

Il wallet è ritrovato con l'external ID `lucky_signal_shared_admin_v1`; i membri
sono letti dai signer/quorum Privy. Un riavvio non perde funding o accessi.
Serve sempre una sola replica del server per il coordinamento delle scritture.
Non è stato aggiunto un database.

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

Stato del collaudo reale al 2026-09-11: verificati i due login separati e la
creazione del wallet di test con owner. La condivisione/firma è ancora in
attesa dell'attivazione degli identity token nell'app Privy; il test si ferma
con l'istruzione corrispondente. Revoca, persistenza, funding comune e invii
simultanei sono coperti dai test con provider simulato. Ripetere il test reale
dopo avere attivato l'opzione e rifatto il login.

- [Privy: owner e signer](https://docs.privy.io/controls/authorization-keys/owners/overview)
- [Privy: quorum con user ID](https://docs.privy.io/api-reference/key-quorums/create)
- [Privy: abilitare identity token](https://docs.privy.io/user-management/users/identity-tokens)
- [Privy: policy Ethereum](https://docs.privy.io/controls/policies/example-policies/ethereum)

### Swap capability

LI.FI API swaps support both owner and collaborators, with USDC or native ETH input.
Existing members need the owner to click **Aggiorna permessi**. The new policy grants
constrained `eth_sendTransaction` approval/router calls, including before slot deploy;
old exact policies retain their previous capabilities until explicitly upgraded.
Gas uses the shared USDC balance with ETH fallback after a definitive rejection.
See [asset and swap integration](assets-and-swaps.md) for boundaries and recovery.
