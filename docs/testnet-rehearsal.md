# Trade Koinos testnet upgrade rehearsal

This runner is for **Harbinger testnet only**. It creates disposable accounts, deploys the old contract versions, funds synthetic orders and launches with fixture tokens, upgrades those same test accounts, and exercises fifteen stages. Mainnet keys are neither needed nor accepted as input. No production source or deployment setting is changed.

## Current status — September 27, 2026

The original eleven contract security tests and thirteen new harness tests pass. The new runner's offline checks compile both old and patched contracts and execute all fifteen stages in a simulated WASM host, including recovery from a connection loss after transaction inclusion. **A successful simulation is not a Harbinger receipt or a real-node rehearsal.**

The Foundation RPC **`https://testnet.koinosfoundation.org/jsonrpc`** was verified and is the default. Its current chain ID is `EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==`. The older endpoints in the general documentation returned HTTP 502 from the preparation workspace and the documentation's example chain ID is outdated. The live preflight passed with a planning budget of 112 tKOIN of Mana; the generated payer is unfunded. No testnet transaction has been submitted yet.

## Setup on Windows PowerShell or Linux

Install Git and Node.js 22 or newer. Use a fresh checkout so these disposable accounts and test builds remain separate from production:

```powershell
git clone --branch security/testnet-upgrade-rehearsal https://github.com/therexdev/Token-Trading.git Trade-Koinos-Testnet
cd Trade-Koinos-Testnet
npm run testnet:setup
```

Setup installs the locked script/compiler dependencies, creates eight separate test accounts, and builds the rehearsal artifacts. It prints the **payer's public address**. It sends no transaction. Re-running setup retains the existing accounts and artifacts.

The local `.testnet-rehearsal/` directory contains the generated keys, state/journal, test builds, and public report. Git ignores the entire directory. Keep it in your private user directory; on Windows its protection also depends on your folder ACLs. Do not upload `keys.json` or `state.json`, and do not delete this directory during a run. `report.json` excludes private keys and signed transactions and is the file to share for review.

## Connect and fund

The verified Foundation RPC is used automatically:

```powershell
npm run testnet:check
```

To use another Harbinger service, set `$env:REHEARSAL_RPC = "https://YOUR-HARBINGER-RPC"` in PowerShell or `export REHEARSAL_RPC="https://YOUR-HARBINGER-RPC"` in Linux/WSL. For a node accessible only through SSH, forward its RPC to a local loopback port and use that local URL. The runner needs current chain/head information, account nonce/Mana, resource prices, contract reads/metadata, block bodies/receipts, and transaction submission.

The check rejects mainnet, mismatching chain IDs, stale heads, and missing receipt access. It pins the verified chain ID in the run state and checks it again before each new submission. The September 27 verified Harbinger ID is the default; if Harbinger resets again, obtain its current ID from a trusted operator and set `REHEARSAL_CHAIN_ID` **before the first successful check**. The runner will not automatically accept an unfamiliar network or change a run's existing chain ID.

After the check confirms Harbinger, send **tKOIN only** to the printed payer address. The check prints available Mana and a conservative planning budget based on live resource prices, artifact sizes, and an execution reserve. Re-run the check after funding. Funding only the payer is sufficient: it signs and pays for the other disposable accounts' transactions. The fixture tokens used for trades and launches are minted by the runner and have no monetary value.

The [official testnet documentation](https://docs.koinos.io/developers/testnet/) describes the Discord `#faucet` command `!faucet YOUR_PUBLIC_PAYER_ADDRESS`. You can also send tKOIN from an existing test wallet. The faucet's ordinary grant may be below the full deployment budget; use the amount printed by the live check. No mainnet KOIN is required.

## Run and inspect results

```powershell
npm run testnet:run
```

The runner deploys fixtures and historical code, creates three resting orders and four launches, and upgrades in place. It then verifies:

- Identical public state and fixture balances immediately before and after the upgrade.
- Order owner/admin checks; failed refunds and callback attacks; successful retry; duplicate cancellation rejection.
- Partial and complete fills of pre-upgrade orders; post-only rejection; multiple sequential operations in one transaction.
- Pending launch refunds, failed/callback finalization, retry, and single fixed-sale payout.
- Preserved token and LP locks, early-claim rejection, failed/callback LP transfers, correct beneficiary, and duplicate-claim rejection.
- Proportional pool payouts and final reconciliation of launch obligations and remaining order escrow.

The test sale/lock window is thirty minutes from scenario creation. Early claims are checked immediately after the upgrade. The runner waits for actual testnet block time to reach the unlock date; independent balance reads run in batches of five. RPC requests allow sixty seconds and use unique response IDs, while transaction submissions are never automatically retried. An interrupted or unusually slow run can miss the early-claim window; that check then remains incomplete and requires a new properly timed rehearsal. It is never silently marked passed.

Every transaction is signed and journaled before submission. Success requires a matching receipt in a canonical block. Expected rejection is recorded distinctly as a node rejection or a reverted receipt; a network error is not an expected contract rejection. Finality is reported separately from inclusion. Actual resource usage is retained in receipt evidence.

Each transaction now requests at most 20 tKOIN of Mana. Requesting the payer's full remaining balance can collide with pending resource reservations even when the payer has enough Mana for the operation.

After each upload, a read-only fixture method reads the account's on-chain metadata and verifies its code hash and authorization flags. This uses the ordinary `chain.read_contract` API because the Foundation RPC does not expose `chain.invoke_system_call`.

If a request times out:

```powershell
npm run testnet:resume
```

Resume checks the saved transaction ID and does **not** rebroadcast it. If the node never accepted it, or its outcome cannot be established, stop and reconcile that ID before attempting another operation. Completed steps are checkpointed. Do not delete the journal or start a second run as a workaround for an unresolved transaction.

For the specific node rejection `insufficient pending account resources` (code 104), the runner supports an explicit reconciliation command:

```sh
node scripts/testnet-rehearsal.js reconcile-resource TRANSACTION_LABEL
npm run testnet:resume
```

Reconciliation requires the starting block to be irreversible, no matching included receipt, no transaction-store record, and the payer's next nonce to equal the rejected transaction's nonce. Resume archives the original signed transaction and creates a replacement with the **same nonce** and a different resource limit. Changed nonces, transport timeouts, known transactions, and other errors do not qualify. This path does not turn a rejected attempt into a passed security check.

To regenerate the shareable report without submitting anything:

```powershell
npm run testnet:report
```

## What this rehearsal does and does not establish

The orderbook binaries reproduce the exact pinned old and patched mainnet hashes. Launchpad embeds mainnet KOIN and KoinDX addresses, so its test builds replace **only those two constants**, in separate generated source directories, with controlled payment/router fixture addresses. Hashes and original/test source digests are recorded. Production files and artifacts are never overwritten.

The router fixture implements the calls needed to exercise approvals, liquidity escrow, callback rejection, and LP delivery. It is not KoinDX and does not reproduce its pricing or keeper deployment. Historical launchpad source is pinned to `9b3fdbf`; exact historical mainnet binary provenance remains a separate item in the release requirements.

Therefore even a fully passing Harbinger report has `mainnetReady: false`. Remaining coverage includes exact production launchpad bytes against exported state, actual native-token/KoinDX/keeper integration, wallet flows, and the seven-day liquidity reclamation path. Independent review and fresh mainnet state/authority verification also remain necessary before production deployment.

For local/CI verification of the harness without a funded chain:

```sh
npm run test:contracts
npm --prefix scripts run test:rehearsal
```

These commands label the simulated host explicitly and cannot broadcast to a public network.
