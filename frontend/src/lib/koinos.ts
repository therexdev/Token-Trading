import { Contract, Provider, Transaction, utils } from "koilib";
import type { SignerInterface } from "koilib";
import * as kondor from "kondor-js";
import { orderbookAbi } from "./abi";
import {
  ORDERBOOK_ADDRESS,
  RPC_URL,
  REST_URL,
  TOKENS,
  tokenByAddress,
  type TokenConfig,
} from "../config/tokens";
import {
  type MarketInfo,
  type OrderInfo,
  type TradeInfo,
} from "./types";
import { parseUnits } from "./format";

export const provider = new Provider([RPC_URL]);

export function getOrderbookContract(signer?: SignerInterface): Contract {
  return new Contract({
    id: ORDERBOOK_ADDRESS,
    abi: orderbookAbi,
    provider,
    signer,
  });
}

export function getTokenContract(address: string): Contract {
  return new Contract({ id: address, abi: utils.tokenAbi, provider });
}

// ---------------------------------------------------------------------------
// Kondor wallet
// ---------------------------------------------------------------------------

export function isKondorAvailable(): boolean {
  return typeof (window as any).kondor !== "undefined";
}

export async function connectKondor(): Promise<string[]> {
  const accounts = await Promise.race([
    kondor.getAccounts(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Kondor did not respond. Unlock the extension and try again.")), 120000)
    ),
  ]);
  return (accounts as { address: string }[]).map((account) => account.address);
}

