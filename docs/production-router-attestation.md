# Production KoinDX identity and replay status

## October 9 UTC / October 8 Chicago verification

The deployed mainnet router's bytes exactly match the official-source router
used in the completed October 6 Harbinger integration. The production router
identity gate is now verified at the captured heads. This does not complete
an atomic production-state replay or the independent security review.

Two read-only captures agree:

| Evidence | RPC | Head heights |
| --- | --- | --- |
| [Primary capture](release-evidence/koindx-mainnet-attestation-2026-10-09.json) | `api.koinosblocks.com` | 40,051,087–40,051,089 |
| [Second capture](release-evidence/koindx-mainnet-attestation-2026-10-09-secondary.json) | `api.koinos.io` | 40,051,094–40,051,096 |

Both returned the pinned mainnet chain ID. The router at
`17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s` is **63,615 bytes**, SHA-256
`a835153f9259c73bc35cc4fd22027402fb2e3891d450f22d1719b4419c875fdf`.
Its on-chain metadata hash agrees with those bytes; it is not a system
contract and all three authorization overrides are false. Its bytecode is
therefore identical to the build from official periphery commit
[`b4a73401bcf0aed293ec46ed6fba295b1830c507`](https://github.com/koindx/v2-periphery/tree/b4a73401bcf0aed293ec46ed6fba295b1830c507).

The existing launch 4 LP pool at `1Bgb4hw9DrdRqEWGS9gFfo9E6Uw8qVzyhT`
reports the official pool hash
`a3ca71ad5ca801080265aeec7842a1d51c1d220e6461c72a98344f49b8e5a532`
in its on-chain metadata. This matches both the router's original pool hash
pin and our source build from core commit
[`2ac84216015dc54e007766787d57a06dbe3140b6`](https://github.com/koindx/v2-core/tree/2ac84216015dc54e007766787d57a06dbe3140b6).
The pool is non-system with all three authorization overrides true, as
required by the original router's atomic pool creation checks. Both public
RPCs reject direct pool-bytecode retrieval with `return buffer is not large
enough for the return value`. The evidence records **metadata hash verification**
and `directBytecodeVerified: false`; it does not claim a successful byte read.

Both argument orders of `get_pair(koin, token)` identify that same pool.
The pool resolves token A to actual mainnet KOIN and token B to the launch's
sale token, `1GwXTEUJ2ftBnosp4Q5RLAf5XEmaLfxW21`. Its recorded reserves are
100,000,000 base units on each side. The launchpad still holds the exact
99,990,000 LP units owed by launch 4. The beneficiary remains
`12Kw58PnaGUemfWy5Hf8qp7YftaoTBATYA`, the unlock time remains
`1803508620000`, and the claim remains unclaimed. No transfer or transaction
was submitted.

Router and pool metadata were read again at the end of each capture and
were unchanged. Reads span current heads and are not atomic. The router's
account authority can still replace its code; refresh the attestation at
the actual release boundary. This review covers the existing launch 4 pair
and current router configuration, not all KoinDX pools or future upgrades.

## Repeat the read-only check

After `npm ci --ignore-scripts` in `scripts`, run from the repository root:

```sh
node --test scripts/router-attestation.test.js
node scripts/router-attestation.js /absolute/path/to/new-attestation.json
```

`KOINOS_RPC` selects another HTTPS endpoint or local loopback RPC. The
script refuses to overwrite an output file, uses the existing read-only
RPC allowlist, rejects a different chain, and has no signing or submission
path. It checks source/build pins, deployed hashes, authority flags, both
pair mappings, token ordering, the exact preserved claim terms, and LP
coverage. Eight regression tests cover mismatched identities, altered
authority/lifecycle/beneficiary/unlock terms, incomplete bytecode validation,
malformed balances, underfunding, and wrong-chain rejection.

## Atomic replay remains an environment and data requirement

This workspace has no Docker, Podman, containerd/nerdctl, or `koinos-chain`
binary, no accessible container runtime socket, and no full production-state
database/checkpoint. The user-space inventory JSON and this attestation
cannot substitute for that database. `api.koinosai.com` returned HTTP 502
during this session, so no new raw-storage inventory was claimed.

The official [chain RPC schema](https://github.com/koinos/koinos-proto/blob/master/koinos/rpc/chain/chain_rpc.proto)
has no block/state selector in `read_contract` or `invoke_system_call` and
no full atomic state-export RPC. Recording head IDs before and after a scan
does not pin those reads or make them a replay. The official
[node distribution](https://github.com/koinos/koinos) runs the cooperating
chain services through Docker Compose; the
[chain implementation](https://github.com/koinos/koinos-chain) also supports
building the native runtime.

To close this remaining gate, a suitable isolated node environment must
receive a consistent checkpoint of the production state, including relevant
system state, contract code/metadata, token balances/allowances and router/pool
storage. Record its node versions, checkpoint hash and block/state identity;
prove the restored state matches the captured production obligations; then
run the reviewed uploads and action/failure sequences against that isolated
runtime. Preserve the actual receipts, resource use and before/after state.
An account-level JSON scan, a new synthetic testnet deployment, or another
simulated-WASM run does not close this requirement. Do not modify or stop a
live node merely to run this attestation.
