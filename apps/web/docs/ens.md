# ENSv2 voucher redemption

The phone wallet can redeem one existing Base `SlotPrize1155` ENS Registration
voucher (token ID 2) for a name under `wallstreetslot.eth` on **Ethereum Sepolia**.
The parent name and Sepolia transactions use the existing backend EOA
`0x8e251547f0fD650e0573711EF733F13eBA1505aD`, configured through
`SLOT_BACKEND_PRIVATE_KEY`. The shared Privy admin wallet is not used.
The player's personal Privy wallet receives ownership of the subname.

## Deployment status

The implementation is opt-in. Empty `ENS_REGISTRAR_ADDRESS` disables the feature.
No live ENS deployment is implied by committing the code. Record the actual
addresses, source commit, transaction hashes and deployment blocks after setup.
ENSv2 is beta software; this integration pins the official Sepolia deployment
from `ensdomains/contracts-v2` commit
`97a57293f3b4279d94b571e678edb53ce62638f4` in `lib/ens/upstream.json`.

## Voucher semantics and costs

The deployed prize collection has no burn function and is not upgradeable.
`ENSVoucherRedemption` therefore **permanently locks** one existing token. It has
no withdrawal, upgrade or owner-controlled rescue path. Do not describe this as
an ERC1155 burn. A true burn would require a new voucher collection and a
separate migration decision; existing slot prizes and their collection remain
unchanged by this integration.

The user explicitly authorizes a Base `safeTransferFrom` with the existing Privy
request-signing flow. Base gas is still paid by the player in USDC with ETH
fallback, or ETH according to `PRIVY_GAS_MODE`. Sepolia transactions are paid by
the backend and require no Sepolia balance or network switch from the player.

## Flow and trust boundaries

1. Authenticate the phone's Privy access token and select its personal wallet.
2. Check a label (3–32 ASCII letters/digits/hyphens, no leading/trailing hyphen).
3. After confirmation, the backend reserves a claim on `SlotENSRegistrar`.
   One unfinished claim per wallet is allowed by the API. Names cannot be
   changed after reservation, and reservations do not expire automatically.
4. Review the exact name, one voucher, recipient wallet, permanent consumption
   and Base fee currency. The backend signs a short-lived reservation permit
   binding Base chain ID, redemption contract, collection, token ID, claim,
   label and player. This signature grants no wallet access.
5. The player authorizes the exact Privy request bytes. The Base contract
   validates the permit and records `consumptions(claimId)` atomically with
   receiving one voucher. Other collections, quantities, batches, expired
   permits and replayed claims revert.
6. Wait for **Base finalized state**, then verify the consumption again at that
   finalized block. This may take several minutes. No new voucher is needed.
7. The backend worker automatically attests that finalized
   consumption to the Sepolia registrar, even if the phone is closed. The phone
   also offers **Register name · Free** as an explicit retry. It creates an actual ENSv2 name, a
   per-name PermissionedResolver proxy, the address record, and gives the
   resolver roles to the player while revoking its own roles. This Sepolia
   transaction is atomic and consumes the source identifier only once.

This is a trusted backend relay, not a trustless bridge. Sepolia cannot read
Base state by itself. The backend can attest source consumption and retains
administrative control of the parent registry. A player owns their subname and
its resolver, but continued namespace availability depends on the parent name,
its renewal and the administrator's registry configuration.

## Recovery and coordination

Claims, voucher consumption, names and resolver permissions are persistent
onchain state. A service restart after voucher consumption can reconstruct the
claim without a database and complete it without consuming another token.
Failed Sepolia registration rolls back source consumption in the registrar.
Its reserve/fulfill calls are idempotent and reject changed beneficiaries or
reused source identifiers.

The in-process worker scans finalized Base consumption events in bounded pages,
retries pending claims, and rebuilds from the deployment block after restart.
Completed claims are skipped through onchain state.

Run one existing always-on service replica. ENS has one serialized Sepolia
sender. It preserves the exact signed transaction on ambiguous submission,
checks pending nonces, and does not create a second transaction automatically.
The Base voucher review uses the same address-keyed write coordinator as player
spins/transfers. Polling does not extend a paired iPad session.

