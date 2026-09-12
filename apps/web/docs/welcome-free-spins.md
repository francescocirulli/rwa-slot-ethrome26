# Welcome free spins

A player's first embedded Ethereum wallet receives **two free-spin credits**
automatically after it is created and paired through the phone flow. The backend
EOA pays the Base ETH gas. The player does not need ETH, USDC, a budget approval
or a transaction signature to receive or use these credits.

## Eligibility and trigger

- The server verifies the Privy access token and obtains the embedded wallet
  from the authenticated account. Client-supplied addresses, amounts and
  creation flags cannot select the recipient or change the award.
- Only the account's embedded Ethereum wallet at `wallet_index == 0` qualifies.
  Its address and creation timestamp are checked against Privy's wallet API;
  imported, archived, ambiguous or unverifiable wallets are excluded.
- The contract's configured deployment block supplies a durable launch cutoff.
  The wallet must have been created at or after that block's timestamp. Existing
  wallets created before deployment do not receive an automatic welcome bonus;
  an admin can still grant them promotional credits through `grantFreeSpins`.
- Successful pairing automatically requests the bonus. The phone retries
  `POST /api/relay/phone/welcome` while verification or crediting is pending.
  The endpoint requires the phone session, its authenticated owner and the
  normal origin/header checks. It does not renew the three-minute idle timer.
- Signing in to the admin panel does not trigger a player welcome grant.

## Contract and keeper

`grantWelcomeFreeSpins(player)` requires the owner or `GAME_MANAGER_ROLE` and
adds the fixed `WELCOME_FREE_SPINS` amount of 2 to `freeSpins[player]`.
It records `welcomeFreeSpinsGranted[player]` permanently and emits both
`FreeSpinsGranted` and `WelcomeFreeSpinsGranted`. A second call reverts with
`WelcomeFreeSpinsAlreadyGranted`, including after credits have been spent or
reset through the admin panel. Existing promotional or won credits are preserved.
This is once per wallet on this contract, not proof of a unique person across accounts.

Welcome grants share the keeper's queue and nonce stream with free-spin starts,
reveals and expiry. Reveals take priority. The keeper calculates the transaction
hash before broadcasting and only rebroadcasts identical signed bytes after an
ambiguous response. Missing roles, insufficient keeper ETH or a temporary RPC
failure leave the bonus pending and eligible for retry.

The grant flag and balance are stored onchain; no database is required. A
restart cannot grant another bonus after the first one was recorded. Unsent
requests are in memory: if the process stops before broadcasting, the player
must reconnect so the authenticated request can be recreated. A new contract
has its own independent grant records. Run one always-on replica and do not
share the keeper EOA with another process.

## Player display

The main iPad screen shows a large free-spin balance above the reels, separate
from USDC. Available credits highlight the free-spin button, and the lever uses
free credits before paid spins. The pending welcome message does not increase
the displayed balance: only the contract read does. The counter follows spending
and rewards, shows an unavailable balance while offline, and clears on logout
or a change of player. The phone explains that available free spins need no
USDC approval.

## Deployment and validation

Deploy the updated contract and configure its exact address and deployment
block. Grant `GAME_MANAGER_ROLE` to the backend EOA and fund it with ETH on Base.
No additional Privy dashboard option or secret is required. The disabled
backend-key placeholder and an unset contract continue to support login, but
cannot award credits. The bonus is not live until the updated contract and
keeper are configured.

The original Base deployment at `0xc0253B67E835500aC9a69214fa4F2Bbce61CA72c`
does **not** include welcome credits and is not upgradeable. The app reports the
bonus as `unsupported`, stops automatic phone retries for it, and leaves regular
wallet, balance, admin and spin operations available. It never substitutes a
repeatable `grantFreeSpins` call for the once-only grant. Deploying the updated
contract is a separate release operation; merging app code does not enable the
bonus on the old address.

The ABI and app test bytecode are regenerated from the Foundry build. Tests
cover contract permissions, additive accounting, duplicate grants, verified
wallet eligibility, authenticated recovery, unchanged idle deadlines, keeper
submission and restart recovery on Anvil, and pending/available/empty/offline
counter states at iPad sizes. A pinned fixture from the original deployment is
also exercised on Anvil to verify reads, manual credits, free-spin starts and
reveals without attempting welcome writes. These checks do not send real Base transactions.
