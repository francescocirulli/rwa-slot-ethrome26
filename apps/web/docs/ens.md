# ENSv2 voucher redemption

The phone wallet redeems one existing Base `SlotPrize1155` ENS Registration
voucher (token ID 2) for a name under `wallstreetslot.eth` on **Ethereum Sepolia**.
Parent registration and Sepolia gas use the existing backend EOA
`0x8e251547f0fD650e0573711EF733F13eBA1505aD` through the sealed
`SLOT_BACKEND_PRIVATE_KEY`. The player's personal Privy wallet owns the subname.
The shared Privy admin wallet is not involved.

## Deployment and activation

The parent, UserRegistry, parent resolver and `SlotENSRegistrar` are already
live on Sepolia. Ownership and resolution were verified with the real
`setup-check.wallstreetslot.eth` name. That operator smoke test used a synthetic
attestation, not a real Base voucher. Public addresses, source hashes and the
13 successful setup transactions are recorded in the
[deployment manifest](../../../contracts/deployments/sepolia-ens-v2.json).
ENSv2 beta addresses are pinned to `ensdomains/contracts-v2` commit
`97a57293f3b4279d94b571e678edb53ce62638f4` in `lib/ens/upstream.json`.

**No new Base contract is required.** App releases still follow the existing
single-keeper deployment procedure. Release the app through a PR into `dev`, then a release PR from `dev` into `main`. This work
branch is not authorization to merge or deploy production.

Configure these variables together before activation:

| Variable | Value |
| --- | --- |
| `SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` |
| `ENS_SUBREGISTRY_ADDRESS` | `0x6D9E4b4a02D966D460D5fFBA87fDE09a7Ba34b21` |
| `ENS_REGISTRAR_ADDRESS` | `0x84f6ddfe529d5f38af2a95e38b6a23f9b4cdaa69` |
| `ENS_DEPLOYMENT_BLOCK` | `11691693` |
| `ENS_BASE_FROM_BLOCK` | `51230901` |

These five values are staged on Railway with `--skip-deploys`; production
activation still requires the app release. The sealed backend key is unchanged.

An empty `ENS_REGISTRAR_ADDRESS` disables ENS while keeping login/wallets working.
Set `ENS_BASE_FROM_BLOCK` once and preserve it across restarts and releases:
raising it can hide a player's unfinished transfer. Source scans use
`SLOT_LOG_PAGE_BLOCKS` when set, otherwise 1000 blocks. Scans are bounded and
report catch-up or RPC errors instead of claiming no voucher was transferred.
Do not replace the existing sealed backend key or run a second keeper.

## Voucher semantics and costs

The current ERC1155 collection has no public burn function and rejects transfers
to the zero address. The user instead authorizes a direct `safeTransferFrom`
of one token ID 2 to `0x000000000000000000000000000000000000dEaD`.
This is a conventional discard address, not a burn function or a redemption
contract. The token remains in that address's balance and supply does not shrink.
Treat the transfer as irreversible; the application has no recovery path.

The phone asks for one voucher confirmation. Registration on Sepolia is free
for the player: the existing backend EOA signs, sends and pays for every
reservation and registration. The player needs no Sepolia funds or network switch.
The Base voucher transfer is sent from the player's personal wallet through the
existing Privy flow. Its network fee follows `PRIVY_GAS_MODE`: USDC with ETH
fallback after a definite balance rejection by default, or ETH-only when
configured. The review discloses this Base fee without an extra gas selector.
There is no Privy App Pays requirement and no new funding or wallet delegation.

**Use the phone redemption flow.** Generic/manual transfers to the discard
address do not qualify. The source transaction must carry the exact versioned
payload binding destination chain 11155111, the deployed registrar, claim ID and
label hash. A direct transaction must originate from the authenticated beneficiary. For
Privy ERC4337 transactions, the backend attributes the event to the successful
UserOperation of that beneficiary using the EntryPoint execution boundaries,
sender and nonce. Supported Kernel execution contains exactly one voucher call,
optionally accompanied by a Base USDC gas approval. ERC1155 batch transfers,
operator transfers, arbitrary call batches, other token IDs/quantities, another
collection/registrar, extra calldata and mismatched receipts are rejected.
Invalid transfers can still succeed on the ERC1155 contract and lose the token;
validation of redemption eligibility is performed by this backend, not by Base.

## Flow and trust boundaries

1. Authenticate the phone's Privy access token and personal wallet.
2. Select a 3–32 character ASCII label using letters, digits and internal hyphens.
3. Confirm an onchain reservation on the existing Sepolia registrar. One
   unfinished claim per wallet is allowed by the API; names cannot be changed
   after reservation and reservations do not expire automatically.
4. Review the irreversible Base transfer and authorize the exact Privy request
   bytes. The API rechecks eligibility immediately before wallet submission and
   shares the address-keyed write coordinator with spins/transfers.
