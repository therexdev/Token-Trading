import type { TokenConfig } from "../config/tokens";

export interface MarketInfo {
  marketId: number;
  base: TokenConfig;
  quote: TokenConfig;
  minBaseAmount: bigint;
  lastPrice: bigint;
  tradeCount: bigint;
  baseVolume: bigint;
  quoteVolume: bigint;
}

export interface OrderInfo {
  id: bigint;
  marketId: number;
  side: number; // 0 buy, 1 sell
  price: bigint; // quote units per 1e8 base units
  quantity: bigint;
  remaining: bigint;
  escrow: bigint;
  owner: string;
  timestamp: number; // ms
}

export interface TradeInfo {
  seq: bigint;
  marketId: number;
  price: bigint;
  quantity: bigint;
  quoteAmount: bigint;
  takerSide: number;
  timestamp: number; // ms
  maker: string;
  taker: string;
  makerOrderId: bigint;
}

export interface BookLevel {
  price: bigint;
  quantity: bigint;
  cumulative: bigint;
  orders: number;
}

export interface MarketStats {
  lastPrice: bigint;
  change24h: number | null; // percent
  high24h: bigint | null;
  low24h: bigint | null;
  baseVolume24h: bigint;
  quoteVolume24h: bigint;
}

export const SIDE_BUY = 0;
export const SIDE_SELL = 1;
export const FLAG_GTC = 0;
export const FLAG_IOC = 1;
export const FLAG_POST_ONLY = 2;
