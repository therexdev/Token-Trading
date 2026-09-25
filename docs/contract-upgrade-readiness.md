# Contract upgrade readiness — September 25, 2026

The mainnet contracts still run the pre-hardening code. This preparation does not deploy a contract, move funds, or establish that the application is safe. SEC-01 and SEC-13 remain open until independent review, real-node rehearsal, authorized deployment, and post-deployment verification are complete.

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

The WASM test host models external contracts and rollback. It is **not** a real Koinos node. No real-node rehearsal or independent contract review has been completed by this preparation.

## Requirements before broadcasting

1. Verify control of the original contract-account authorities for both addresses. Confirm their public addresses locally and document backup/recovery and authorized operators. Never send a private key or seed phrase in chat, a PR, or the release evidence.
2. Obtain independent review of the lock coverage, authority behavior, storage compatibility, and token/router interactions. Validate the launchpad's historical behavior where exact source provenance is unknown.
3. Rehearse an in-place upgrade on a real node with exported state and representative tokens/router/keeper behavior. Exercise ordinary and failed settlements, callbacks, all claim paths, multiple sequential operations, and resource usage. Retain receipts, before/after state, and artifact hashes. The current workspace has no Docker/Podman runtime, so this gate requires a suitable node environment.
4. Record keeper deployment/version and coordinate the maintenance window. Refresh inventory from a trusted node, compare storage and balances, verify current chain head and authorization, and estimate resource limits and transaction payer requirements. The captured mana balances do not prove upgrade affordability.
5. Obtain operator authorization for the exact existing addresses and reviewed hashes, then construct/sign using the verified account authorities. This repository's preparation deliberately stops before that irreversible operation.
6. Verify canonical inclusion and a successful non-reverted receipt for each upload, then read back bytecode, authorization metadata, public state, and escrow/claims. Compare against the immediately preceding inventory while accounting for legitimate intervening activity. Do not declare success from submission alone or routinely roll back to the vulnerable bytecode.

No new frontend address is needed for this in-place upgrade. The restored Hostinger Git deployment continues to use `claude/koinos-orderbook-dex-mdkvf6` with frontend root `frontend`; this preparation does not change those settings.

## Parallel API work

Payload-bound, one-time API proof v2 changes remain draft and undeployed: [gateway PR 15](https://github.com/therexdev/discover-koinos/pull/15) and [Trade PR 10](https://github.com/therexdev/Token-Trading/pull/10). Their coordinated rollout still requires production `PUBLIC_ORIGIN`, `SIGNER_ORIGINS`, and persistent shared `DATA_DIR`/worker-topology verification. Keep this contract preparation independent of that rollout. Token branding authority, signer-session revocation, and the remaining operational requirements in `security-requirements.md` remain open.
