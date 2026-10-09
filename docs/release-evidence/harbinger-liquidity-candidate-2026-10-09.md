# Live partial-liquidity candidate integration — October 9, 2026 UTC

The separate CR-01 correction was exercised against actual Harbinger KOIN
and the existing official-source KoinDX pool. Both partial-deposit cases
returned the correct unused asset to the recorded creator, cleared the
native router approval, preserved older escrow, and paid LP tokens once.

Production candidate: **39,286 bytes**, SHA-256
`d6bcf48764ff2fa2ab42050af600a881ed5fe363843ed4c9ba53d148c6a3309d`.
The independent local compile reproduced this exact production hash before
making the two test-only native-token/router address substitutions.
The isolated deployed build has the same byte length and SHA-256
`56d8607eae28f12975db5ef8d8d1bc1069ef8ac9a88d9230cfe7392f405ba26b`.
Its account is `1DME8B2Gh6jGuRit9C2s3DxogsAs8cWSD3`; it is non-system
with all three authorization overrides false.

The [machine-readable evidence](harbinger-liquidity-candidate-2026-10-09.json)
contains exact receipts, snapshots, build and review-manifest hashes,
observed finality and the preserved original launch record. Individual
source hashes are in the [frozen candidate manifest](launchpad-liquidity-candidate-2026-10-09.json). The report
excludes keys and signed transaction bodies.

All **eight** included transactions are canonical, nonreverted and
irreversible. Final verification at **04:43:14.456 UTC** observed irreversible
height **9,057,888**; the last transaction was in block **9,057,877**. Recorded
execution used **4.17293518 tKOIN of Mana**, separately from the 0.2 tKOIN
contributed to the two launches. The machine-readable finality flag is true.

## Exact outcomes

Each launch used 0.1 tKOIN from the buyer's existing test balance, sold
0.1 fixture token and earmarked 0.05 tKOIN for liquidity. No new sponsor
token transfer or mint was used. The pre-existing pool ratio was two fixture
token units per native KOIN unit. The fee setting was attested at run entry;
reserves, supply and kLast were checked before mutation and again for each
liquidity calculation.

| Case | Token earmark | Actual pool deposit | Creator remainder returned | LP minted and delivered |
| --- | --- | --- | --- | --- |
| Excess sale tokens | 0.101 token | 0.05 tKOIN + 0.1 token | 0.001 token | 7,071,067 base units |
| Excess native KOIN | 0.099 token | 0.0495 tKOIN + 0.099 token | 0.0005 tKOIN | 7,000,356 base units |

After each deposit, the candidate held zero native KOIN and zero sale token,
the native router allowance was exactly zero, and neither buyer nor router
received the creator's remainder. After the actual 90-second LP deadline,
a buyer-signed permissionless claim delivered all LP to the creator. The
buyer received no LP, the candidate retained no LP, and a duplicate claim
was rejected. Actual reserve, supply and account deltas match integer pool
minting calculations, including rounding.

All eight positive checks passed. Eight transactions were included; two
duplicate-claim security rejections are recorded separately. The two
optional early-claim probes were **skipped**, not passed: after collecting
the snapshots, less than the required safe 60-second margin remained before
unlock. This avoids submitting an intended early rejection after the clock
has already crossed the deadline. Existing early-lock coverage is recorded
in the earlier KoinDX run and in the contract tests; it is not relabeled as
a new candidate live rejection.

The original launchpad's KOIN, fixture-token and LP balances, its complete
launch-3 record, and the original checkpoint files remain unchanged by this
candidate run. The original seven-day date is still October 13 at
15:45:51.590 UTC. It is separate evidence for the original pinned artifact;
this new binary's seven-day source/behavior coverage remains explicitly
scoped for final review.

## Reproducibility and limits

See [runner instructions](../testnet-liquidity-candidate.md). It pins reviewed
source files and the production/test binaries, forbids mainnet and original
contract mutations, caps aggregate contributions at 0.2 tKOIN, journals
before submission and reconciles pending IDs before preparing another label.
Only evidenced resource rejections release a reserved contribution budget.
Strict finality checks require matching canonical block/header/receipt IDs,
one matching transaction and receipt, and boolean revert semantics.

The sale token is a controlled fixture and has no public allowance reader.
Both approval-reset calls executed successfully; the native KOIN allowance
was read back directly. Transfer/reset failure and callback rollback have
18 added simulated-WASM regressions; this live run does not claim those
failures were reproduced on a real node. Forty WASM tests pass against both
captured inventories, 11 audit tests pass, 16 candidate-runner guards pass,
and the full production build reproduces the candidate hash.

The frozen candidate manifest describes the pre-integration review checkpoint;
this dated evidence supplements it without rewriting the artifact identity.
The candidate remains unapproved for mainnet. Independent external review,
atomic production-state replay, hosted keeper/browser-wallet validation and
release authorization remain open. The change prevents new remainders; it
does not invent recovery claims for historical already-provided launches.
