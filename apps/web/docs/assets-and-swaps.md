# Supported assets and admin swaps

All assets are on Base mainnet (8453). Metadata was read onchain on 2026-09-11. The
five equity tokens have **8 decimals**, DGLD has **18**. USDC has **6**. The application
checks token decimals when reading inventory and disables deposits if metadata cannot
be verified. Token amounts use integer arithmetic; excess decimals are rejected, never rounded.

| Contract symbol ID | Display | Token | Decimals | Address |
| --- | --- | --- | --- | --- |
| 2 | NVIDIA | NVDAc | 8 | `0xb20000000000000000000078ee7ce2fE4908108C` |
| 4 | SpaceX | SPCXc | 8 | `0xb2000000000000000000007b9fcbd005511aCBd5` |
| 5 | Apple | AAPLc | 8 | `0xb200000000000000000000C2e324d24d7eEcd1fb` |
| 6 | Alphabet | GOOGLc | 8 | `0xb2000000000000000000002D0BA3164cc74f58B7` |
| 7 | Amazon | AMZNc | 8 | `0xb200000000000000000000d9192b6B456483C2E8` |
| 11 | Gold | DGLD | 18 | `0xe908475f8beb7a138b0dc6eb5a05cb27068ffb9a` |

NFT placeholders keep the existing contract IDs: 0 magnet, 3 gadget, 8
ENS_REGISTRATION, 9 URBE_HUB_DAY_PASS, 10 shirt. NFT token addresses and token IDs
are read from the deployed catalog. Placeholder artwork does not imply a mock NFT
balance. ID 1 is free spin, read from `freeSpins(wallet)`; it has no token contract.

`lib/assets.ts` is the app catalog. The terminal's ES5 labels and bundled artwork
use the same stable IDs. `scripts/build-prize-symbols.mjs` regenerates the 12 tile SVGs
from downloaded local brand assets and code-drawn placeholders. The initial idle grid,
reveal results, admin inventory and prize cards use these tiles.

## Contract funding

The reference `foundry-slot` contract has no dedicated ERC20 deposit function.
The app's `fundERC20` action calls **ERC20.transfer(slotAddress, amount)**. `fundERC1155`
calls **ERC1155.safeTransferFrom(adminWallet, slotAddress, id, amount, '0x')**.
Both already undergo simulation, explicit review, Privy authorization and receipt
tracking. No approval transaction is needed for a plain ERC20 deposit.

After deployment, configure each prize with its ID and address above using
`configurePrize`; choose prize amounts and retain the desired weights. The Inventory
button requires a matching ID/address in the onchain catalog. An address mismatch
never gets displayed as a reserve for the supported token. Contract ABI changes are
not needed. Swap and inventory reads work before slot deployment; funding requires it.

## LI.FI API and Privy setup

- Enable Privy **User pays → Base → USDC**. The app sends `sponsor: true` and
  `sponsor_options: {asset: 'usdc'}` for approval and swap. Only an explicit
  insufficient-token rejection before submission enables ETH fallback. Trade and
  app gas credits are not required by this LI.FI integration.
- Keep **Return user data in an identity token** enabled. The access token authenticates
  the account; a separately verified identity token authorizes its wallet request.
- Keep `ADMIN_OWNER_USER_ID` set and create the shared wallet from that account.
- `LIFI_API_KEY` is optional and server-only. Public quotes work without it, subject
  to LI.FI rate limits. The API host is fixed to `https://li.quest`.

Both admins can select USDC (6 decimals) or native ETH (18 decimals) as input, with
one of the six RWA tokens as output. Both balances appear on Swap; Inventory also
shows a native ETH card. Native ETH is not passed to ERC20 balance or deposit calls.
All funds and resulting tokens belong to the shared wallet.

The server requests same-chain Base quotes with the shared address as both source
and recipient and 0.5% slippage. It validates metadata AND decodes the transaction:
router, function, recipient, input token/budget, output token, minimum output, native
value, canonical calldata, and swap-array deposit amounts/token continuity. Supported
calls are GenericSwapFacetV3 single/multiple ERC20ToERC20 and NativeToERC20. Unknown
selectors/bridges fail closed. LI.FI's router enforces its DEX/selector allowlist and
minimum output; nested DEX-specific calldata is not fully decoded by this app.
Browser-supplied transaction payloads, arbitrary recipients or arbitrary tokens
are never forwarded. These are protocol trust boundaries, not a general router proxy.

