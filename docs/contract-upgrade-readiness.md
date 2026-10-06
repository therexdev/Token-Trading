# Contract upgrade readiness

## October 6 testing update

The [fresh read-only inventory](release-evidence/mainnet-2026-10-06-node.json)
captured heads 39,979,740–39,979,744. Both existing accounts still have the
pinned pre-security bytecode. Nine resting orders remain. All recorded token
obligations and the outstanding 99,990,000-unit LP claim are covered; both new
lock spaces remain empty. The orderbook holds 1,101 KOIN against 1,001 KOIN
of recorded order escrow. These current-head reads are not an atomic node export.

The exact historical launchpad has now been reproduced byte for byte from
commit `165d311f7065d45177be5289110e3a3e3d2e5d1a`; its build inputs match the
rehearsal source baseline. See [provenance evidence](release-evidence/launchpad-provenance-2026-10-06.json)
and run `npm run verify:launchpad-provenance` to repeat it. This compiles the
committed generated TypeScript with the historical configuration and matching
locked dependency versions; it does not rerun protoc generation.

The production-WASM suite now has 22 tests, including 11 new tests for the
unmodified seven-day reclaim boundary, creator authority, transfer failures,
rollback, callbacks, retries, single payout, and remaining buyer/locked-token
obligations. It passes against both the September 25 and October 6 inventories.
The simulated host does not establish elapsed-time or real-node coverage.

The separate [native-token extension](testnet-native.md) preserves the completed
September rehearsal and uses a separate journal. All nine immediate stages
passed with actual Harbinger KOIN. Its 18 included transactions have canonical,
non-reverted, irreversible receipts; six expected security rejections are
recorded separately. The real seven-day reclaim remains locked until
**October 13, 2026 at 15:45:51.590 UTC**. See
[native evidence](release-evidence/harbinger-native-2026-10-06.json).

Both known KoinDX router
addresses lack contract metadata on current Harbinger, while positive controls
work; see [router preflight](release-evidence/koindx-harbinger-preflight-2026-10-06.json).
An isolated official-source router and pool were then built and deployed.
All five [KoinDX stages](release-evidence/harbinger-koindx-2026-10-06.md) passed:
native liquidity deposit, exact LP minting, early rejection, delivery to the
recorded creator after the actual unlock, and duplicate rejection. This
closes the isolated contract integration test, not production-router
attestation or deployed keeper coverage.

