# Shared admin wallet

Each person signs in to `/admin` with their own Privy account (email OTP or
passkey). A dedicated arcade wallet receives all funding; the same balance
pays for operations and USDC/ETH gas. The player wallet and keeper EOA remain
separate roles: the admin wallet is not offered for iPad pairing.

## Setup

1. The owner signs in to `/admin` and copies their `did:privy:…` account code.
2. Set **`ADMIN_OWNER_USER_ID`** in the server environment. It is not a secret
   credential. Leaving it empty does not automatically make the first visitor
   the owner.
3. The owner selects the action to **create a shared wallet**. The backend
   creates a wallet with a quorum containing only their user ID, threshold 1.
   No shared signing key is created in the environment.
4. The collaborator signs in with their own account, copies their code and
   shares it with the owner. In the admin wallet section, the owner adds them
   and confirms their permissions. The app does not send emails or automatic invites.
5. Both verify their signatures and can fund the shared address/QR code.
6. After deployment, assign onchain roles to the new shared address. The owner
   selects the action to **update permissions** to enable the collaborator on
   the configured contract. Funding, balance, sharing and signature proof are
   available before deployment.

Privy supports creating quorums and signers through its API: no shared key needs
to be created in the dashboard. Enable email/passkeys and **User pays → Base → USDC**
for fees. Identity tokens are not required to authorize the wallet.

The access token verifies identity on app APIs. For each change or signature,
the backend prepares the exact request with the Node SDK; the browser authorizes
it with `useAuthorizationSignature`. The signature returns to the Node SDK through
`sign_fns`. The channel lasts at most 90 seconds, is bound to the account and
endpoint, and can be used by only one operation. Keys stay in the browser's
Privy SDK. Closing the page, switching accounts or rejecting a signature does
not authorize submission. One always-on replica is required, with no database;
after a restart, an interrupted channel requires a new confirmation. Already
submitted operations are checked using their existing references, without resending.

The previous implementation passed an identity token to `user_jwts`:
Privy returned `400 Invalid JWT token provided` from `/v1/wallets/authenticate`
for both signature proof and adding a collaborator. The live test also rejected
an access token; enabling identity tokens did not resolve the issue. Native
browser authorization avoids that exchange and does not change ownership.

## Permissions

The wallet owner approves adding/removing signers through their browser Privy
session, also authenticated on the app APIs. A collaborator has a personal
quorum and an owner-controlled policy. They can manage the slot and fund or
withdraw prizes when the contract permits. Ownership changes, role changes,
role renunciation, player budget approvals and Privy wallet changes are excluded.
The contract-operation policies restrict calls to Base, zero direct ETH value,
allowed admin functions on the configured contract and ERC20/ERC1155 transfers
directed to the slot. Swap-specific permissions are described below.

The shared address holds onchain ownership: the app and Privy policy enforce
collaborator limits. The contract alone cannot distinguish which person uses
the wallet. Events record the shared address.

For each private read and submission, the app rechecks the wallet, owner,
quorum and policy on Privy. Revocation prevents new submissions, including an
ETH fallback that has not started. Transactions already submitted are not cancelled.

Confirmations are bound to the user who prepared the operation. Other admins
can follow its status but cannot confirm it on their behalf. A shared wallet
lock prevents concurrent submissions by both people. Recovery limits when no
hash is available remain as described in [gas.md](gas.md).

## Persistence and testing

The wallet is located by `ADMIN_WALLET_EXTERNAL_ID`. If the variable is empty
or absent, the external ID remains `lucky_signal_shared_admin_v1`, preserving
existing wallets. Members are read from Privy signers/quorums. A restart does
not lose funding or access. One server replica is still required to coordinate
writes. No database has been added.

### Changing accounts after a trial

Registering again with a new passkey can create another Privy account. The login
account is separate from the shared wallet, which has an owner recorded in Privy.
Changing `ADMIN_OWNER_USER_ID` does not transfer that ownership: the app blocks
access if the two owners differ. Newest users are not automatically appointed owners.

To initialize **a new wallet with a new address**, after deciding not to use
the trial wallet:

1. Sign in with the account you intend to keep and set its `did:privy:…` in
   `ADMIN_OWNER_USER_ID`.
2. Choose a new `ADMIN_WALLET_EXTERNAL_ID`, such as
   `rwa_slot_admin_production_v1`, distinct from identifiers already used in
   this Privy app. Allowed length: 1–128 characters, using letters, digits, `_` and `-`.
3. Restart the service with both variables. The owner signs in to `/admin` and
   confirms the action to **create a shared wallet**. The initial quorum contains
   only their account. No other user can create it.
4. The collaborator signs in with their own account and shares their code;
   the owner adds them from the app. Both use the new wallet address, with
   shared funding and separate permissions.

Keep this external ID when adding collaborators or updating the app. The old
wallet, its access and its funds remain intact; they are not transferred to the
new wallet. Update funding addresses and onchain roles separately. Keeping the
old address instead requires a transfer authorized by its current Privy owner,
not an external ID change.

### Validation

`npm test` covers ownership, no implicit access, distinct users with a shared
balance/QR code, policies, revocation, player/admin scope, confirmations and
simultaneous requests. For the manual test with real Privy and two accounts, run:

```sh
LIVE_CHECK_ORIGIN=https://your-domain.example node scripts/live-admin-check.mjs
```

The script loads `.env.local` without printing it and uses a random test external
ID, never the operational wallet's ID. It creates two accounts and an empty wallet,
signs benign messages and revokes collaborator access at the end. Transactions
remain intercepted. Evidence is saved in `artifacts/live-shared-admin-check.json`.
It neither adds funds nor deploys contracts.

The check must complete member addition, signatures by both people and revocation
against the real provider: successful login or a mocked-provider test does not
prove that Privy accepts wallet authorization.

The 2026-09-12 check completed against the local build: two independent passkey
registrations, an empty shared wallet, collaborator addition, verified signatures
from both users for the same address, persistence after service restart and
revocation. UI recovery after a lost response was also verified; onchain
submissions and gas payment remain simulated. The script creates test accounts
in the Privy app: do not use the most recently registered account to infer who
should be `ADMIN_OWNER_USER_ID`.

- [Privy: owners and signers](https://docs.privy.io/controls/authorization-keys/owners/overview)
- [Privy: quorums with user IDs](https://docs.privy.io/api-reference/key-quorums/create)
- [Privy: native request authorization](https://docs.privy.io/controls/authorization-keys/using-owners/sign/utility-functions)
- [Privy: Ethereum policies](https://docs.privy.io/controls/policies/example-policies/ethereum)

### Swap capability

LI.FI API swaps support both owner and collaborators, with USDC or native ETH input.
Existing members need the owner to **update permissions**. The new policy grants
constrained `eth_sendTransaction` approval/router calls, including before slot deploy;
old exact policies retain their previous capabilities until explicitly upgraded.
Gas uses the shared USDC balance with ETH fallback after a definitive rejection.
See [asset and swap integration](assets-and-swaps.md) for boundaries and recovery.

### ERC1155 mint capability

The owner can explicitly update collaborator permissions to enable minting existing
IDs from the configured prize collection to the shared wallet or slot. Previous
exact policies continue to allow their existing operations without gaining mint.
The shared address must also be the collection's onchain owner. Only the wallet
owner account can accept a pending collection ownership transfer through the app.
See [inventory and minting](assets-and-swaps.md#inventory-and-erc1155-minting).
