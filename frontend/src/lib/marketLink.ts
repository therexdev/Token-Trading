import type { MarketInfo } from "./types";

/**
 * Shareable market deep links.
 *
 * Markets are addressed in the URL hash so the links work on any static
 * host with no rewrite rules: #/market/<baseToken>_<quoteToken>. Tokens
 * are identified by contract address (canonical, what the app emits);
 * symbols are accepted too as a convenience for hand-written links, in
 * either order:
 *
 *   #/market/18tWNU..._19GYjD...   #/market/VHP_KOIN   #/market/koin_vhp
 */
export const MARKET_HASH_PREFIX = "#/market/";

interface TokenLike {
  address: string;
  symbol: string;
}

/** hash fragment identifying a market by its token contract addresses */
export function marketHash(market: MarketInfo): string {
  return `${MARKET_HASH_PREFIX}${market.base.address}_${market.quote.address}`;
}

/** absolute shareable URL for a market */
export function marketLink(market: MarketInfo): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${marketHash(market)}`;
}

function matchesToken(token: TokenLike, key: string): boolean {
  return (
    token.address === key ||
    token.symbol.toLowerCase() === key.toLowerCase()
  );
}

/** resolve a location.hash to a listed market, or null */
export function marketFromHash(
  hash: string,
  markets: MarketInfo[]
): MarketInfo | null {
  if (!hash.startsWith(MARKET_HASH_PREFIX)) return null;
  const pair = hash
    .slice(MARKET_HASH_PREFIX.length)
    .replace(/\/+$/, "")
    .split("_");
  if (pair.length !== 2) return null;
  const first = decodeURIComponent(pair[0].trim());
  const second = decodeURIComponent(pair[1].trim());
  if (!first || !second) return null;

  return (
    markets.find(
      (market) =>
        (matchesToken(market.base, first) &&
          matchesToken(market.quote, second)) ||
        (matchesToken(market.base, second) &&
          matchesToken(market.quote, first))
    ) || null
  );
}

/** reflect the market in the URL without growing the browser history */
export function writeMarketHash(market: MarketInfo): void {
  const hash = marketHash(market);
  if (window.location.hash === hash) return;
  const { pathname, search } = window.location;
  history.replaceState(null, "", `${pathname}${search}${hash}`);
}
