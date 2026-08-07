import type { TradeInfo, MarketInfo, MarketStats, BookLevel, OrderInfo } from "./types";
import { priceToNumber, formatUnits } from "./format";

export interface Candle {
  time: number; // unix seconds (bucket start)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // base tokens
}

export const INTERVALS: { label: string; seconds: number }[] = [
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3600 },
  { label: "4h", seconds: 14400 },
  { label: "1d", seconds: 86400 },
];

/** build OHLCV candles from trades (any order), oldest candle first */
export function buildCandles(
  trades: TradeInfo[],
  market: MarketInfo,
  intervalSeconds: number
): Candle[] {
  if (!trades.length) return [];
  const sorted = [...trades].sort((a, b) =>
    a.timestamp === b.timestamp
      ? Number(a.seq - b.seq)
      : a.timestamp - b.timestamp
  );
  const buckets = new Map<number, Candle>();
  const baseDec = market.base.decimals;
  const quoteDec = market.quote.decimals;

  for (const trade of sorted) {
    if (!trade.timestamp) continue;
    const seconds = Math.floor(trade.timestamp / 1000);
    const bucket = Math.floor(seconds / intervalSeconds) * intervalSeconds;
    const price = priceToNumber(trade.price, baseDec, quoteDec);
    const volume = Number(formatUnits(trade.quantity, baseDec).replace(/,/g, ""));
    const candle = buckets.get(bucket);
    if (!candle) {
      buckets.set(bucket, {
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      });
    } else {
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
      candle.volume += volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

/** 24h stats derived from the trade history */
export function computeStats(
  trades: TradeInfo[],
  market: MarketInfo
): MarketStats {
  const now = Date.now();
  const dayAgo = now - 24 * 3600 * 1000;
  const inWindow = trades
    .filter((trade) => trade.timestamp >= dayAgo)
    .sort((a, b) =>
      a.timestamp === b.timestamp
        ? Number(a.seq - b.seq)
        : a.timestamp - b.timestamp
    );

  let high: bigint | null = null;
  let low: bigint | null = null;
  let baseVolume = 0n;
  let quoteVolume = 0n;
  for (const trade of inWindow) {
    if (high === null || trade.price > high) high = trade.price;
    if (low === null || trade.price < low) low = trade.price;
    baseVolume += trade.quantity;
    quoteVolume += trade.quoteAmount;
  }

  let change: number | null = null;
  if (inWindow.length > 0) {
    const first = inWindow[0].price;
    const last = inWindow[inWindow.length - 1].price;
    if (first > 0n) {
      change = (Number(last - first) / Number(first)) * 100;
    }
  }

  return {
    lastPrice: market.lastPrice,
    change24h: change,
    high24h: high,
    low24h: low,
    baseVolume24h: baseVolume,
    quoteVolume24h: quoteVolume,
  };
}

/** aggregate raw orders into price levels with cumulative depth */
export function aggregateLevels(
  orders: OrderInfo[],
  descending: boolean
): BookLevel[] {
  const byPrice = new Map<string, BookLevel>();
  for (const order of orders) {
    const key = order.price.toString();
    const level = byPrice.get(key);
    if (level) {
      level.quantity += order.remaining;
      level.orders += 1;
    } else {
      byPrice.set(key, {
        price: order.price,
        quantity: order.remaining,
        cumulative: 0n,
        orders: 1,
      });
    }
  }
  const levels = [...byPrice.values()].sort((a, b) => {
    if (a.price === b.price) return 0;
    const ascending = a.price < b.price ? -1 : 1;
    return descending ? -ascending : ascending;
  });
  let cumulative = 0n;
  for (const level of levels) {
    cumulative += level.quantity;
    level.cumulative = cumulative;
  }
  return levels;
}