export function getKondorSigner(address: string): SignerInterface {
  return kondor.getSigner(address) as unknown as SignerInterface;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function asBigInt(value: unknown): bigint {
  if (value === undefined || value === null || value === "") return 0n;
  return BigInt(String(value));
}

function asNumber(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  return Number(String(value));
}

// the generated koilib descriptor uses camelCase field names; accept the
// snake_case variants too in case the ABI is ever regenerated differently
function mapOrder(raw: any): OrderInfo {
  return {
    id: asBigInt(raw.id),
    marketId: asNumber(raw.marketId ?? raw.market_id),
    side: asNumber(raw.side),
    price: asBigInt(raw.price),
    quantity: asBigInt(raw.quantity),
    remaining: asBigInt(raw.remaining),
    escrow: asBigInt(raw.escrow),
    owner: String(raw.owner || ""),
    timestamp: asNumber(raw.timestamp),
  };
}

function mapTrade(raw: any): TradeInfo {
  return {
    seq: asBigInt(raw.seq),
    marketId: asNumber(raw.marketId ?? raw.market_id),
    price: asBigInt(raw.price),
    quantity: asBigInt(raw.quantity),
    quoteAmount: asBigInt(raw.quoteAmount ?? raw.quote_amount),
    takerSide: asNumber(raw.takerSide ?? raw.taker_side),
    timestamp: asNumber(raw.timestamp),
    maker: String(raw.maker || ""),
    taker: String(raw.taker || ""),
    makerOrderId: asBigInt(raw.makerOrderId ?? raw.maker_order_id),
  };
}

export async function fetchMarkets(): Promise<MarketInfo[]> {
  const contract = getOrderbookContract();
  const { result } = await contract.functions.get_markets({});
  const markets: MarketInfo[] = [];
  for (const raw of (result?.markets as any[]) || []) {
    const base = tokenByAddress(String(raw.baseToken ?? raw.base_token ?? ""));
    const quote = tokenByAddress(
      String(raw.quoteToken ?? raw.quote_token ?? "")
    );
    if (!base || !quote) continue; // unknown listing, hide from the UI
    markets.push({
      marketId: asNumber(raw.marketId ?? raw.market_id),
      base,
      quote,
      minBaseAmount: asBigInt(raw.minBaseAmount ?? raw.min_base_amount),
      lastPrice: asBigInt(raw.lastPrice ?? raw.last_price),
      tradeCount: asBigInt(raw.tradeCount ?? raw.trade_count),
      baseVolume: asBigInt(raw.baseVolume ?? raw.base_volume),
      quoteVolume: asBigInt(raw.quoteVolume ?? raw.quote_volume),
    });
  }
  return markets;
}

export async function fetchOrderbook(
  marketId: number,
  limit = 60
): Promise<{ bids: OrderInfo[]; asks: OrderInfo[] }> {
  const contract = getOrderbookContract();
  const { result } = await contract.functions.get_orderbook({
    marketId,
    limit,
  });
  return {
    bids: ((result?.bids as any[]) || []).map(mapOrder),
    asks: ((result?.asks as any[]) || []).map(mapOrder),
  };
}

export async function fetchTrades(
  marketId: number,
  limit = 500
): Promise<TradeInfo[]> {
  const contract = getOrderbookContract();
  const { result } = await contract.functions.get_trades({
    marketId,
    limit,
  });
  return ((result?.trades as any[]) || []).map(mapTrade);
}

export async function fetchUserOrders(owner: string): Promise<OrderInfo[]> {
  const contract = getOrderbookContract();
  const orders: OrderInfo[] = [];
  let start = "0";
  // paginate, the contract caps each page at 200
  for (let page = 0; page < 5; page++) {
    const { result } = await contract.functions.get_user_orders({
      owner,
      start,
      limit: 200,
    });
    const batch = ((result?.orders as any[]) || []).map(mapOrder);
    orders.push(...batch);
    if (batch.length < 200) break;
    start = batch[batch.length - 1].id.toString();
  }
  return orders;
}

export async function fetchBalance(
  token: TokenConfig,
  owner: string
): Promise<bigint> {
  // system tokens (KOIN) cannot be read through read_contract in user mode;
  // the REST endpoint executes them with kernel privileges and returns a
  // human decimal string
  if (token.restName) {
    const response = await fetch(
      `${REST_URL}/v1/token/${token.restName}/balance/${owner}`
    );
    if (response.ok) {
      const payload = await response.json();
      if (payload && typeof payload.value === "string") {
        return parseUnits(payload.value, token.decimals);
      }
    }
    return 0n;
  }
  const contract = getTokenContract(token.address);
  const { result } = await contract.functions.balanceOf({ owner });
  return asBigInt(result?.value);
}

export async function fetchBalances(
  owner: string
): Promise<Record<string, bigint>> {
  const entries = await Promise.all(
    TOKENS.map(async (token) => {
      try {
        return [token.symbol, await fetchBalance(token, owner)] as const;
      } catch {
        return [token.symbol, 0n] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

/** fetch real decimals from chain, falling back to the static config */
export async function fetchTokenDecimals(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    TOKENS.map(async (token) => {
      try {
        const contract = getTokenContract(token.address);
        const { result } = await contract.functions.decimals();
        const value = Number(result?.value);
        return [token.symbol, Number.isFinite(value) && value >= 0 ? value : token.decimals] as const;
      } catch {
        return [token.symbol, token.decimals] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface TxHandle {
  id: string;
  wait: () => Promise<{ blockNumber?: number }>;
}

function extractError(error: any): string {
  if (error?.logs?.length) {
    const log = error.logs.find((line: string) => line.includes("orderbook:"));
    return log || error.logs[error.logs.length - 1];
  }
  if (typeof error?.message === "string") {
    try {
      const parsed = JSON.parse(error.message);
      if (parsed?.logs?.length) return parsed.logs.join("; ");
      if (parsed?.error) return String(parsed.error);
    } catch {
      // not json
    }
    return error.message;
  }
  return String(error);
}

async function sendOperations(
  owner: string,
  operations: { pushTo: (tx: Transaction) => Promise<void> }[]
): Promise<TxHandle> {
  const signer = getKondorSigner(owner);
  // request a modest rc limit instead of koilib's default (the account's
  // entire mana): the mempool reserves the full limit until a transaction
  // is included, which made a second order submitted right away fail with
  // "insufficient pending account resources"
  let rcLimit = "1000000000"; // 10 KOIN of mana, plenty for any order
  try {
    const available = BigInt(await provider.getAccountRc(owner));
    const budget = (available * 8n) / 10n;
    if (budget < BigInt(rcLimit)) rcLimit = budget.toString();
  } catch {
    // keep the default on transient RPC errors
  }
  const transaction = new Transaction({
    signer,
    provider,
    options: { rcLimit },
  });
  for (const operation of operations) {
    await operation.pushTo(transaction);
  }
  try {
    await transaction.send();
  } catch (error) {
    throw new Error(extractError(error));
  }
  const id = transaction.transaction?.id || "";
  return {
    id,
    wait: async () => {
      try {
        // poll our own RPC for confirmation. transaction.wait() would go
        // through the wait function Kondor attaches, which keeps a request
        // pending on the extension's message channel and wedges the next
        // popup at "Loading transaction..." until a browser restart
        const receipt = await provider.wait(id, "byBlock", 60000);
        return { blockNumber: (receipt as any)?.blockNumber };
      } catch {
        return {};
      }
    },
  };
}

export interface PlaceOrderParams {
  owner: string;
  market: MarketInfo;
  side: number;
  price: bigint; // contract price
  quantity: bigint; // base units
  flags: number;
  escrowAmount: bigint; // required escrow (quote for buys, base for sells)
}

export async function placeOrder(params: PlaceOrderParams): Promise<TxHandle> {
  const { owner, market, side, price, quantity, flags, escrowAmount } = params;
  const escrowToken = side === 0 ? market.quote : market.base;
  const orderbook = getOrderbookContract();
  const token = getTokenContract(escrowToken.address);

  const operations: { pushTo: (tx: Transaction) => Promise<void> }[] = [];

  if (escrowToken.allowances) {
    operations.push({
      pushTo: async (tx) => {
        await tx.pushOperation(token.functions.approve, {
          owner,
          spender: ORDERBOOK_ADDRESS,
          value: escrowAmount.toString(),
        });
      },
    });
  }

  operations.push({
    pushTo: async (tx) => {
      await tx.pushOperation(orderbook.functions.place_order, {
        owner,
        marketId: market.marketId,
        side,
        price: price.toString(),
        quantity: quantity.toString(),
        flags,
      });
    },
  });

  return sendOperations(owner, operations);
}

export async function cancelOrder(
  owner: string,
  orderId: bigint
): Promise<TxHandle> {
  const orderbook = getOrderbookContract();
  return sendOperations(owner, [
    {
      pushTo: async (tx) => {
        await tx.pushOperation(orderbook.functions.cancel_order, {
          orderId: orderId.toString(),
        });
      },
    },
  ]);
}
