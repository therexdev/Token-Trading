# Native seven-day reclaim completed — October 13, 2026

The preserved native Harbinger launch **3** completed its real seven-day
liquidity reclaim. The original deadline was **2026-10-13T15:45:51.590Z**;
the successful transaction was included at **2026-10-13T18:42:37.580000+00:00**. No timing constant,
account, original signed journal entry, contract bytecode or artifact pin
was replaced to complete this test.

- Transaction: `0x12208bb0c60526cf3b22c9e6432c508c322eb2c77c7c7c828d29844366a5f672504a`
- Block: **9,185,575** (`0x122009f667f9dbbd664611e73e710e8288b7d21acca2467f88c2c24360cfd49abc0a`)
- Canonical, nonreverted, irreversible verification: **2026-10-13T18:46:31.909Z**
- Observed irreversible height: **9,185,587**
- Included native/KoinDX rehearsal receipts reverified: **24** (23 historical plus this reclaim).

[Machine-readable evidence](harbinger-native-reclaim-2026-10-13.json) contains
the fresh preflight, exact balances, preserved launch record, receipt data
and strict finality checks. System receipt state deltas and signed transaction
bodies are excluded from the public export.

## Exact outcome

| Asset | Creator before | Creator after | Returned | Launchpad after |
| --- | ---: | ---: | ---: | ---: |
| Native tKOIN | 4.1505 | 4.6505 | **0.5** | **0** |
| Fixture sale token | 13.401 | 14.401 | **1** | **0** |

The buyer's native and sale-token balances did not change. Creator, buyer
and launchpad LP balances did not change. Launch 3 changed only
`liquidityState: 1` (pending) to `3` (reclaimed); the historical earmark
fields remain in the record by design. Reclaim execution used **0.06219695
tKOIN of Mana**, separate from the returned tokens.

The buyer-signed wrong-owner attempt was rejected and the complete public
snapshot remained unchanged. The creator-signed reclaim succeeded once;
the duplicate was rejected. The rejected buyer attempt and accepted creator
transaction have the same unsigned transaction ID because their header and
operations match, while their signatures differ. The included header,
operations and signatures were privately compared with the creator-signed
journal. The rejection is evidence about that authorization attempt, not a
claim that the transaction ID never appeared on-chain.

Strict verification required matching block/header/receipt identities and
heights, exactly one matching transaction and receipt, false or omitted
boolean `reverted`, inclusion after the original deadline, a fresh canonical
anchor and irreversible height covering the reclaim block. All **32**
previously archived journal entries remain unchanged; exactly three reclaim
labels were added. The original pre-reclaim state and report were retained
byte-for-byte in private checkpoint history.

## Scope and remaining requirements

This result closes the original artifact's full elapsed-time reclaim test.
Its isolated launchpad is `1E1FVxb7m8TaeNzZnKFB1HdtZwFUs2FFkR`, with
**38,389-byte** WASM SHA-256
`c0c8693c15cbda252043ccb34e441a9d517c2e99b571d3a95dae398b91d55317`.
The deployed test build substitutes native-token/router addresses only.
This is not elapsed-time evidence for the separate CR-01 correction in
[PR #13](https://github.com/therexdev/Token-Trading/pull/13).

The frozen manifest's old waiting text describes its historical checkpoint;
this dated result supersedes that waiting status without rewriting artifact
identity. The updated recovery archive contains both the completed journal
and its original pre-reclaim checkpoint. Do not reinitialize or restore the
old waiting journal over the completed one. Existing KoinDX/keeper live
preservation checks intentionally require launch 3 unclaimed and must not be
rerun as if this legitimate reclaim had not happened; their archived results
remain valid and offline reports remain available.

Independent external review, atomic production-state node replay, hosted
keeper/browser-wallet validation, final-candidate approval and separately
authorized release remain open. No mainnet transaction, contract upload,
PR merge or production deployment was performed.
