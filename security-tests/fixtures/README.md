# Historical mainnet WASM fixtures

These binaries were downloaded using read-only RPC storage calls on September 25, 2026. They are the live **pre-security-patch** code, retained only to compare public reads against the patched code using the same captured storage. Do not deploy these fixtures.

| Fixture | Mainnet contract | SHA-256 |
| --- | --- | --- |
| `orderbook-mainnet-before-security.wasm` | `1Bke72aGbpq4brDY3m1UQxRCGBB9GPTJQz` | `c6035b2c5e4a9b341180737c2c199c0e6f7378f78c5a5cbd8691318fb20d3367` |
| `launchpad-mainnet-before-security.wasm` | `13akLV3xQZdRjdQ2ANYo7cvSsD8qfBZReV` | `2aa1b55a81eede98a55bffe5a7b9ff0c4908fef01a5b523ced3ab893d6ccf117` |

The bytecode was read from system object space 2, keyed by the decoded contract address. Its SHA-256 was checked against the contract metadata in system space 3. The orderbook binary also matches the tracked artifact at repository commit `9b3fdbfed4ac348c8ea8e2e34b82623f719b3975`. Exact source provenance for the historical launchpad binary has not been independently established.

The matching storage capture is `docs/release-evidence/mainnet-2026-09-25-node.json`. Tests assert the historical hashes before instantiating these fixtures. The test host simulates external tokens, authority checks, and atomic rollback; it does not prove real-node execution, resource costs, or transaction acceptance. See `docs/contract-upgrade-readiness.md` for remaining release gates.
