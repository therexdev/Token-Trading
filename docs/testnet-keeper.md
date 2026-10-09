# Actual keeper integration on isolated Harbinger contracts

This continuation executes the gateway's actual keeper, signing queue,
pre-submit Mana check, durable pending journal and canonical receipt helper
against the existing native-KOIN and official-source KoinDX test deployment.
It is a locally operated process, not evidence of a hosted gateway rollout.

The new launch is **5**. The runner does not operate on launch 3, whose
seven-day reclaim remains due October 13 at 15:45:51.590 UTC. It verifies
the exact launch-3 record before every keeper broadcast. The original
`.testnet-native` files are read-only inputs and are checked by hash.

## Bounded scenario

- Reuse only the existing disposable owner, buyer and funded sponsor.
- Contribute **0.1 tKOIN** from the buyer's existing balance; no new sponsor
  transfer or token mint is used.
- Sell 0.1 fixture token, reserve 0.1 fixture token for liquidity and lock
  another 0.1 fixture token for the creator.
- Let the actual keeper finalize, distribute, deposit 0.05 tKOIN plus
  0.1 fixture token into the already-created official pool, then deliver
  both the creator's token lock and LP tokens after the real ten-minute
  deadline.
- Verify exact balance changes and LP minting, no router residue, unchanged
  older escrow, and no further transaction on a subsequent idle cycle.
- Verify each transaction against canonical blocks and the irreversible
  height. A successful submission or a keeper log alone is insufficient.

## Restore and operate

Restore the private recovery backup; never commit its keys, signed setup
transaction or runtime files. Install locked `scripts` dependencies in this
repository and gateway dependencies in `therexdev/discover-koinos` on
`security/keeper-receipt-mana`. Run only one writer using this test sponsor.

The one-time setup is:

```sh
npm run testnet:keeper:setup
```

It refuses to replace an existing launch outside its journal, saves the
signed setup before broadcasting, caps resource use at 5 tKOIN of Mana,
and resumes an ambiguous transaction by checking its saved ID. A completed
setup is not repeated.

The gateway's `scripts/rehearse-keeper.js` accepts one absolute private
configuration path. See its `validateConfig` and the gateway's
`docs/keeper-safety.md` for the fields. The backup includes the configuration
and protected-launch record for this run. Adjust absolute filesystem paths
after restoring elsewhere; retain all chain/account/hash/amount pins.
The key file is read directly; never put keys on a command line.

```sh
node scripts/rehearse-keeper.js /absolute/path/to/config.json --check
node scripts/rehearse-keeper.js /absolute/path/to/config.json
```

Each invocation runs one cycle, then exits. It starts no timer. Its allowed
operations are only `finalize`, `process`, `provide_liquidity`,
`claim_locked` and `claim_liquidity` for the pinned new launch. Uploads,
native transfers, orderbook creation and another launch ID are rejected.
The existing pool is attested before use. Both source-derived contract
hashes and authorization flags are checked again before each broadcast.

After the final claims and an idle cycle, verify from this repository:

```sh
npm run testnet:keeper:verify
```

This requires exactly one of each keeper action, an empty pending journal,
exact owner/buyer/pool/escrow accounting and canonical irreversible receipts
for all six transactions including setup. If finality has not advanced,
wait and recheck; do not resubmit. Preserve the private report before any
later test intentionally changes the shared pool balances. Archived reports
describe their capture time, not an indefinitely unchanged live pool.

## Scope

This covers one buyer, an existing pool, actual native KOIN, and a controlled
sale token. Multi-batch settlement, unavailable Mana, malformed/orphaned
receipts, ambiguous submissions and pending restart recovery also have
offline regression coverage; this run does not pretend to reproduce every
failure on-chain. Fresh-pool creation was exercised separately on October 6.
Hosted keeper version/configuration, cross-process nonce coordination,
actual wallet signing, atomic production-state replay and independent
external review remain separate release requirements.

The launchpad in this run is the original pinned security candidate. The
new liquidity-remainder correction has a distinct artifact identity and
requires its own recorded tests.
