# Harbinger contract upgrade rehearsal — September 29, 2026 (UTC)

**All 15 live stages passed.** All 30 included transactions were read back from the canonical chain after the final transaction became irreversible. Sixteen expected security rejections were recorded separately from successful inclusion.

Runner revision: `61ac73112038bd85b0c45126a80c866e4612aaab`. [Public JSON evidence](harbinger-rehearsal-2026-09-29.json) includes contract hashes, state snapshots, transaction IDs, receipts, expected rejection messages, and finality evidence. Private keys and signed transaction bodies are excluded.

## Network and deployed accounts

- RPC: `https://testnet.koinosfoundation.org/jsonrpc`
- Chain ID: `EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==`
- Payer: `14V1baBquUvN2jdRXaJdnAPXjDiFFjpWJL`
- Orderbook: `15sQqpFCKeZRFwDt2E7gTb32MyEXwpcDsE`
- Launchpad: `14mWQUDs7Co59buMVTqctgmjeRL7oLkF4a`
- Final included transaction height: **8,775,759**
- Last irreversible block at canonical verification: **8,775,767**
- Canonical readback completed: `2026-09-29T02:15:32.569Z`

The payer started with 200 tKOIN of available Mana. Included receipts recorded **11.97446696 tKOIN-equivalent Mana** used. Mana usage is resource consumption; this figure is not a transfer of tKOIN. The earlier 112 tKOIN figure was a conservative planning budget.

## Stage results

| Stage | Result |
| --- | --- |
| deploy historical contracts and controlled fixtures | Passed |
| fund test tokens and grant bounded allowances | Passed |
| create old-version resting orders | Passed |
| create old-version launches, refunds, and locked liquidity | Passed |
| upgrade both existing accounts without changing state | Passed |
| preserved token and LP locks reject early claims | Passed |
| reject unauthorized order cancellation and administration | Passed |
| failed order refund and callback leave escrow intact | Passed |
| existing orders fill and sequential operations release the lock | Passed |
| pending launch refunds settle exactly once | Passed |
| launch finalization rollback and callback rejection allow a retry | Passed |
| wait for real testnet block time to reach the unlock date | Passed |
| locked claims preserve beneficiary, rollback, and single payout | Passed |
| pool settlement preserves proportional payouts after upgrade | Passed |
| all launch obligations paid and remaining order escrow reconciles | Passed |

The before/after upgrade snapshots match exactly. Final launchpad base-token, quote-token, and LP-token balances are all zero. The orderbook retains exactly one base fixture token for the remaining resting order and zero quote fixture tokens. Pool liquidity assets remain in the controlled router fixture, as expected.

## Runner issues encountered and resolved

1. The public RPC exceeded the original timeout. Requests now allow sixty seconds, use unique response IDs with response matching, and avoid caching. Independent snapshot reads run in bounded groups. The lock window is thirty minutes, with early-claim checks immediately after upgrade.
2. The second fixture upload was explicitly rejected with pending-resource error 104 when its requested limit used almost all available Mana. New transactions cap the request at 20 tKOIN of Mana. The rejected ID was absent from canonical receipts and the transaction store after the starting block became irreversible; the payer nonce was unchanged. The replacement retained that same nonce, reduced the limit, and confirmed. Both attempts and reconciliation evidence remain in the journal/report.
3. Local build verification caught an intermediate artifact hash mismatch. Compiler input/output paths are now separate; artifact hashes are checked before upload. The deployed artifacts remained unchanged and matched their prepared hashes.

The original 11 contract regression tests and 16 runner tests passed. GitHub's contract and frontend checks passed on the runner revision above. Recovery tests cover ambiguous transport failures, explicit resource rejection, included transactions, changed nonces, and preservation of the rejected transaction record.

## Scope and remaining release requirements

Coverage uses synthetic positions and controlled token/router fixtures. Orderbook before/after binaries reproduce the pinned production release hashes. Launchpad builds replace only the embedded payment-token and router addresses with the rehearsal fixture addresses.

This evidence retains `mainnetReady: false`. Exact historical launchpad binary provenance and production-state export/replay, native KOIN/KoinDX/keeper integration, wallet flows, the seven-day liquidity reclamation path, and independent review remain open. This run does not constitute a full web/API authentication, CSRF, or upload-security audit.

No mainnet transaction was submitted by this rehearsal. Production release still requires the separately documented authority, artifact, state, and operator checks in [contract-upgrade-readiness.md](../contract-upgrade-readiness.md).
