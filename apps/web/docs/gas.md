# Gas pagato dal wallet

`PRIVY_GAS_MODE=usdc` è il default. Nel dashboard Privy devono essere attivi
**User pays**, rete **Base**, asset **USDC**. L'app invia
`sponsor: true, sponsor_options: {asset: 'usdc'}` tramite Node SDK: in questa
modalità l'addebito è al wallet dell'utente, non ai crediti gas dell'app.
Privy gestisce l'approvazione al paymaster nella transazione. L'approvazione
`USDC.approve(slot, budget)` resta distinta e limita solo le giocate.

Il SDK React installato non espone `sponsor_options`. Le operazioni approvate
dal telefono e dall'admin passano quindi dalle API del server. L'access token
Privy autentica la richiesta; un identity token verificato per lo stesso user ID
autorizza il **suo** wallet (personale o admin condiviso) con `user_jwts`.
Abilitare **Return user data in an identity token** nel dashboard Privy,
User management → Authentication → Advanced, e accedere di nuovo. I token
non vengono conservati nelle richieste pendenti e non compaiono nei log.
Il signer P-256 della sessione iPad resta limitato a `startSpin()`.

## Fallback

1. Richiesta con gas USDC e chiave idempotente stabile per operazione/valuta.
2. Soltanto un errore Privy HTTP 400 riconosciuto come saldo insufficiente,
   senza riferimenti a una transazione già inviata, permette un tentativo ETH
   sullo stesso wallet: `sponsor: false`, senza `sponsor_options`.
3. Errori di rete, 5xx, policy, configurazione, revert o errori sconosciuti non
   fanno scattare il fallback. Se anche ETH è insufficiente, la UI chiede una
   ricarica. Non si cambia valuta dopo una submission accettata.

Il riconoscimento fallisce in modo conservativo: se Privy cambia il formato
del rifiuto, la richiesta non passa automaticamente a ETH. Non è sufficiente
guardare `balanceOf`: gli USDC devono coprire insieme operazione e commissioni.
`PRIVY_GAS_MODE=eth` disabilita la prima richiesta e usa direttamente ETH.

Il consenso specifica che le commissioni si aggiungono al budget/importo.
Non viene mostrato un preventivo numerico vincolante: è Privy a calcolare
il gas al momento dell'invio. Il wallet backend per reveal, scadenze e free
spin paga sempre in ETH, a carico dell'operatore.

## Conferme e recupero senza database

`POST /api/contract/prepare` simula un'azione ammessa, con il vero sender e
gas price zero per non respingere i wallet senza ETH. Non firma e non invia.
La richiesta è vincolata a utente, wallet, calldata e modalità gas, scade dopo
5 minuti e deve essere confermata nella UI. `POST /send` richiede il suo ID
e `confirm: true`; richieste concorrenti condividono un solo invio. `POST
/cancel` annulla soltanto richieste ancora non inviate. `/status` richiede
l'autenticazione dello stesso proprietario.

Privy può restituire un `transaction_id` prima dell'hash. Il backend lo segue
fino alla ricevuta; la UI conserva solo ID pubblico e, appena disponibile,
hash in sessionStorage. Un refresh non ripete l'invio. Due conferme onchain
concludono l'operazione. Il polling non prolunga la sessione dell'iPad.

Le richieste non ancora onchain sono in memoria. Dopo un riavvio, l'hash già
salvato consente la verifica diretta della ricevuta. Se la risposta Privy si
perde senza hash/ID, o il server riparte prima che il browser riceva l'hash,
l'app mantiene il blocco e chiede di verificare il wallet: non promette di
recuperare una submission priva di riferimenti, né reinvia alla cieca.
I reveal delle giocate già registrate continuano a recuperarsi dal contratto.

## Verifica

Test automatici: opzioni SDK, USDC → ETH, errori ambigui, sessione scaduta fra
i tentativi, fondi insufficienti, consenso gas, ownership, calldata immutabile,
click duplicati e stato pending. Anvil verifica la simulazione senza ETH.
Il browser test manuale usa un wallet Privy vuoto e intercetta le scritture
per verificare conferma, annullamento e refresh.

**L'addebito reale USDC e il fallback ETH su Base richiedono ancora il deploy
del contratto e un collaudo con fondi.** Nessun fondo reale è stato movimentato.

- [Privy: configurazione User pays](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup)
- [Privy: eth_sendTransaction](https://docs.privy.io/api-reference/wallets/ethereum/eth-send-transaction)
- [Privy: autorizzazione con JWT utente](https://docs.privy.io/controls/authorization-keys/keys/create/user/request)
