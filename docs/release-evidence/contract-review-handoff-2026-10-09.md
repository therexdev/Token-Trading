# Contract review handoff — October 9, 2026 UTC

This is an internal adversarial source review and test record, not an
independent external security audit. No mainnet transaction was submitted.

## Reviewed identity and scope

- Historical source baseline: `9b3fdbfed4ac348c8ea8e2e34b82623f719b3975`.
- Pinned security source: `d0298016557a4a3f9de01b3058ff3e4d5b6673bc`.
- Testing branch reviewed at `5adaf7e7c9090881a01d830510fe0557a39e8eff`.
  Both contract assembly trees still match the pinned security source exactly.
- Orderbook release SHA-256:
  `5a947b3e6dd3dbbeea80c2cb2400ab2eabecea5d33f5424b48f31d03c9333ac4`.
- Launchpad release SHA-256:
  `822c9203b85b5b37405092ec9b7ea3263e59deb9b1213cfb56029e91a65f92c2`.

The review examined authority checks, all public mutation dispatch paths,
external-call ordering, cross-method callbacks, sequential mutation handling,
rollback, amount and timestamp arithmetic, claim recipients, and state-layout
compatibility. `npm run test:contracts` passed all 22 production-WASM tests.
These tests use a simulated host; their pass is not a real-node rollback or
state-export attestation.

## Finding CR-01 — unused liquidity assets have no claim path

**Severity: Medium. Status: OPEN in the pinned release; corrected in a separate, unapproved candidate.** This is inherited
business logic, not a regression introduced by the reentrancy-lock changes.

`launchpad/assembly/Launchpad.ts`:

- Lines 958–965 allow the router to use less than the desired amounts, within
  the configured 2% tolerance.
- Lines 975–981 decode only `liquidity`, ignoring the already-declared
  `amount_a` and `amount_b` fields of `dex_add_liquidity_answer`.
- Lines 999–1002 mark the launch `LIQ_PROVIDED` without accounting for or
  refunding the difference.
- Lines 1008–1009 emit the original earmarked amounts as the deposit amounts.
- Lines 1087–1089 reject reclaim once the launch is `LIQ_PROVIDED`.

This is permitted behavior of the official router, not a dishonest-router
assumption. At periphery source commit
`b4a73401bcf0aed293ec46ed6fba295b1830c507`, `assembly/Periphery.ts` lines
224–245 calculate the optimal reserve ratio and may reduce one side. Lines
142–162 transfer only those selected amounts and return them in the answer.
The sources are pinned in the existing KoinDX build evidence.

A scratch reproduction executed the compiled production launchpad WASM with
the existing contract-test host extended to return such an answer and debit
exactly the reported assets. It created and funded a sale, finalized it,
distributed buyer tokens, provided liquidity, claimed the creator's locked
tokens, and claimed all LP tokens. Both cases retained an unclaimable asset:

| Desired deposit, raw units | Router consumption | Remaining in launchpad after all other claims |
| --- | --- | --- |
| 50 KOIN + 100 sale-token units | 50 KOIN + 99 sale-token units | 1 sale-token unit |
| 50 KOIN + 100 sale-token units | 49 KOIN + 100 sale-token units | 1 KOIN unit |

Both answers meet the contract's minima of 49 and 98. The launch has
`liquidity_state = 2` and `lp_claimed = true`. Further provide, reclaim,
locked-token claim, and LP claim calls reject. Buyer's 100 sale-token units
were delivered correctly. The example scales to economically meaningful
amounts; only raw units are shown to make the accounting explicit.

No theft, allowance exploit, or production loss was demonstrated. The direct
impact is stranded creator assets and overstated deposit events whenever an
existing pool consumes a partial earmark. The fresh-pool October 6 live test
uses the entire earmark, so it does not cover this case.

Recommended correction: decode and validate both consumed amounts against
the requested/minimum amounts, clear remaining router approvals, refund only
the exact unused amounts for this launch to its recorded creator, and emit
the actual deposit amounts. Preserve atomic rollback and the mutation lock
across all new external calls. A changed contract needs a separately identified
source revision and artifact hash; the existing evidence must not be relabeled
as testing the changed bytecode. Do not sweep the contract's pooled balances.

Acceptance coverage should include partial consumption of either side, exact
consumption, malformed/overlarge/under-minimum answers, allowance reset and
refund failures, callbacks during each new external call, and preservation
of another launch's escrow and outstanding buyer/locked-token obligations.
Include a pre-seeded pool on the real-node/testnet integration path.

## Review conclusions on the lock change

- All four orderbook and all nine launchpad mutating ABI methods acquire the
  persistent lock before validation, authority checks, or external calls.
  Read methods do not write state. Successful wrappers remove the lock, so
  sequential operations are not intentionally excluded.
- Existing owner/creator checks remain in place. Permissionless claim calls
  retain the recorded creator as recipient; arbitrary callers cannot choose
  another destination through the claim arguments.