Privy requests awaiting submission remain in memory, like the existing wallet
flow. If the service restarts before returning a transaction reference and the
voucher has not appeared onchain, manually reconcile that request in Privy
before retrying. The phone deliberately retains its pending marker rather than
silently sending again. This limit does not affect recovery of a voucher already
recorded on Base. Do not clear pending markers merely because an RPC timed out.

Labels/names are indexed in bounded registry event pages and ownership is checked
against current registry state, including transfers. Stable label hashes are
used instead of mutable ENSv2 token IDs. The UI lists this namespace, not every
name on Sepolia; primary/reverse names are not changed automatically. RPC errors
are reported as unavailable, never as a verified empty balance.

## Setup

Obtain explicit authorization before live transactions and follow repository
branch/PR rules. Do not deploy the web service from a work branch.

From `apps/web`:

```sh
node scripts/build-ens-artifacts.mjs
npm run ens:inspect
npm run ens:setup
```

`ens:inspect` is read-only and works without a private key. `ens:setup` requires
the existing backend key, rejects another wallet, checks chain ID 11155111, and
uses the public RPC `https://ethereum-sepolia-rpc.publicnode.com` by default.
Prefer running the operator script where the sealed key already exists.
Do not print/copy that key into shell arguments, logs or committed files.

The script registers the parent through ENSv2's commit/reveal registrar for one
year, minting only the needed MockUSDC test payment token. When the commitment
needs to mature, it returns a public `resumeAfter` timestamp; resume after it.
It then creates and connects a UserRegistry, sets the parent address record,
deploys `SlotENSRegistrar`, and grants only its registry registrar role.

Record emitted public addresses immediately. Set `ENS_SUBREGISTRY_ADDRESS`,
`ENS_PARENT_RESOLVER` (operator recovery only) and `ENS_REGISTRAR_ADDRESS` when
resuming setup after their deployment. Unknown transaction outcomes require
receipt reconciliation before rerunning. Setup never starts another Base keeper.

Deploy `ENSVoucherRedemption(existingCollection, existingBackend)` on Base only
within an authorized, coordinated maintenance window. The live Base keeper and
an operator script must not race to allocate the same EOA nonce. The slot itself
and its prize configuration do not need modification for permanent-lock
redemption. Configure the new Base contract and its deployment block explicitly.

Set the variables from `.env.example` after both deployments:

- `SEPOLIA_RPC_URL`
- `ENS_REGISTRAR_ADDRESS`, `ENS_SUBREGISTRY_ADDRESS`, `ENS_DEPLOYMENT_BLOCK`
- `ENS_REDEMPTION_ADDRESS`, `ENS_REDEMPTION_BLOCK`

Do not replace the sealed `SLOT_BACKEND_PRIVATE_KEY`. UserRegistry and parent
ownership, deployment addresses, resolver permissions and source collection
must match before enabling redemption. The API refuses voucher consumption
within an hour of configured expiry, when it exceeds parent expiry, or when the
parent has changed owners. After renewing the parent, the operator can extend
future registration expiry via `SlotENSRegistrar.extendExpiry`; existing names
need renewal through the registry separately.

## Validation

```sh
npm test
npm run build
npm run test:chain
npm run test:ens:browser
forge test --root ../../contracts
forge test --root ../../contracts --match-contract SlotENSForkTest \
  --fork-url https://ethereum-sepolia-rpc.publicnode.com
```

The fork test uses actual ENSv2 factory, registry and resolver contracts with
local state changes only. It is skipped in ordinary non-fork Foundry runs.
Tests do not consume a real player's voucher or sign through live Privy.

Sources: [ENSv2 deployments](https://docs.ens.domains/learn/deployments/),
[subname registrars](https://docs.ens.domains/ensv2/tutorial-contract-developers/),
[resolver permissions](https://docs.ens.domains/ensv2/permissioned-resolver/),
[indexing](https://docs.ens.domains/ensv2/indexing/).
