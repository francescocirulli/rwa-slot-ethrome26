# Integrazione DigitalSlotMachine

ABI allineata a [`../../../contracts/abi/DigitalSlotMachine.json`](../../../contracts/abi/DigitalSlotMachine.json),
compilata da `contracts/src/DigitalSlotMachine.sol` nella stessa monorepo.
Il keccak256 del sorgente è registrato in `lib/slot/abi.ts` e nei fixture di test.
Il sorgente dei contratti non è stato modificato. Non mancano interfacce necessarie
al flusso implementato.

## Flusso in due tempi

1. Il player autentica il proprio wallet embedded sul telefono e associa l'iPad.
   Sceglie un budget, firma `USDC.approve(slot, budget)` e aggiunge un signer con
   policy limitata a `startSpin()` su questa slot/rete, senza valore ETH.
2. La leva/pulsante invia una richiesta autenticata dalla sessione iPad. Il
   backend deriva il player dalla sessione, controlla stato, saldo, allowance,
   servizio di reveal e consenso. Il signer invia `startSpin()` dal wallet
   **player**. La chiamata ritorna subito uno stato da monitorare.
3. L'ID viene dall'evento `SpinStarted` nella ricevuta, filtrato per contratto e
   player. Il costo è addebitato in questa transazione, non nel reveal.
4. Il keeper legge le giocate attive. A `targetBlock + 1` può inviare
   `revealRound(gameId)` dalla propria EOA; `targetBlock` stesso è ancora presto.
   Fino al reveal la griglia è in movimento.
5. Il contratto salva il risultato e paga atomicamente il player originale.
   L'app legge `getGame`, `getGameStatus`, `RoundRevealed`, `PrizePaid` e attende
   due conferme prima di fermare la griglia. Due conferme sono una soglia UX
   sulla chain L2, non equivalgono alla finalità Ethereum.

Con crediti disponibili, `startFreeSpin(player)` è firmata dall'EOA backend con
`GAME_MANAGER_ROLE`: destinatario vincolato alla sessione, nessun addebito USDC
e nessuna approvazione token necessaria. Poi segue lo stesso reveal.

Un logout distrugge l'autorizzazione per nuove giocate, ma una transazione già
inviata può ancora essere inclusa. Il keeper conclude comunque il round per il
player originale. Non usa sessioni browser per scegliere il destinatario.

## Letture, eventi e griglia

`getContractSettings`, `getPrizeCatalog`, `getPlayerState`, `getGame`,
`getGameStatus`, `getActiveGameIds`, inventari ERC20/ERC1155, `owner`, `hasRole`
e trasferimenti owner pendenti sono letti via RPC lato server. URL RPC e chiavi
non vengono passati al browser.

La griglia del contratto è **row-major**: indice `riga * 5 + colonna`. L'iPad
converte nell'ordine dei suoi cinque rulli. Le tre linee sono:

```text
[ 5,  6, 7,  8,  9]
[ 0,  1, 7, 13, 14]
[10, 11, 7,  3,  4]
```

Vengono evidenziate le prime `matchCount` celle della `winningLine`. Per ERC20
un 3/5 paga metà importo 5/5; per ERC1155 e free spin la quantità è intera.
Il risultato non viene ricostruito casualmente dal client né anticipato con
`previewPendingResult`. Gli importi viaggiano come stringhe di interi, senza
float per i calcoli monetari.

`PrizePaid` conserva token, token ID, tipo e quantità realmente pagati. Lo
storico non usa il catalogo corrente per calcolare premi passati. Per ERC20
la formattazione legge `symbol` e `decimals`; se il token non li espone, mostra
le unità minime. Le etichette grafiche dei simboli sono definite nell'app e
corrispondono agli ID del design del contratto, inclusi placeholder 12–15.

Gli eventi di un reveal si cercano solo fra target e deadline (massimo 256
blocchi). L'ultima giocata del player si recupera da `SpinStarted`, con pagine
di 2000 blocchi, fino a 12 pagine per richiesta e ripresa alle letture successive.
La cache verifica il block hash e rilegge un margine di 12 blocchi. Per wallet
senza storico su un contratto molto vecchio la prima sincronizzazione richiede
più polling; le nuove giocate restano bloccate fino al completamento. L'admin
sfoglia gli ID globali in pagine da 20. Non serve un indexer persistente.

## Comandi admin

La console legge i ruoli reali. Il backend prepara calldata da una lista chiusa
di azioni, verifica gli input e simula usando l'indirizzo embedded ricavato dal
JWT Privy. Il browser mostra la transazione da confermare, incluse le commissioni.
Il backend conserva la richiesta immutabile, ricontrolla ruoli e parametri e
inoltra l'invio a Privy usando l'identity token in `authorization_context.user_jwts`,
verificato contro l'account dell'access token: firma il wallet admin condiviso,
senza usare la chiave del keeper o il signer dell'iPad. Il contratto
applica nuovamente ruoli e precondizioni al mining.

