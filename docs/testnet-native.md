# Native Harbinger KOIN extension

This extension tests the actual Harbinger KOIN system contract with disposable
orderbook, launchpad, buyer, creator, and sale-token accounts. It reuses only
the funded payer from the completed fixture rehearsal. `.testnet-native/`
contains separate private keys, transaction history, builds, and reports; the
original `.testnet-rehearsal/` checkpoint is retained unchanged.

## Coverage

- Resolve `koin` through a deployed test fixture's `System.getContractAddress`
  call and verify system-contract metadata on the pinned Harbinger chain.
- Fund the disposable buyer with at most 6 tKOIN and give bounded allowances.
- Create resting native-token orders, a refundable launch, a sold-out launch,
  and a launch with pending liquidity using historical code.
- Upgrade the same two test accounts and compare public records and balances.
- Reject unauthorized/duplicate cancellations, return native order escrow,
  roll back a native payment when the sale token fails, and fill successfully.
- Refund a canceled sale and settle native creator payouts and buyer tokens.
- Reject an early liquidity reclaim and retain exactly 0.5 tKOIN plus one
  fixture token until the real seven-day grace period elapses.
- After the due date, reject a wrong-owner reclaim, reclaim once to the
  recorded creator, reject a duplicate, and reconcile the remaining escrow.

The launchpad test build changes only its embedded payment-token and router
addresses. During the initial native stages, the router address is an unused
disposable account; those stages do not establish KoinDX integration. The
separate KoinDX continuation below deploys official-source code to that account.
The sale token remains a controlled fixture. Snapshot comparisons cover balances
and contract records, not token allowances. All reports retain `mainnetReady: false`.

## Run or restore

Use Node.js 22 or newer on `security/testnet-upgrade-rehearsal`. Install locked
dependencies in `scripts`, `contract`, and `launchpad`. A restored private
backup must preserve the complete directories, including every signed journal
entry and artifact. Never replace an existing journal with an empty one.

For a **new** isolated extension, after restoring the completed original
rehearsal:

```sh
npm run testnet:native:init
npm run testnet:native:run
```

Initialization refuses to overwrite an existing extension. For the already
started extension, use:

```sh
npm run testnet:native:resume
npm run testnet:native:report
```

`report` is offline. `resume` checks saved transaction IDs and never blindly
rebroadcasts pending transactions. Passed stages and persisted pre-mutation
verifications are retained. A transport error leaves the outcome unresolved;
do not regenerate accounts or remove the journal to bypass it.

Before the grace period has elapsed, the command records a `waiting` check
and exits. The exact date is in `report.json` as `reclaimDue`. Run `resume`
after that date; the command checks real testnet block time. No clock or
contract timing constant is shortened. The command is not a background
scheduler and does not automatically run later.

Each included transaction requires a canonical non-reverted receipt. The
final report re-reads all included receipts and reports irreversibility
separately. A successful submission alone does not pass a stage.

## Offline validation

```sh
npm run test:contracts
npm run test:native-runner
npm run verify:launchpad-provenance
```

To replay today's captured mainnet contract storage in the simulated host:

```sh
REHEARSAL_INVENTORY=docs/release-evidence/mainnet-2026-10-06-node.json npm run test:contracts
```

In PowerShell set `$env:REHEARSAL_INVENTORY` first, then run `npm run test:contracts`.
This remains simulated replay of contract storage, not a full real-node export.

## Official-source KoinDX continuation

This continuation requires all **nine initial native checks** to have passed.
The native seven-day reclaim may remain `waiting`. It preserves the native
accounts, journal, funding budget, and launch **3**, while adding one fresh pool
key and using launch **4** for the router/LP test. Never run the two live runners
concurrently: they share `.testnet-native/state.json` and its transaction journal.

The build uses these pinned official repositories:

| Contract | Repository | Commit |
| --- | --- | --- |
| Pool | `koindx/v2-core` | `2ac84216015dc54e007766787d57a06dbe3140b6` |
| Router | `koindx/v2-periphery` | `b4a73401bcf0aed293ec46ed6fba295b1830c507` |

The [source-build evidence](release-evidence/koindx-source-build-2026-10-06.json)
records the compiler, locked dependencies, generated ABI hashes, and bytecode
hashes. The compiled pool matches the upstream router's original bytecode pin;
neither contract's source logic is substituted. Builds require Linux x86_64
(including WSL), Node.js, Git, curl, unzip, and access to the pinned dependencies.
This evidence covers isolated Harbinger deployments; it does **not** attest the
live mainnet KoinDX deployment, deployed keeper service, browser wallet flows,
or independent security review.

For a new continuation, after the nine native checks pass:

```sh
npm run testnet:koindx:build
npm run testnet:koindx:init
npm run testnet:koindx:run
```

Build and initialize only once. Initialization adds the pool key without
replacing existing keys and refuses to replace an initialized continuation.
It pins the full build manifest. Preserve that manifest and its artifacts;
rebuilding after initialization changes the manifest and is rejected. For an
existing continuation, including one restored from its complete backup:

```sh
npm run testnet:koindx:resume
npm run testnet:koindx:report
```

The offline KoinDX report remains available after the separate seven-day native
reclaim completes. Live KoinDX continuation commands still require launch 3 to
remain unclaimed so they cannot invalidate its preservation checks.

The runner verifies a fresh pool account, atomically uploads its pinned bytecode
with the required authority hooks and calls `create_pair`, then verifies code
metadata and the recorded pair. Launch 4 uses **1 tKOIN from the existing buyer
funding**, deposits **0.5 tKOIN plus one fixture token** through the real router,
and verifies **70,700,678 raw LP units**. No additional buyer funding is transferred.
The upload resource cap is 10 tKOIN of Mana; ordinary calls remain capped at 5.

Launch 4's LP lock lasts **10 real minutes from its recorded creation schedule**.
The runner checks early rejection, records `waiting` when necessary, and exits.
Its separate `koindx-report.json` records `koindx.claimDue`; resume after that
time to verify delivery to the creator exactly once, even when another account
calls the claim. Launch 3 retains its independent **seven-day liquidity reclaim**
and original `reclaimDue`; complete it later with `testnet:native:resume`.
Neither command schedules itself. Never reinitialize, delete a journal, or
rebroadcast an unresolved transaction to bypass a waiting or incomplete check.