5. Find the canonical Base `TransferSingle` event and successful receipt. Check
   transaction sender, target, calldata, collection, event contents and block
   hash. Unfinalized proofs are reread rather than cached across reorgs.
6. Wait for Base **finalized** state and revalidate the proof. The source ID is
   `keccak256(abi.encode(uint256(8453), collection, txHash, uint256(logIndex)))`.
   The transaction payload ties that source to exactly one reservation.
7. The worker calls `SlotENSRegistrar.fulfill(claimId, sourceId)`. Its onchain
   source deduplication prevents reuse. The call atomically registers the name,
   creates its resolver, sets the address record, grants the player resolver
   roles and revokes the registrar's resolver roles. The phone polls until the
   registered name appears; the worker retries without another player action.

The backend is a trusted cross-chain attestor: Sepolia does not independently
verify Base consensus. The backend also controls the parent namespace. The
player owns the subname and resolver, but availability depends on the parent,
its renewal and registry configuration.

## Recovery and operation

A worker in the existing always-on service scans finalized collection events
from `ENS_BASE_FROM_BLOCK`, verifies that proofs match real reservations and
retries incomplete claims even when the phone is closed. A restart reconstructs
proofs and claims from both chains without a database or another token transfer.
Completed claims are skipped. Catch-up runs in bounded batches with a one-second
pause between successful batches, returning to fifteen-second polling when caught
up or after an RPC failure. The worker consumes the verified finalized proof index
instead of fetching its log pages twice. Concurrent lookups for the same claim
share only the in-flight read; new reviews reuse the claim checked during
preparation instead of scanning it twice. Later authorization still rechecks
canonical events.
Pending events survive transient RPC failures by
retrying the same page; unfinalized reorgs cannot authorize Sepolia fulfillment.

ENS has one serialized Sepolia sender which retains the exact signed bytes on
ambiguous submissions. Run one service replica. Player Base submissions use the
existing Privy signing flow and coordinator; polling does not extend pairing.
If a restart loses an ambiguous Privy request before its transaction reference
is returned and no transfer is yet onchain, reconcile it in Privy before
retrying. The phone retains its pending marker rather than silently resending.

Repeated **Continue** requests recover the same unexpired review for that account,
wallet and claim. Concurrent preparation is serialized and retains the shared wallet
lease. A failed or expired pre-submission check releases the lease and returns
`stage: failed`, allowing the phone to clear its pending marker. An ambiguous send
returns `stage: uncertain` and remains blocked, including after reload. Provider
payloads are never exposed: read/preparation errors explain the failed phase instead
of implying that a transfer has been submitted. Retrying preparation never sends a
voucher; the explicit wallet review is still required.

The UI indexes names in this namespace, checks current ownership and displays
forward resolution. It does not enumerate every Sepolia name or automatically
set a primary/reverse name. Provider errors are never displayed as an empty
verified name balance.

The API refuses transfer preparation if parent ownership changes, the configured
expiry exceeds the parent's, or less than an hour remains. Renew the parent and
call `SlotENSRegistrar.extendExpiry` for future registrations; existing child
names need renewal through the registry separately.

## Operator scripts and validation

From `apps/web`, `npm run ens:inspect` checks the parent read-only.
`npm run ens:setup` registers/configures the parent only with explicit live
transaction authorization and the existing backend key. The current deployment
is already complete: when resuming operator setup, pass the existing registrar
and registry addresses, plus `ENS_PARENT_RESOLVER` from the manifest, to avoid
unnecessary deployments. Reconcile public receipts before retrying uncertain
operations. Keep the sealed key where it resides; never export or log it.

`npx tsx scripts/test-ens-live.ts` verifies the existing synthetic smoke name
read-only when `ENS_REGISTRAR_ADDRESS` is set. Its `--apply` mode requires live
transaction authorization and is not a real Base voucher test.

```sh
npm test
npm run build
npm run test:chain
npm run test:ens:chain
npm run test:ens:browser
forge test --root ../../contracts
forge test --root ../../contracts --match-contract SlotENSForkTest \
  --fork-url https://ethereum-sepolia-rpc.publicnode.com
```

The dedicated Anvil test uses the actual collection bytecode to check the zero
address rejection, discard transfer, receipt proof, restart recovery and reorg.
The fork test exercises the actual ENSv2 factory, registry and resolver using
local state changes only. Tests do not consume a real player's voucher or sign
through live Privy. UserOperation proof fixtures cover the Privy Kernel wrapper
and its USDC approval; a live player redemption has not been performed.

Sources: [ENSv2 deployments](https://docs.ens.domains/learn/deployments/),
[subname registrars](https://docs.ens.domains/ensv2/tutorial-contract-developers/),
[resolver permissions](https://docs.ens.domains/ensv2/permissioned-resolver/),
[ERC1155 transfer rules](https://eips.ethereum.org/EIPS/eip-1155),
[Privy gas sponsorship](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview).