- Pausa/riattivazione (`PAUSER_ROLE`).
- Prezzo, tempi, probabilità, premi, assegnazione/saldo free spin (`GAME_MANAGER_ROLE`).
- Prelievi ERC20/ERC1155/ETH (`TREASURER_ROLE`, pausa e zero round pendenti).
- Ruoli e trasferimento amministrazione con ritardo (owner).
- Deposito dei token già configurati tramite `transfer` / `safeTransferFrom`.

L'owner può eseguire le operazioni dei ruoli. `startFreeSpin` e `revealRound`
sono esclusi dalla lista delle transazioni admin: li gestisce il backend.
Nessun endpoint permette di far firmare calldata arbitrarie all'EOA backend.

Prezzo, catalogo e tempi sono modificabili soltanto senza round pendenti.
Almeno tre simboli devono essere configurati e i pesi devono sommare a 1000.
Un peso vale 0,1%. I form dichiarano le unità minime richieste: per USDC,
1 USDC = 1000000. Il token di pagamento non può essere un premio ERC20.

## Keeper senza database

Il servizio parte con l'instrumentation Node del server Next. Ogni ciclo legge
`getActiveGameIds` in pagine di 100 a un blocco fisso, poi serve i round per
deadline. Le transazioni backend condividono una coda e uno stream di nonce.
L'hash viene calcolato prima dell'invio: se la risposta RPC si perde, viene
ritrasmessa la stessa transazione firmata. Un nonce pendente impedisce nuove
scritture backend fino alla sua risoluzione. Non viene effettuato fee bump
automatico; l'admin vede l'hash pendente e gli errori del servizio.

Le richieste player usano un lock per wallet e una chiave idempotente derivata
da rete, contratto, player e ultima giocata osservata. Click duplicati e passaggi
paid/free per la stessa richiesta non producono due biglietti. La chiave viene
passata anche a Privy. Un esito ambiguo resta in verifica; non viene presentato
come un fallimento certo che autorizza immediatamente un altro invio. Lo stato
onchain prevale sui record temporanei delle richieste.

Dopo un riavvio si perdono pairing e chiavi temporanee, ma il keeper recupera
le giocate attive dal contratto. Se `block > revealDeadline`, chiama `expireRound`:
libera le riserve e invalida la giocata. **Il contratto non rimborsa il biglietto
scaduto**; la UI lo comunica. Il keeper deve quindi restare acceso e finanziato.

Richiesti una sola replica Railway sempre attiva e una EOA dedicata, non usata
da altri processi. Un database distribuito servirebbe solo passando a più
repliche o introducendo servizi che richiedono coordinamento persistente.

## Configurazione da fornire dopo il deploy

```dotenv
SLOT_CONTRACT_ADDRESS=
SLOT_DEPLOYMENT_BLOCK=
SLOT_BACKEND_PRIVATE_KEY=
BASE_RPC_URL=https://mainnet.base.org
PRIVY_GAS_MODE=usdc
ADMIN_OWNER_USER_ID=
```

La private key è `0x` + 64 caratteri esadecimali, esclusivamente server-side.
Il token di pagamento deve essere USDC nativo Base. Dare il ruolo manager al
backend per i free spin; il reveal è permissionless. L'admin Privy deve essere
owner o ricevere i ruoli necessari. Finanziare ETH backend e riserve premi.

Configurare **User pays → USDC su Base** nel dashboard Privy. La modalità
predefinita richiede gas in USDC al wallet Privy e passa a ETH soltanto dopo un
rifiuto certo per saldo insufficiente, prima della submission. Il consenso sul
telefono e la conferma admin includono questa scelta; il gas è aggiuntivo al
budget. `PRIVY_GAS_MODE=eth` forza ETH. Il wallet backend rimane una EOA normale
con gas ETH a proprio carico. La prova di `personal_sign` non consuma gas.
Vedi [gas.md](gas.md) per invio, deduplicazione e limiti del recupero.

L'approvazione budget è limitata e non infinita. Logout revoca il signer, non
l'allowance onchain; si può azzerare dal telefono. Una nuova visita richiede un
nuovo consenso. `startSpin()` usa il prezzo vigente al mining e non accetta un
parametro `maxPrice`: l'app verifica prima dell'invio e limita l'esposizione con
l'allowance, ma non promette un prezzo bloccato atomicamente fra UI e mining.

## Collaudo

`npm run test:chain` avvia Anvil locale, deploya il bytecode esatto e testa i
percorsi ERC20, ERC1155, free spin, scadenza, ruoli e ripartenza keeper. Le chiavi
Anvil pubbliche sono confinate ai test; i fixture non sono importati dall'app.
`npm run test:browser` verifica le fasi visuali con snapshot controllati.
Il deploy reale e le nuove transazioni Privy su Base restano da collaudare dopo
aver fornito la configurazione: non sono stati spesi fondi reali.
