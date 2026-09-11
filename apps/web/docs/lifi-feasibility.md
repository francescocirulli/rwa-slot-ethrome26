# LI.FI and the shared admin wallet

Checked on 2026-09-11. This records the initial feasibility assessment. The integration has since been
implemented with USDC and ETH inputs for both admin roles. See
[the current integration](assets-and-swaps.md) for behavior, permissions and validation.

## Conclusion

LI.FI's quote API is compatible with the architecture: obtain an unsigned Base
transaction, validate it on the server, then send it through Privy's existing
`eth_sendTransaction` path using the authenticated admin's identity token.
An additional signer can authorize that method under an owner-controlled policy;
full wallet ownership is not required. Implementation and a funded swap signed
by the collaborator remain necessary to confirm the complete flow.

The API is the recommended integration. The SDK can also prepare quotes, but
its default execution flow would need adapting to the server signing path. The
widget supports Privy/Wagmi and custom providers, but the shared server-created
wallet is not automatically the logged-in user's client-side embedded wallet.
It needs an adapter exposing the shared address and forwarding authenticated
execution to our backend. Its ordinary EIP-7702/native gas handling also needs
review; the generic Privy widget example does not validate our arrangement.

## Checks performed

- Requested live quotes for 10 USDC to each of the six configured assets:
  NVDAc, SPCXc, AAPLc, GOOGLc, AMZNc and DGLD. All six returned HTTP 200.
  Used a dummy source/recipient address; this was not a funded-wallet simulation.
- All sampled quotes used Base (8453), zero native value, and LI.FI Diamond
  `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` as router and approval spender.
- Decoded their actual calldata against the published contract interface.
  Selector `0x5fd9ae2e` is `swapTokensMultipleV3ERC20ToERC20`.
  The samples have a fee step followed by the token swap; they are not the
  single-swap variant. Recipient and minimum output match the quote metadata.
  The sampled fee was 0.25% of input, included in the quote, separate from gas.
  Quotes, fees, paths and liquidity must be refreshed at execution time.
- Privy accepted creation of a temporary, unattached policy allowing bounded
  USDC approval to that spender and the specific swap function, constrained to
  Base, zero native value and a fixed output recipient. Deleted the policy
  immediately afterwards. No operational wallet permissions were changed.
- No transaction was signed or broadcast. Policy creation validates the policy
  definition, not enforcement during execution. Nested swap-array conditions,
  collaborator execution and gas payment have not been tested live.

Evidence: `artifacts/lifi/check.json`, `decoded-quotes.json`, `swap-abi.json` and
the six saved `*-quote.json` responses. These quotes use a dummy address and
must never be submitted.

## Integration boundaries

1. Keep existing account authentication, shared-wallet lookup and fresh signer
   revocation checks. Obtain each operator's own verified identity token.
2. Request a quote server-side for Base USDC to a configured RWA, with both
   source and recipient forced to the shared address.
3. Validate router, spender, chain, native value, decoded recipient, input
   budget, output asset, minimum output and every internal swap/fee step. Do
   not trust transaction fields supplied by the browser or blindly forward a
   router call. The trial policy only constrains top-level fields; it does not
   establish restrictions on every nested field. Reject unsupported selectors
   and route shapes until their validators and permissions are implemented.
4. Show input, minimum received and fees before confirmation. Approve only the
   required amount when allowance is insufficient, then submit the validated
   swap. Prefer ordinary approvals initially to avoid granting general typed
   data/Permit signing permission.
5. Extend the owner-controlled collaborator policy and app capability checks.
   Current policy matching is exact, so existing collaborators need the owner
   to apply the updated permissions. This can operate before slot deployment;
   the current early return for an unconfigured slot must not omit swap rules.
6. Reuse shared-wallet write coordination, idempotency and explicit operation
   states for approval and swap. Resolve Privy's asynchronous transaction ID or
   user operation hash to the final chain receipt; do not equate an accepted
   send request with a completed swap. Refresh inventory after confirmation.

No change to the slot contract is indicated by these checks. The acquired
tokens stay at the shared address and use the existing contract funding flow.
No database is required for the integration itself; existing single-process
coordination and recovery limits still need to be respected.

## Gas

Privy's documented server-side `eth_sendTransaction` supports Base USDC gas via
`sponsor: true` and `sponsor_options: {asset: 'usdc'}`. This is the method used
by our existing gas helper, and is independent of the quote provider. The shared
wallet needs enough USDC for both input and gas. ETH fallback remains applicable
only after a definitive insufficient-gas-token rejection before submission.
The LI.FI gas estimate is not a final Privy USDC fee quote. Verify both approval
and swap with the collaborator on a funded wallet before marking this live.

## Primary sources

- [LI.FI quote API](https://docs.li.fi/api-reference/get-a-quote-for-a-token-transfer)
- [LI.FI widget wallet management](https://docs.li.fi/widget/wallet-management)
- [LI.FI SDK providers](https://docs.li.fi/sdk/configure-sdk-providers)
- [LI.FI contract addresses](https://docs.li.fi/introduction/lifi-architecture/smart-contract-addresses)
- [GenericSwapFacetV3 source](https://github.com/lifinance/contracts/blob/main/src/Facets/GenericSwapFacetV3.sol)
- [Privy policy methods and calldata conditions](https://docs.privy.io/controls/policies/overview)
- [Privy user-pays gas](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup)
