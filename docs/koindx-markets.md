# KoinDX markets

`https://app.tradekoinos.com/koindx/` opens KOIN/vETH. All tokens retain their actual tickers throughout the page, including vETH, vUSDT and vUSDC. vETH is Vortex's bridged ETH token on Koinos.

The KoinDX tab is independent of orderbook loading and configuration. Both the root build and the frontend deployment workflow produce a real `koindx/index.html`, with root-relative assets. Static hosts serve `/koindx` and `/koindx/` without a new backend or rewrite rule.

## Pair links

- Default: `/koindx/`
- Symbols: `/koindx/#/market/KOIN_vETH`
- Reverse direction: `/koindx/#/market/vETH_KOIN`
- Canonical: `/koindx/#/market/<base-contract>_<quote-contract>`
- Query alias: `/koindx/?pair=KOIN_vETH`

The dropdown and Copy pair link use canonical contract addresses, matching the orderbook's hash-link pattern. Unknown pairs never silently trade a different market. Ambiguous symbols require addresses. A token outside the KoinDX list can be opened by contract address; it must have a direct KOIN pool. Address links can identify other direct token pairs too.

## Data

The dropdown uses the official `https://tokens.koindx.com/mainnet.json` list, with the same list from `koindx/token-list` on GitHub as a second source. An explicitly labeled bundled snapshot keeps navigation available if both list services fail. Listing does not imply that a token has a funded direct pool. An absent pool, empty reserves or unverifiable metadata prevents trading.

Pool discovery and reserves are read from KoinDX's mainnet router (`17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s`) through the configured Koinos RPCs. The client verifies on-chain decimals and pool token ordering. Older pools can supply ordering through their initialization event. It never guesses reserve ordering from balances or alphabetical order. Native token router keys are `koin` and `vhp`, not contract addresses.

Candlesticks and volume are decoded from pool `core.sync_event` and `core.swap_event` receipts. Only irreversible, non-reverted swaps from the selected pool count. Transaction-store and block-store reads supply timestamps; undated events are excluded and flagged. Liquidity additions do not count as swaps. Chart prices are post-swap reserve ratios, not external prices. Volume is in the displayed quote token; weekly candles start Monday UTC.

Initial history reads at most four 100-record pages, stopping after covering 24 hours. Load older swaps retrieves more. Missing history coverage or block dates leaves 24h metrics unavailable rather than displaying misleading zeroes. Reserves and balances refresh every 15 seconds and recent history every 60 seconds while the tab is visible. Network requests have deadlines, failover and cancellation. Rapid pair/account changes discard stale results.

## Trading

Amounts, approvals, output calculations and slippage use bigint smallest units. The 0.25% constant-product fee matches the router. Each swap re-reads reserves and balance before signing, preserves the displayed minimum output, checks that the account and pair are still current, and prevents duplicate submissions. The receiving account is always the connected wallet. There is no unlimited approval.

Kondor receives the exact approval and `swap_tokens_in` operations in one transaction. KOIN Vault receives those same operations wrapped individually in its account's `execute_user`, which is required for legacy token contracts such as vETH that cannot parse passkey signatures directly. The existing Vault relay handles review, passkey signing and broadcasting; it can require the wallet's own mana for these general contract actions. No wallet backend changes or smart-contract deployments are part of this change.

## Verification

Run `npm test --prefix frontend` and `npm run build` from the repository root. KoinDX tests verify protobuf-encoded operations and receipts, both trade directions, Vault wrapping, exact amounts, precision limits, slippage, pool ordering, stale-account protection, candle aggregation, history filtering and links. Existing wallet/authentication tests remain included.

Desktop (1440px) and mobile (390px) Chromium checks passed with contract-encoded fixtures: default/inverse/direct links, dropdown selection, browser Back, malformed links, chart intervals, both wallet choices, a simulated Vault approval, and disabling swaps on RPC failure.

Public mainnet RPC endpoints returned HTTP 403 from the development environment. No real wallet transaction was submitted. Contract encoding and browser behavior are tested against fixtures, and a connected-wallet mainnet acceptance check remains necessary before considering real trading verified.

## Schema sources

- [KoinDX SDK ABIs and addresses](https://github.com/koindx/v2-sdk/tree/master/src)
- [KoinDX pool protobuf and event order](https://github.com/koindx/v2-core/tree/master/assembly)
- [KoinDX router](https://github.com/koindx/v2-periphery/tree/master/assembly)
- [KoinDX token list](https://github.com/koindx/token-list/blob/main/src/tokens/mainnet.json)

The bundled ABI's numeric swap-event fields use string uint64 values instead of the upstream erroneous ADDRESS annotation. The minimal account ABI is the same `execute_user` wire schema used by Koin Vault. These descriptors encode calls to existing contracts; this change does not deploy any contract.
