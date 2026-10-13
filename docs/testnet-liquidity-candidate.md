# Isolated liquidity-remainder candidate rehearsal

This runner tests the unapproved CR-01 candidate on Harbinger at a fresh
launchpad address. It never uploads to or calls mutation methods on the
original launchpad, token, router or pool. It uses the existing disposable
owner/buyer and official-source pool, and pays transaction Mana through the
existing test payer. No payer token-funding operation exists.

The production candidate must remain exactly SHA-256
`d6bcf48764ff2fa2ab42050af600a881ed5fe363843ed4c9ba53d148c6a3309d`.
Initialization verifies the candidate manifest's source hashes and production
artifact, reproduces that production hash with the rehearsal compiler, then
builds the test artifact with only the native KOIN and router address
substitutions. The original checkpoint, code and journal are read only.

Run only after other rehearsal transactions and keeper LP claims have
finished. These tests share the disposable wallets and pool with that work;
there must be one transaction writer at a time.

```sh
node --test scripts/testnet-liquidity-candidate.test.js
node scripts/testnet-liquidity-candidate.js init /absolute/path/to/original/.testnet-native
node scripts/testnet-liquidity-candidate.js run
```

`init` performs local builds and read-only network attestation, generates
one new launchpad key, and sends no transactions. It refuses an existing
candidate directory. Private state lives in ignored `.testnet-liquidity/`.
Preserve this directory and never publish `keys.json` or `state.json`.

The runner prints a waiting time for each actual 90-second LP lock. Once
the testnet block timestamp reaches that time, continue with:

```sh
node scripts/testnet-liquidity-candidate.js resume
```

Case 2 begins after case 1's claim completes and receives its own 90-second
window. A resume checks pending saved transaction IDs without blind
rebroadcasts. Never delete the journal or initialize another run to bypass
a pending/failed transaction. The narrow existing resource-rejection
reconciliation is available as `reconcile-resource LABEL` only when the
journal contains the exact qualifying rejection.

After all included transactions have become irreversible:

```sh
node scripts/testnet-liquidity-candidate.js finality
node scripts/testnet-liquidity-candidate.js report
```

`report` is offline and remains usable after the original seven-day reclaim.
Mutation commands refuse changed original checkpoint or ABI files, changed
candidate sources/manifest/artifact, mainnet, stale chain state, changed
dependency metadata or unexpected pair identity. `finality` only reads the
chain; it does not claim the pending LP work is complete simply because the
currently included transactions are irreversible.

## Expected assertions

Both launches sell 0.1 fixture token for 0.1 native tKOIN. Each reserves 50%
of the proceeds for the existing pool, whose native/base ratio must remain
exactly 1:2. Total new buyer spend is capped at **0.2 tKOIN**, including
pending journal reservations. Approval limits are 0.2 tKOIN from the buyer
and one fixture token from the creator.

| Case | Fixture token earmark | Native used | Fixture used | Returned to creator |
| --- | --- | --- | --- | --- |
| Excess fixture | 0.101 | 0.05 | 0.1 | 0.001 fixture |
| Excess native | 0.099 | 0.0495 | 0.099 | 0.0005 tKOIN |

The runner verifies exact creator returns, buyer/creator settlement amounts,
pool balances and reserves, zero candidate KOIN/fixture escrow, zero native
allowance from candidate to router, and exact LP minting from the pre-call
reserves and supply. It rejects unexpected protocol-fee growth rather than
guessing the LP amount. It then confirms delivery of LP to the recorded
creator after actual unlock, permissionless claiming by the buyer, and a
duplicate-claim rejection. Early rejection is attempted only with a useful
margin before the deadline. The fixture has no allowance reader, so no
on-chain assertion of its remaining allowance is claimed.

The original launch 3 record and all native/fixture/LP balances held by the
original launchpad are captured before the new test starts and must remain
unchanged through every stage.

## Public output

`.testnet-liquidity/report.json` contains addresses, artifact hashes, source
manifest identity, check statuses, schedules, before/after snapshots and
canonical receipt summaries. Signed transaction bodies and keys are omitted.
`mainnetReady` remains false. `finality.reached` refers only to the included
transactions recorded so far; every case must also show completed claims.
The original seven-day test, full atomic production-state replay and
independent review retain their separately stated scope.
