# Official-source KoinDX rehearsal — October 6, 2026

All five KoinDX stages passed on isolated Harbinger accounts. Five included
transactions have canonical, non-reverted, irreversible receipts. Two expected rejections
cover early and duplicate LP claims. The finality result and exact receipt
identities are in the [public JSON evidence](harbinger-koindx-2026-10-06.json).
The final included transaction was in block **8,987,153**. At the last
KoinDX receipt verification (`2026-10-06T15:57:41.940Z`), the last irreversible
block was **8,987,204**. All 23 included transactions across the native and
KoinDX continuation were also reverified together as irreversible.

This continues the [native-token rehearsal](harbinger-native-2026-10-06.md)
with the same accounts and journal. It adds an official-source router at
`1BZwunANbBd57rYrDMPybNAscyDV7fw8rY` and fresh pool at
`1GT23TFxouvxHhAPBU63Xm36urJ9QrcnDb`. Mainnet was not modified.

## Build and coverage

[Source/build evidence](koindx-source-build-2026-10-06.json) pins official
`koindx/v2-core` commit `2ac84216015dc54e007766787d57a06dbe3140b6` and
`koindx/v2-periphery` commit `b4a73401bcf0aed293ec46ed6fba295b1830c507`.
The compiled pool matches the original upstream router hash pin exactly.
Both contracts preserve the upstream business logic; the manifest records
the historical toolchain, pinned protoc and explicit-start build option.
This does not attest the bytecode or configuration of the live mainnet router.

| Stage | Result |
| --- | --- |
| Verify router and atomically upload/initialize fresh pool | Passed |
| Fund and settle native-KOIN launch #4 | Passed |
| Deposit through real router and mint exact LP | Passed |
| Reject LP claim before actual unlock, with unchanged state | Passed |
| Deliver LP to creator once after unlock; reject duplicate | Passed |

Launch #4 used one tKOIN from the already-funded buyer, within the original
six-tKOIN funding cap. Settlement paid 0.5 tKOIN to the creator and deposited
**0.5 tKOIN plus one fixture sale token** into the actual pool. It minted
**70,700,678 raw LP units** to the launchpad, matching integer square-root
liquidity accounting after the pool's 10,000-unit permanent minimum.

The ten-minute LP lock expired at `2026-10-06T15:48:49.120Z`. A buyer-signed
claim delivered all 70,700,678 units to the recorded creator; the buyer
received no LP. The launchpad LP balance is zero. Native/base balances stayed
unchanged during claiming and after the rejected duplicate.

The independent launch #3 retains exactly **0.5 tKOIN and one fixture token**
for its full seven-day grace period, due `2026-10-13T15:45:51.590Z`.
Its complete launch record was checked unchanged throughout this continuation.
The router has zero residual native KOIN and sale tokens; the pool holds its
expected liquidity assets. Included KoinDX receipts consumed
**10.74047410 tKOIN-equivalent Mana**, separate from token transfers.

## Recovery and remaining scope

The first attempt to snapshot nonexistent launch #4 exposed an empty RPC result;
the runner now handles that response. This stop happened before funding the
launch. A later read-only receipt refresh encountered a transport failure;
resumption reused the recorded transaction IDs. No transaction was blindly
rebroadcast, and no accounts or journal were reinitialized.

The shared runner limits remain Harbinger-only. Official pool authorization
hooks are allowed only for the pinned fresh-pool upload and exact atomic
native-KOIN/fixture `create_pair` operation, signed by the pool account.
Thirty-eight offline guard tests pass, including rejection of mainnet,
changed artifacts, changed pair arguments, wrong signers and budget excess.

This establishes isolated contract integration using a controlled sale token.
Atomic production-state replay, production router attestation, deployed keeper
and browser-wallet integration, the actual seven-day reclaim, independent
security review, and an authorized mainnet release remain separate. See the
[keeper review and local fixes](keeper-review-2026-10-06.md) and
[restore guide](../testnet-native.md). `mainnetReady` remains false.
