# Integration and review continuation — October 9 UTC / October 8 Chicago

No mainnet transaction, frontend release, gateway deployment or PR merge was
performed. The changes remain review candidates.

## Actual keeper against Harbinger

The actual gateway modules completed finalize, buyer distribution, liquidity
provision, creator-token unlock and LP unlock for new launch **5**. The
gateway source is `889cc88bc84b19ae494914b516e6aecced32a672` on
`security/keeper-receipt-mana` ([PR 17](https://github.com/therexdev/discover-koinos/pull/17)).
Exact executed file hashes are in the [public evidence](harbinger-keeper-2026-10-09.json).

Setup plus all five keeper transactions have canonical, nonreverted,
irreversible receipts. Verification at **04:28:15.464 UTC** observed head
**9,057,672**, irreversible height **9,057,612**, and the final claim in
block **9,057,600**. Total recorded execution resource use was **0.51418192
tKOIN of Mana**; this is resource consumption, not an additional token transfer.

Exact balances were reconciled: the buyer spent 0.1 tKOIN and received
0.1 fixture token; the creator received 0.05 tKOIN and the 0.1 locked token;
the existing official pool received 0.05 tKOIN plus 0.1 fixture token and
minted **7,071,067 LP base units**, all paid to the recorded creator. The
buyer received no LP. The router retained no new token balance. The
launchpad's older 0.5 tKOIN plus one fixture token remained reserved for
launch 3, whose full record and original checkpoint bytes were unchanged.
Another process invocation performed an idle cycle with zero submissions
and an empty pending journal.

This is a locally executed production-module integration, with real chain
execution and an existing pool. It does not attest the gateway currently
running on a host, browser approvals, fresh-pool creation by the keeper,
multi-process nonce coordination or every failure mode on-chain. Offline
regressions cover Mana exhaustion, multi-batch progress, lost responses,
pending restart recovery, reverts, malformed/orphaned receipts and journal
bindings. See [restore and run instructions](../testnet-keeper.md).

## Wallet transport and confirmation

The live Vault compatibility gate passed protocol-2 pairing, fragment-only
credentials, JSON POST status, exact Trade-origin CORS and disconnect. It
now also checks browser preflights for `create`, `status`, `request`,
`request-status` and `disconnect` before creating a probe session. All five
live preflights returned 204 with the required origin, method and header.
Two unapproved sessions were created during the initial and final checks;
both were disconnected. No signature request or wallet transaction was sent.

The frontend confirmation helper now rechecks the block and receipt against
a fresh sampled head after koilib's initial canonical lookup. It validates
matching block/header/receipt identities, heights, one matching transaction
and receipt, and boolean revert semantics. Protobuf's omitted false is
accepted; malformed values or changed chain evidence leave the original ID
pending for a read-only recheck. This fixes a reporting gap without changing
transaction signing or submission.

The updated helper verified existing Harbinger transaction
`0x12205ba712ab1b2fe7467dba1ae50b2bf4be13cfdba29f473c323d64147a6aa2286c`
at block 8,986,712 through actual RPC responses at 04:13:52.575 UTC. Both
configured mainnet RPCs served head-pinned block/receipt reads; sampled
blocks had no transactions, so that probe is not a mainnet transaction test.

Hosted Trade `/` and `/koindx/` returned HTTPS 200, CSP, `nosniff`, frame
denial and referrer policy. HSTS was absent in those sampled responses.
Google gateway discovery advertised an enabled signer/Google client and
correct Trade-origin CORS. Discovery is not an authenticated sign-in or
signing test. Real Google, Kondor extension and Vault QR/passkey approvals,
denials, expiry/account switching and on-chain staging operations still need
test identities/devices and the selected staged deployment.

## Router identity, contract finding and remaining work

Two read-only mainnet captures verified the router byte-for-byte against the
official source build, its authorization flags, the existing pool metadata,
pair mappings and the preserved LP claim. See
[production-router evidence](../production-router-attestation.md). Direct
pool byte retrieval exceeded the public RPC buffer; this is explicitly
recorded as a metadata-hash check rather than a successful byte read.

The internal contract review found **CR-01**, an inherited accounting bug:
an existing pool can consume slightly less than a launch's liquidity
earmarks, and the original candidate has no claim path for that remainder.
A separate `security/liquidity-remainder-fix` candidate validates consumed
amounts, clears approvals, refunds the exact remainder to the creator and
emits actual deposits. Its production hash is
`d6bcf48764ff2fa2ab42050af600a881ed5fe363843ed4c9ba53d148c6a3309d`.
The original release pins and October 13 deployment are not rewritten or
presented as testing this new binary. The correction and its separately
scoped live evidence must be reviewed before choosing the final release.

An actual atomic production-state replay still needs a consistent full-node
checkpoint and a suitable isolated node environment. This workspace has
neither; account-level RPC scans and simulated-WASM tests do not substitute.
Independent external review, hosted keeper/browser-wallet validation,
original-key custody verification, the actual October 13 reclaim and
separately authorized release/post-deployment checks remain open.

Validation for this continuation: 59 frontend tests, 15 wallet-transport
tests and 15 keeper/router evidence guards pass; the frontend production
build passes. Gateway CI passes on the published revision (67 Node cases,
plus gift and SMTP checks). The separate contract candidate passes 40 WASM
tests against both captured inventories, 11 audit tests and its full build;
these candidate results do not retroactively change the original artifact.
