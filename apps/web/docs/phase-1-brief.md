# Wall Street Slot — project status

Arcade for iPad Air in landscape, iOS 12.5.8 / Safari 12.1.2. Brand:
Wall Street Slot, with a retro slot palette (burgundy, cream, brass, enamel red)
and SVG symbols framed as vintage reel tiles.

- Single-page terminal at `/`, HTML/CSS/ES5 without the Privy runtime on the older iPad.
- Embedded wallet login and creation at `/phone`, using a passkey or email OTP.
- Single-use pairing QR, USDC on Base, address and receiving QR, signature proof.
- Logout after 3 minutes of global inactivity; polling and animations do not count.
- Separate `/admin` console with a real Privy wallet and roles read from the contract.
- `DigitalSlotMachine` integration from the `foundry-slot` reference repo: USDC
  spins, limited budget, backend free spins, automatic reveal, prizes and history.
- Animated 3×5 slot during both transaction stages; confirmed onchain result.
- No database. Pairing and temporary keys in memory; games and prizes onchain.
- Railway configured for one always-on replica. Arduino integration is still pending.

The contract is not deployed; Privy credentials are already configured for the
preview. Without a contract address, login and wallets remain available while
the console indicates the missing configuration and does not simulate machine data.

The experimental Privy and Solidity reference repositories were consulted read-only.

For setup, behavior and validation, see the [README](../README.md).
For the ABI, two-stage flow and operations, see [contract integration](contracts.md).