Quotes expire after 30 seconds. A fresh quote before the swap must meet or improve
the reviewed minimum; its minimum is encoded in the transaction itself. The UI
shows included LI.FI fees and the ETH gas estimate separately. This estimate is not
Privy's final USDC gas charge. Sufficient funds must remain for input plus fees.

When USDC allowance is insufficient, the first confirmed operation approves exactly
the input amount to LI.FI. After its receipt, the UI shows **USDC autorizzati**, and
the user requests a new quote and explicitly confirms the swap. Approval alone is
never reported as token acquisition. ETH input skips approval. No automatic deposit
follows: use Inventory's existing reviewed funding action.

## Shared wallet permissions

The owner and authorized collaborators execute using their own verified identity
JWTs and the same wallet ID. No co-owner access, shared private key, or backend keeper
key is needed. The owner updates existing collaborators through **Wallet admin →
Aggiorna permessi**. This attaches the new owner-controlled LI.FI policy. New members
receive it immediately, including before slot deployment.

Older exact policies remain recognized for visibility/signature proof and any
previously granted contract operations. They do not silently gain swap permission.
The new policy restricts Base, LI.FI router/function, recipient, native value type,
and USDC approval spender. Input/output selection and reviewed amount constraints
are enforced additionally by the backend. The policy does not itself constrain every
nested DEX field or define a cumulative spending limit. Other owner-only controls
remain excluded. Revocation is checked again before each send and gas fallback.

## Recovery and no database

One process coordinator prevents concurrent admin contract writes and swaps. A
confirmed approval releases the lock; the later swap is a separate confirmed
operation. Duplicate confirms cannot resend an operation. Pending records contain
no credentials, and quotes/terminal records expire from memory.

Session storage saves public operation IDs and any returned Privy transaction ID or
chain hash. A response containing only `user_operation_hash` is also supported:
its sender/hash are matched against UserOperationEvent logs at the canonical
EntryPoints (v0.6–v0.9). A bounded block cursor is retained for polling and refresh.
The backend tracks Privy transaction status, then the chain receipt and the
individual operation success flag; a successful bundle may contain a failed operation.
Only the matching `LiFiGenericSwapCompleted` event establishes actual received output;
an approval receipt and a Privy accepted/pending response are not swap success.

Recovery after restart is read-only. Privy transaction IDs must belong to the shared
wallet and Base; direct hashes must be from the wallet. If the process restarts after
submission but before returning a reference, the UI blocks and asks for manual
verification in Privy/BaseScan. It never automatically repeats an ambiguous send.
There is no durable cross-process pending-operation ledger: run one replica and
reconcile pending writes before restarting/upgrading. Multiple replicas or guaranteed
recovery across every crash require durable coordination.

## Validation

- `npm test`: both roles, legacy permission migration, native value preservation,
  USDC gas/fallback, approval-vs-swap status, immutable inputs, malformed quotes,
  duplicate confirms, revocation, expiry, price changes, receipt and wallet scope.
- `node scripts/check-assets-ui.mjs`: real components with mocked network/Privy;
  USDC approval then swap, collaborator ETH swap, eight balances, images, iPad
  layout, native input precision and separate reviewed contract deposit.
- `npm run test:browser`: terminal/phone regression.
- `node --import tsx scripts/check-lifi-quotes.ts`: live read-only quotes through
  the production validator; all 12 USDC/ETH-to-RWA pairs passed.
- Privy accepted and returned matching policies both without a slot (six rules)
  and with the slot configured (nine rules). The existing ERC20 funding rule was
  corrected to use an ABI whose recipient argument matches its condition. The temporary policy was never attached and was deleted immediately.
- `npm run build`: production build and typecheck.

No real funds were spent during implementation. A funded swap signed by the actual
collaborator remains a live acceptance check, including Privy gas settlement.

References: [LI.FI quotes](https://docs.li.fi/api-reference/get-a-quote-for-a-token-transfer),
[LI.FI router](https://docs.li.fi/introduction/lifi-architecture/smart-contract-addresses),
[Privy gas](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup),
[Privy policies](https://docs.privy.io/controls/policies/overview).
