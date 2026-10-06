# Gateway keeper source review — October 6, 2026

**Status: two keeper acceptance requirements remain open.** This is a source review with local, no-network reproductions. It does not establish the version deployed on the gateway, change that deployment, or claim a passing keeper integration rehearsal. The separate native-token and KoinDX contract runs do not close these requirements.

Reviewed repository: `therexdev/discover-koinos`, commit `fefcea144dc39beaa0e60a7e56361da63fd880a8` (`security/request-proofs-v2`). Source identities:

| File | Git blob |
| --- | --- |
| `tools/launchpad-keeper.js` | `22048170c556cba6e50ef59a9fe6e522885addda` |
| `tools/koinos.js` | `bfb2ea039379d7b90609bb62c264de5f01668265` |

## 1. The mana floor is checked after the first submission

The keeper's [mana check](https://github.com/therexdev/discover-koinos/blob/fefcea144dc39beaa0e60a7e56361da63fd880a8/tools/launchpad-keeper.js#L92-L103) defaults to a six-KOIN floor. However, [cycle()](https://github.com/therexdev/discover-koinos/blob/fefcea144dc39beaa0e60a7e56361da63fd880a8/tools/launchpad-keeper.js#L294-L309) calls `settleOne()` before checking that floor. An ended launch [submits finalize immediately](https://github.com/therexdev/discover-koinos/blob/fefcea144dc39beaa0e60a7e56361da63fd880a8/tools/launchpad-keeper.js#L183-L201). Some later operations, including an unlocked-token claim followed by market/liquidity work, also lack a mana check between submissions.

**Observed reproduction:** the unmodified keeper module was evaluated with a stub chain, one ended launch, available mana `0`, and configured floor `6`. Calls occurred in this order: `read launches`, `build finalize`, `submit finalize`, `check mana: 0`. The stub submission was invoked once. No network or real transaction was involved.

**Required change and acceptance tests:** enforce the mana policy before each submission, including the first action and subsequent work on the same launch. Verify that insufficient or unreadable mana results in zero submissions; recharging resumes the same pending work; and a balance that falls below the floor after one action prevents the next action. Test a multi-batch payout and a completed launch with both a token claim and liquidity work, so the check cannot be satisfied only at cycle boundaries.

## 2. Transaction-store block references are treated as successful settlement

[`waitMined()`](https://github.com/therexdev/discover-koinos/blob/fefcea144dc39beaa0e60a7e56361da63fd880a8/tools/koinos.js#L417-L432) returns as soon as the transaction store lists a containing block. It does not inspect a canonical block or its transaction receipt. [`devTx()`](https://github.com/therexdev/discover-koinos/blob/fefcea144dc39beaa0e60a7e56361da63fd880a8/tools/koinos.js#L437-L458) then returns success, and the keeper logs settlement progress. The same helper is used by `sendAsAccount()` for pool creation. Consequently, a block reference alone can produce a success report without proving that execution succeeded on the canonical chain.

**Observed reproduction:** the exact `waitMined()` function from the pinned source was evaluated against a stub transaction store returning `containing_blocks: ["fixture-orphaned-block"]`. It immediately returned that block ID. Canonical-block and receipt reads numbered zero. The block name is a fixture label, not evidence of a real chain reorganization; the reproduction demonstrates the missing verification step.

**Required change and acceptance tests:** reconcile the saved transaction ID against the canonical block and its receipt, require a nonreverted execution before reporting settlement, and retain irreversible confirmation in the completed rehearsal evidence. Verify orphaned inclusion, reverted inclusion, missing receipts, transient RPC errors, and a broadcast whose response is lost. None may be reported as successful settlement. An ambiguous transaction must retain its original ID and avoid an automatic replacement until its outcome is reconciled. A successful case must verify both receipt outcome and expected launch/balance changes before later keeper work proceeds.

## Closing the keeper gate

Run these regressions against the gateway changes, then exercise its keeper against the isolated Harbinger launchpad and verified KoinDX router with canonical receipts and before/after balances. Restrict the test adapter to the new liquidity-test launch so it does not settle or alter the separate seven-day reclaim case. Record the exact keeper/helper commits and deployed configuration. `tools/koindx.js` currently hardcodes the mainnet router, so a test-router adaptation must be explicit and recorded; the production deployment remains a separate step.

No gateway code was edited, no gateway deployment was performed, and no live transaction was sent by this source-review work.

## Subsequent local fix and regression status

After the as-found review above, a separate gateway checkout and branch,
`security/keeper-receipt-mana`, implemented the two source fixes at commit
`de38225f7896abeac17b0114d84caa51219c3fd8`, based on default-branch commit
`d44a80ebcd19cc8ecdd3929c88620312b95c6c60`. The authentication branch/PR was
not changed. The keeper and helper blobs reviewed above are identical at
that default base.

The fix adds a live mana guard inside the signing queue before each keeper
submit, including nested market creation and every pool candidate. The
shared helper verifies canonical block membership and a matching
nonreverted receipt. A durable, chain/account-bound pending-ID journal
pauses all keeper submissions after an ambiguous outcome, survives
restart, and reconciles before reading fresh launch state. It does not
automatically rebroadcast or replace an unresolved transaction.

**Offline validation passed:** all existing gift and SMTP checks and 54
Node tests via `npm test`, including 41 keeper/receipt tests. Cases cover
first and subsequent mana checks, queue placement, pool-candidate retries,
orphaned/missing/reverted receipts, transient reads, lost replies,
restart persistence, and an unresolved launch blocking another launch
even when the original is absent from enumeration. Independent review
found no blocking issue within the documented keeper-only, single-process
scope. `git diff --check` passed.

**Live read-only compatibility check passed:** the new
`transactionOutcome` helper, using the pinned Harbinger provider, returned
`confirmed` for existing native-settlement transaction
`0x12205ba712ab1b2fe7467dba1ae50b2bf4be13cfdba29f473c323d64147a6aa2286c`
in canonical block `8986712`, ID
`0x122075f9202a6707cd57cf7582f4ddfa2c31a64fb7e6f1233a397137c96898fe0529`.
This checks real RPC response shapes against existing irreversible
rehearsal evidence; it sent no transaction and is not a keeper end-to-end
pass.

**Remaining limits and gate:** a nonce-wide no-replacement guarantee
requires one keeper process with exclusive use of its payer. Concurrent
processes and other gateway/wallet actions are not coordinated by this
keeper journal. Preserve the journal across deployments. A crash after
journaling but before broadcast deliberately requires operator
reconciliation; elapsed time alone cannot establish rejection. Canonical
confirmation is not irreversibility. The production router is unchanged.
The patch was committed locally without pushing or deploying during this
work; a deployed isolated keeper run with finality and balance/state
evidence remains open.
