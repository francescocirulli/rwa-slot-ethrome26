# Contract rules

Read [../AGENTS.md](../AGENTS.md) first. Its branch, PR, attribution and secret
rules apply here. Protocol behavior and deployment setup are in [README.md](README.md).

## Implementation

- Use Foundry and the Solidity version/optimizer settings in `foundry.toml`.
  Initialize pinned dependencies with `git submodule update --init --recursive`
  from the repo root. Do not edit upstream code under `lib/`.
- Preserve stable symbol IDs, row-major 3×5 grid ordering and documented paylines.
  Changes to prize weights, reserves, transfers, roles or reveal timing require
  focused contract tests and corresponding frontend review.
- Preserve the two-stage round lifecycle and permission boundaries. Player
  Privy wallets pay for paid spins; the dedicated backend EOA reveals rounds
  and starts authorized free spins; the shared admin wallet manages the contract.
- Reads and events must provide enough state to recover after a restart without
  a database. Include frontend consumers when changing an event, getter or error.
- Do not treat passing tests as a security audit or change the randomness model
  implicitly. Document the tradeoff when changing economic or security behavior.

## Validation and artifacts

From this directory run `forge build` and `forge test`; from the repo root use
`npm run build:contracts` and `npm run test:contracts`.

For public interface changes, regenerate `abi/DigitalSlotMachine.json` from the
compiled artifact, update `../apps/web/lib/slot/abi.ts` and the app's contract
test fixtures/source hash, then run `npm run test:chain` from the repo root.
Keep `.sol` sources authoritative; never hand-edit compiled bytecode.

Only use disposable local accounts for Anvil tests. Never run a deployment
script with `--broadcast`, assign live roles, fund a contract or send a live
transaction without explicit authorization for that operation. Local `.env`,
`out/`, `cache/` and `broadcast/` are not versioned.