The [keeper source review](release-evidence/keeper-review-2026-10-06.md)
reproduced a missing pre-submit Mana check and inadequate receipt confirmation.
[Gateway draft PR #17](https://github.com/therexdev/discover-koinos/pull/17)
fixes both, adds durable pending-ID handling, and blocks interactive market
creation while a keeper nonce is unresolved. Its full suite passes locally
and in GitHub Actions: 60 Node tests, including 47 keeper/receipt cases, plus
gift and SMTP checks. The receipt helper also matches an existing real
Harbinger receipt. A deployed keeper rehearsal and coordination with external
payer users remain open.

Historical source provenance is closed. Atomic production-state replay,
production-router attestation, deployed keeper and wallet integration, the live seven-day result, independent
review, and the separately authorized mainnet release remain open.

## September rehearsal checkpoint

September 29 (UTC): all fifteen stages of the [live Harbinger rehearsal](release-evidence/harbinger-rehearsal-2026-09-29.md) passed using synthetic positions and controlled token/router fixtures. Orders, launch records, buyer records, and balances matched exactly across the in-place upgrade. The [setup guide](testnet-rehearsal.md) and public receipt/state evidence document the result. Production-state export, native-token/KoinDX/keeper integration, and independent review remain open requirements.

The September 27 inventory showed mainnet contracts running the pre-hardening code. This preparation and Harbinger rehearsal do not establish that the application is safe or deploy a mainnet contract. SEC-01 and SEC-13 remain open until independent review, production integration rehearsal, authorized deployment, and post-deployment verification are complete.

## Release identity

The contract source is the merged security release at `d0298016557a4a3f9de01b3058ff3e4d5b6673bc`. `scripts/security-release.json` pins the chain, existing addresses, expected old bytecode, patched bytecode, and storage layout.

| Contract | Existing address — preserve this address | Patched SHA-256 |
| --- | --- | --- |
| Orderbook | `1Bke72aGbpq4brDY3m1UQxRCGBB9GPTJQz` | `5a947b3e6dd3dbbeea80c2cb2400ab2eabecea5d33f5424b48f31d03c9333ac4` |
| Launchpad | `13akLV3xQZdRjdQ2ANYo7cvSsD8qfBZReV` | `822c9203b85b5b37405092ec9b7ea3263e59deb9b1213cfb56029e91a65f92c2` |

Use an upload to each existing account, retaining the authorization flags. Do not create replacement accounts, initialize state, cancel orders, or transfer escrow as part of this release. Existing deployment/key-generation commands are not the reviewed upgrade procedure. A new key creates a different account and does not control the existing escrow.

## Live inventory

`release-evidence/mainnet-2026-09-25-node.json` was captured at **2026-09-25 06:07:00 UTC** using `https://api.koinosai.com`, spanning head heights **39,661,109–39,661,121**. Chain ID matched the mainnet release. All preserved storage spaces and the proposed lock spaces were enumerated, including empty keys. Index checks and token-reported balances passed for the captured state.

| Item | Observed state |
| --- | --- |
| Orderbook markets / open orders | 30 markets / 11 orders |
| Orderbook KOIN | 1,251 held; 1,151 owed in resting-order escrow |
| Orderbook other escrow | Six other token balances cover their recorded order obligations; exact integer amounts are in the JSON evidence |
| Launchpad launches | Four total: two completed and two canceled; no active distribution/refund batches |
| Launchpad KOIN | 100 held; no outstanding recorded KOIN obligation |
| Outstanding LP claim | Launch 4: 99,990,000 LP base units, fully covered by the reported balance |
| LP beneficiary | `12Kw58PnaGUemfWy5Hf8qp7YftaoTBATYA` |
| LP token / pair | `1Bgb4hw9DrdRqEWGS9gFfo9E6Uw8qVzyhT` |
| LP unlock | February 24, 2027 at 22:37 UTC (`1803508620000` milliseconds) |
| New lock storage | Orderbook space 6 and launchpad space 4 both empty |
| Authorization metadata | Both non-system; all three authorization override flags false |

The difference between KOIN held and recorded obligations is not classified as withdrawable. The inventory includes current obligation tokens plus KOIN, not unrelated tokens sent directly to these accounts. An arbitrary token's balance response is not proof of honest transfer behavior.

RPC reads are at the current head and are **not an atomic, block-pinned snapshot**. The read methods have no block parameter in the upstream [chain RPC schema](https://github.com/koinos/koinos-proto/blob/master/koinos/rpc/chain/chain_rpc.proto). A trusted node export and a fresh comparison at the upgrade boundary remain necessary. Public RPCs tested at `api.koinos.io` and `api.koinosblocks.com` did not support the required raw user-space reads; public contract-reader fallback reports incomplete storage verification and cannot prepare an upgrade.

## Preparation and validation

Install locked dependencies in `contract`, `launchpad`, and `scripts` using `npm ci --ignore-scripts`. Run the existing production build in each contract directory. From the repository root:

```sh
npm run test:contracts
npm --prefix scripts test
KOINOS_RPC=https://api.koinosai.com node scripts/upgrade-audit.js inspect /absolute/path/to/new-inventory.json
KOINOS_RPC=https://api.koinosai.com node scripts/upgrade-audit.js prepare /absolute/path/to/new-unsigned-review.json
```

In PowerShell, set `$env:KOINOS_RPC = "https://api.koinosai.com"`, then run the `node` command without the leading environment assignment. Each output path must be new; the script refuses to overwrite a file.

The tool has an allowlist of read-only RPC methods and never loads a signer or private key. Preparation performs a fresh scan, verifies the expected old hashes, checks balances and unused lock spaces, and validates the exact patched WASM hashes. It produces two `upload_contract` operations addressed to the existing accounts, with all authorization flags preserved. It generates no initialization calls, transaction header, signature, or broadcast request. The result always says `readyToBroadcast: false` and lists the outstanding review requirements. A saved package is review evidence, not a durable authorization or current-state attestation.

The committed [unsigned review package](release-evidence/unsigned-security-upgrade.json) was generated at **2026-09-25 06:20:07 UTC**, spanning heights **39,661,376–39,661,384**. Its enumerated storage matches the earlier inventory exactly; both uploads match the pinned addresses and patched hashes. Initial refresh attempts returned HTTP 503 and produced no file. Serialized RPC reads subsequently completed successfully. Regenerate the inventory at the actual upgrade boundary; do not treat this historical package as a fresh check.

Validation completed locally:

- Both production builds pass WebAssembly MVP verification and match the pinned release hashes.
- Eleven WASM tests pass. These include identical public reads using historical and patched WASM over the captured mainnet storage, refunds of all eleven captured orders exactly once, preserved order counters, and the captured LP claim's date, beneficiary, failed-transfer rollback, retry, and single payout.
- Ten preparation tests pass, including read-only RPC restrictions, serialized requests and HTTP failure handling, wrong-chain rejection, complete storage enumeration, protobuf zero-value preservation, integer accounting above JavaScript's safe integer range, and rejection of stale or inconsistent preparation inputs.
- CI runs the contract tests, both production builds, and preparation tests. Existing frontend checks remain enabled.

The WASM test host models external contracts and rollback. A separate live Harbinger run now validates the fifteen synthetic rehearsal stages. Exact production-state replay, native-token/KoinDX/keeper integration, and independent contract review remain incomplete.

## Requirements before broadcasting

1. Verify control of the original contract-account authorities for both addresses. Confirm their public addresses locally and document backup/recovery and authorized operators. Never send a private key or seed phrase in chat, a PR, or the release evidence.
2. Obtain independent review of the lock coverage, authority behavior, storage compatibility, and token/router interactions. Exact historical launchpad source provenance was reproduced on October 6; behavioral and security review remain separate requirements.
3. Rehearse an in-place upgrade on a real node with exported state and representative tokens/router/keeper behavior. Exercise ordinary and failed settlements, callbacks, all claim paths, multiple sequential operations, and resource usage. Retain receipts, before/after state, and artifact hashes. The current workspace has no Docker/Podman runtime, so this gate requires a suitable node environment.
4. Record keeper deployment/version and coordinate the maintenance window. Refresh inventory from a trusted node, compare storage and balances, verify current chain head and authorization, and estimate resource limits and transaction payer requirements. The captured mana balances do not prove upgrade affordability.
5. Obtain operator authorization for the exact existing addresses and reviewed hashes, then construct/sign using the verified account authorities. This repository's preparation deliberately stops before that irreversible operation.
6. Verify canonical inclusion and a successful non-reverted receipt for each upload, then read back bytecode, authorization metadata, public state, and escrow/claims. Compare against the immediately preceding inventory while accounting for legitimate intervening activity. Do not declare success from submission alone or routinely roll back to the vulnerable bytecode.

No new frontend address is needed for this in-place upgrade. The restored Hostinger Git deployment continues to use `claude/koinos-orderbook-dex-mdkvf6` with frontend root `frontend`; this preparation does not change those settings.

## Parallel API work

Payload-bound, one-time API proof v2 changes remain draft and undeployed: [gateway PR 15](https://github.com/therexdev/discover-koinos/pull/15) and [Trade PR 10](https://github.com/therexdev/Token-Trading/pull/10). Their coordinated rollout still requires production `PUBLIC_ORIGIN`, `SIGNER_ORIGINS`, and persistent shared `DATA_DIR`/worker-topology verification. Keep this contract preparation independent of that rollout. Token branding authority, signer-session revocation, and the remaining operational requirements in `security-requirements.md` remain open.
