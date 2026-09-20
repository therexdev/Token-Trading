import type { TokenConfig } from "../../config/tokens";

export const ROUTER = "17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s";
export const KOIN = "19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK";
export const VHP = "12Y5vW6gk8GceH53YfRkRre2Rrcsgw7Naq";
export const VETH = "1Tf1QKv3gVYLjq34yURSHw5ErTYbFjqTG";
export const UINT64_MAX = 18446744073709551615n;
export interface DexToken extends TokenConfig {
  key: string;
}
export interface DexPair {
  base: DexToken;
  quote: DexToken;
}
export interface Pool extends DexPair {
  address: string;
  baseIsA: boolean;
  reserveBase: bigint;
  reserveQuote: bigint;
  fetchedAt: number;
}
export interface SwapPoint {
  id: string;
  sequence: bigint;
  event: number;
  timestamp: number;
  price: number;
  volume: number;
  /** Base-token amount in its smallest units, preserved exactly from the event. */
  quantity: bigint;
  buy: boolean;
}
export interface HistoryPage {
  points: SwapPoint[];
  cursor: string | null;
  missingDates: boolean;
}
export interface DexCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export function tokenKey(address: string): string {
  return address === KOIN ? "koin" : address === VHP ? "vhp" : address;
}
export function tokenAddress(key: string): string {
  return key === "koin" ? KOIN : key === "vhp" ? VHP : key;
}
export function isAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{25,35}$/.test(value);
}
export function displaySymbol(token: DexToken): string {
  return token.symbol;
}
export function pairId(pair: DexPair): string {
  return `${pair.base.address}_${pair.quote.address}`;
}
export function pairHash(pair: DexPair): string {
  return `#/market/${pairId(pair)}`;
}
export function pairUrl(pair: DexPair): string {
  return `/koindx/${pairHash(pair)}`;
}
export function readPairKeys(hash: string, search = ""): [string, string] {
  const input =
    hash.replace(/^#\/(?:koindx\/)?(?:market\/)?/, "").replace(/\/+$/, "") ||
    new URLSearchParams(search).get("pair") ||
    "";
  if (!input) return ["KOIN", "vETH"];
  try {
    const parts = decodeURIComponent(input).split(/[\/_-]/);
    if (parts.length !== 2 || parts.some((p) => !p.trim())) throw new Error();
    return [parts[0].trim(), parts[1].trim()];
  } catch {
    throw new Error("This pair link is invalid. Select a market below.");
  }
}
export function resolveToken(
  key: string,
  tokens: DexToken[],
): DexToken | undefined {
  const exact = tokens.find((t) => t.address === key || t.key === key);
  if (exact) return exact;
  if (key.toUpperCase() === "ETH")
    return tokens.find((t) => t.address === VETH);
  const matches = tokens.filter(
    (t) => t.symbol.toLowerCase() === key.toLowerCase(),
  );
  if (matches.length > 1)
    throw new Error(
      "More than one token uses this symbol. Use its contract address in the link.",
    );
  return matches[0];
}
export function parseAmount(text: string, decimals: number): bigint {
  const value = text.trim();
  if (!/^\d*\.?\d+$/.test(value))
    throw new Error("Enter an amount greater than zero.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new Error(`This token supports up to ${decimals} decimal places.`);
  const amount = BigInt((whole || "0") + fraction.padEnd(decimals, "0"));
  if (amount <= 0n || amount > UINT64_MAX)
    throw new Error("Amount is outside the supported range.");
  return amount;
}
export function amountOut(
  amount: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint {
  if (amount <= 0n || amount > UINT64_MAX)
    throw new Error("Invalid input amount.");
  if (reserveIn <= 0n || reserveOut <= 0n)
    throw new Error("This pool has no liquidity.");
  if (reserveIn + amount > UINT64_MAX)
    throw new Error("Amount exceeds the pool limit.");
  return (amount * 9975n * reserveOut) / (reserveIn * 10000n + amount * 9975n);
}
export function minimumOut(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 1 || bps > 500)
    throw new Error("Choose slippage between 0.01% and 5%.");
  const minimum = (amount * BigInt(10000 - bps)) / 10000n;
  if (minimum <= 0n) throw new Error("Amount is too small to swap safely.");
  return minimum;
}
export function poolPrice(pool: Pool): number {
  return (
    (Number(pool.reserveQuote) / Number(pool.reserveBase)) *
    10 ** (pool.base.decimals - pool.quote.decimals)
  );
}
export function mergePoints(...groups: SwapPoint[][]): SwapPoint[] {
  return [
    ...new Map(groups.flat().map((p) => [p.id + ":" + p.event, p])).values(),
  ].sort(
    (a, b) =>
      a.timestamp - b.timestamp ||
      (a.sequence < b.sequence
        ? -1
        : a.sequence > b.sequence
          ? 1
          : a.event - b.event),
  );
}
export function buildDexCandles(
  points: SwapPoint[],
  seconds: number,
): DexCandle[] {
  const candles: DexCandle[] = [];
  // Unix epoch was Thursday. Weekly buckets start on Monday, UTC.
  const offset = seconds === 604800 ? 345600 : 0;
  for (const point of mergePoints(points)) {
    if (!(point.price > 0) || !Number.isFinite(point.price)) continue;
    const time =
      Math.floor((point.timestamp / 1000 - offset) / seconds) * seconds +
      offset;
    let candle = candles[candles.length - 1];
    if (!candle || candle.time !== time) {
      const open = candle?.close ?? point.price;
      candle = {
        time,
        open,
        high: Math.max(open, point.price),
        low: Math.min(open, point.price),
        close: point.price,
        volume: point.volume,
      };
      candles.push(candle);
    } else {
      candle.high = Math.max(candle.high, point.price);
      candle.low = Math.min(candle.low, point.price);
      candle.close = point.price;
      candle.volume += point.volume;
    }
  }
  return candles;
}
export function dayStats(
  points: SwapPoint[],
  complete: boolean,
  missingDates: boolean,
  now = Date.now(),
) {
  const sorted = mergePoints(points),
    cutoff = now - 86400000;
  const before = sorted.filter((p) => p.timestamp <= cutoff).pop();
  const recent = sorted.filter(
    (p) => p.timestamp > cutoff && p.timestamp <= now,
  );
  const covered = !missingDates && (complete || !!before);
  const last = sorted[sorted.length - 1];
  return {
    covered,
    count: recent.length,
    volume: covered ? recent.reduce((sum, p) => sum + p.volume, 0) : null,
    change:
      covered && before && last ? (last.price / before.price - 1) * 100 : null,
  };
}
