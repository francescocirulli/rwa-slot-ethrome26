# Gas paid by the wallet

`PRIVY_GAS_MODE=usdc` is the default. Enable **User pays**, network **Base** and
asset **USDC** in the Privy dashboard. The app sends
`sponsor: true, sponsor_options: {asset: 'usdc'}` through the Node SDK: in this
mode, the user's wallet pays, rather than the app's gas credits. Privy handles
paymaster approval in the transaction. `USDC.approve(slot, budget)` remains
separate and limits only gameplay spending.

The installed React SDK does not expose `sponsor_options`, so phone- and
admin-approved operations go through server APIs. The Privy access token
authenticates the request; the browser authorizes the exact bytes prepared by
the Node SDK with `useAuthorizationSignature`. The server forwards the signature
through `sign_fns`, without exchanging JWTs for wallet keys. Each USDC/ETH attempt
requires its own signature for the corresponding payload. Access and expiry
are rechecked after signing and before submission. Keys, tokens and signatures
are not logged. The iPad session's P-256 signer remains limited to `startSpin()`.

## Fallback

1. Request USDC gas with a stable idempotency key per operation/currency.
2. Only a Privy HTTP 400 error recognized as insufficient balance, without
   references to an already submitted transaction, allows an ETH attempt from
   the same wallet: `sponsor: false`, without `sponsor_options`.
3. Network errors, 5xx responses, policy errors, configuration errors, reverts
   and unknown errors do not trigger fallback. If ETH is also insufficient,
   the UI asks for funding. Currency never changes after an accepted submission.

Error recognition fails closed: if Privy changes the rejection format, the
request does not automatically switch to ETH. Checking `balanceOf` alone is
insufficient: USDC must cover both the operation and its fees.
`PRIVY_GAS_MODE=eth` skips the first attempt and uses ETH directly.

Consent states that fees are additional to the budget/amount. No binding numeric
quote is shown: Privy calculates gas at submission time. The backend wallet for
reveals, expiry and free spins always pays in ETH, funded by the operator.

## Confirmations and recovery without a database

`POST /api/contract/prepare` simulates an allowed action with the real sender
and zero gas price so wallets without ETH are not rejected. It neither signs
nor submits. The request is bound to the user, wallet, calldata and gas mode,
expires after 5 minutes and must be confirmed in the UI. `POST /api/contract/send`
requires its ID and `confirm: true`; concurrent requests share one submission.
`POST /api/contract/cancel` cancels only requests not yet submitted.
`GET /api/contract/status` requires authentication as the same owner.

Privy may return a `transaction_id` before a hash. The backend tracks it through
to the receipt; the UI stores only the public ID and, once available, the hash
in sessionStorage. Refreshing does not resubmit. Two onchain confirmations
complete the operation. Polling does not extend the iPad session.

Requests not yet onchain are held in memory. After a restart, a saved hash allows
direct receipt verification. If the Privy response is lost without a hash/ID,
or the server restarts before the browser receives the hash, the app keeps the
operation blocked and asks the user to check the wallet. It does not promise
recovery of a submission without references or blindly resend. Reveals for
games already recorded onchain remain recoverable from the contract.

## Validation

Automated tests cover SDK options, USDC → ETH, ambiguous errors, session expiry
between attempts, insufficient funds, gas consent, ownership, immutable calldata,
duplicate clicks and pending state. Anvil verifies simulation without ETH.
The manual browser test uses an empty Privy wallet and intercepts writes to
verify confirmation, cancellation and refresh.

**Real USDC gas charges and ETH fallback on Base still require contract deployment
and a funded acceptance test.** No real funds have been moved.

- [Privy: User pays setup](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup)
- [Privy: eth_sendTransaction](https://docs.privy.io/api-reference/wallets/ethereum/eth-send-transaction)
- [Privy: native request authorization](https://docs.privy.io/controls/authorization-keys/using-owners/sign/utility-functions)
