# Lucky Signal — stato del progetto

Arcade per iPad Air orizzontale, iOS 12.5.8 / Safari 12.1.2. Nome provvisorio
Lucky Signal, stile inchiostro/crema/giallo acido/corallo, simboli SVG.

- Terminale single page a `/`, HTML/CSS/ES5 senza runtime Privy sul vecchio iPad.
- Accesso e creazione wallet embedded da `/phone`, passkey oppure email OTP.
- Pairing QR monouso, USDC su Base, indirizzo e QR ricezione, firma di prova.
- Logout dopo 3 minuti di inattività globale; polling e animazioni non contano.
- Console separata `/admin` con wallet Privy reale e ruoli letti dal contratto.
- Integrazione `DigitalSlotMachine` dalla repo `foundry-slot`: giocate USDC,
  budget limitato, free spin dal backend, reveal automatico, premi e storico.
- Slot 3×5 animata durante entrambe le transazioni; risultato onchain confermato.
- Nessun database. Pairing e chiavi temporanee in memoria, giocate e premi onchain.
- Railway predisposto per una replica sempre attiva. Arduino ancora da collegare.

Il contratto non è deployato; le credenziali Privy sono già configurate per
l'anteprima. Senza indirizzo del contratto, il login e il wallet restano attivi,
mentre la console indica la configurazione mancante e non simula dati macchina.

L'utente ha chiesto di saltare Lazyweb. La repo sperimentale Privy e la repo
Solidity sono state consultate in sola lettura.

Per configurazione, comportamento e verifiche vedere [README](../README.md).
Per ABI, flusso in due tempi e operatività vedere [integrazione contratto](contracts.md).