- Lock state uses previously unused spaces 6 and 4. Existing protobuf fields,
  entry-point IDs, key encodings, and object spaces are unchanged by the lock
  patch. Captured mainnet public reads remain identical in the WASM tests.
- The unmodified seven-day boundary, denied creator authority, failed first
  and second reclaim transfers, nested callbacks, rollback and retry, and
  duplicate reclaim are covered by passing tests. The actual seven-day
  Harbinger result remains due October 13, 2026 at 15:45:51.590 UTC.
- `end_time + 604800000` is unchecked unsigned arithmetic, but no presently
  reachable overflow was demonstrated. For a launch that can accept KOIN at
  the present chain timestamp, the start-time and one-year duration checks
  constrain the end time to the current era. An extremely distant future
  start can pass creation but cannot accept contributions now. External review
  should still inspect timestamp assumptions and malformed legacy state.

No additional actionable defect was found in the reviewed lock delta. This
statement does not close CR-01 or certify all contract business logic.

## Handoff requirements for independent review

1. Review the exact final candidate, including the disposition of CR-01,
   signed-off source identity, reproducible toolchain, bytecode, ABI, and any
   differences from the hashes above.
2. Verify real Koinos authority/reversion semantics with token and authority
   callbacks, sequential operations in one transaction, and a later failing
   operation that must roll back earlier state and both contract locks.
3. Replay a trusted atomic production-state export on a real node, preserving
   all indexes, orders, counters, launch records, and the existing LP claim.
   Current-head RPC reads and a simulated host do not satisfy this requirement.
4. Attest the actual production router and native-token dependencies, and test
   pre-existing pool ratios, rounding, token transfer failures, permissionless
   settlement, allowances, and pool/token upgrade trust.
5. Exercise the deployed keeper and browser-wallet signing flows. Validate
   pending-transaction recovery, shared-payer coordination, finality, resource
   requirements, and monitoring under the deployed topology.
6. State the assumptions for permissionless/malicious tokens and privileged
   upgrade authorities. Interface conformance and a passing transfer receipt
   do not prove honest economics or protect against malicious future upgrades.

Independent review, exact real-node production-state replay, production
integration, the live seven-day check, and separately authorized release and
post-deployment attestation remain requirements.

## Candidate correction and current validation

The separate `security/liquidity-remainder-fix` branch corrects CR-01 without
editing `scripts/security-release.json`. Its candidate manifest is
[launchpad-liquidity-candidate-2026-10-09.json](launchpad-liquidity-candidate-2026-10-09.json).
The candidate is **not authorized for mainnet**. The unchanged preparation
script correctly rejects it against the original release pins.

The candidate uses both returned amounts, requires positive consumption no
larger than its earmark and no smaller than the requested minimum, clears both
router approvals, and returns exact unused amounts to the recorded creator.
The liquidity event records actual consumption. Published earmark fields,
existing storage layout, ABI, entry points, and the seven-day grace constant
are unchanged. The persistent lock covers the added external calls, and a
failure reverts the entire operation. Refunds never use the aggregate balance.

The release build is 39,286 bytes with SHA-256
`d6bcf48764ff2fa2ab42050af600a881ed5fe363843ed4c9ba53d148c6a3309d`.
The full existing production build (`npm run build --prefix launchpad`)
regenerated ABI/protobuf/dispatcher outputs, compiled, lowered, and verified
WebAssembly MVP successfully. It produced the same hash as a direct compile
of the committed generated sources. No generated source changes resulted.
The original artifact and `.testnet-native` journal were not changed.

All 40 production-WASM tests pass against both the September 25 and October 6
inventories, and all 11 audit/preparation tests pass. This includes 18
additional WASM cases: exact and
partial consumption of both assets; event amounts and leftover approvals;
other pooled escrow and buyer/locked/LP claims; absent, malformed, omitted,
overlarge, below-minimum, zero-consumption and zero-LP answers; failures at
both approval resets and both refund transfers; callbacks on the new calls;
and rollback followed by retry. These are simulated-host results. Real native
KOIN and official-router candidate integration and independent review remain
open until separately evidenced.

The fixed contract prevents new leftover creation. It does not invent claims
for an already-provided historical launch whose original router consumption
was never stored. Any previously stranded amount requires separate historical
transaction accounting and an independently reviewed recovery decision; the
new logic must not sweep existing pooled funds.

## Subsequent live candidate evidence

The separate [Harbinger candidate run](harbinger-liquidity-candidate-2026-10-09.md)
now validates both real-router partial-consumption cases: unused sale tokens
and unused native KOIN return to the recorded creator, native allowance is
zero, original escrow is preserved and LP is delivered exactly once. The
linked JSON records each receipt and finality separately. This supplements
the frozen review manifest without changing its source or artifact hashes.
It closes these two targeted live integration cases, not the remaining
external-review, full-state replay, hosted deployment or release gates.
