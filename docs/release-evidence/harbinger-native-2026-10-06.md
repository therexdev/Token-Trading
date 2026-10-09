# Native Harbinger rehearsal — October 6, 2026

All nine immediate native-token stages passed. Eighteen included transactions
have canonical, non-reverted receipts and are irreversible. Six expected
security rejections are recorded separately. The seventh-day claim is still
waiting for real chain time; it has not passed.

[Public JSON evidence](harbinger-native-2026-10-06.json) captures this checkpoint
before the separate KoinDX continuation. It excludes keys and signed
transaction bodies. [Restore and execution guide](../testnet-native.md).

## Scope and outcome

The payment token is Harbinger's actual KOIN system contract,
`1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju`, resolved through the chain name service.
The orderbook is `1FnQm3fzcvTjofx5376GBzZjgSYDj5hby5`; the launchpad is
`1E1FVxb7m8TaeNzZnKFB1HdtZwFUs2FFkR`. All other actors and the sale token
are isolated test accounts. Only the funded payer is shared with the completed
September fixture rehearsal.

| Test | Result |
| --- | --- |
| Resolve native KOIN and verify system metadata | Passed |
| Deploy historical contracts | Passed |
| Cap buyer funding at 6 tKOIN and grant bounded allowances | Passed |
| Create old-version orders and three launch positions | Passed |
| Upgrade both accounts with identical public records and balances | Passed |
| Reject wrong-owner and duplicate order cancellation; refund once | Passed |
| Roll back native payment after sale-token failure; retry trade | Passed |
| Refund canceled launch and settle creator/buyer payouts once | Passed |
| Reject reclaim before full seven-day grace; reserve exact escrow | Passed |
| Reclaim after seven days, reject wrong owner and duplicate | Waiting |

The waiting launch is #3. It retains exactly **0.5 tKOIN and one fixture sale
token**. Its earliest reclaim time is **2026-10-13T15:45:51.590Z**. Resume uses
actual testnet block time and preserves the full 604,800,000-millisecond grace
period. No automatic future run is scheduled.

Canonical receipt verification completed at `2026-10-06T15:31:41.465Z`.
The final included transaction was in block **8,986,712**; the last irreversible
block was **8,986,726**. Included receipts consumed **8.77607307 tKOIN-equivalent
Mana**, which is resource usage, separate from the 6 tKOIN buyer funding.

## Recovery and evidence limits

The first patched-launchpad upload requested a 20-tKOIN Mana limit and received
explicit pending-resource error 104. Its saved ID was absent from canonical
receipts and the transaction store after the starting block became
irreversible, and the payer nonce was unchanged. The replacement retained that
nonce and used a 5-tKOIN cap. Both attempts and reconciliation evidence remain
in the journal. Ambiguous submissions are never blindly rebroadcast.

Orderbook artifacts match both production pins exactly. Launchpad sources
replace only the embedded payment-token and router addresses. The router was
unused during these nine stages. Snapshot equality covers public records and
balances; token allowance state is not part of that comparison.

This checkpoint does not establish production-state export/replay, deployed
keeper or browser-wallet integration, independent security review, or mainnet
readiness. The public evidence retains `mainnetReady: false`.
