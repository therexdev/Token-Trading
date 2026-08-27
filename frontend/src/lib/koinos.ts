import { Contract, Transaction, utils } from "koilib";
import type { SignerInterface } from "koilib";
import * as kondor from "kondor-js";
import { orderbookAbi } from "./abi";
import { createProvider } from "./rpcProvider";
import {
  ORDERBOOK_ADDRESS,
  REST_URL,
  TOKENS,
  RETIRED_ADDRESSES,
  type TokenConfig,
} from "../config/tokens";
import {
  type MarketInfo,
  type OrderInfo,
  type TradeInfo,
} from "./types";
import { parseUnits } from "./format";
import { getSessionSigner } from "./sessionKey";

// Fails over across all configured endpoints (see rpcProvider).
export const provider = createProvider();

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

export interface KondorAccount {
  address: string;
  name?: string;
}

export async function connectKondor(): Promise<KondorAccount[]> {
  const accounts = await Promise.race([
    kondor.getAccounts(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Kondor did not respond. Unlock the extension and try again.")), 120000)
    ),
  ]);
  return (accounts as { address: string; name?: string }[])
    .filter((account) => !!account && !!account.address)
    .map((account) => ({ address: account.address, name: account.name }));
}

export function getKondorSigner(address: string): SignerInterface {
  return kondor.getSigner(address) as unknown as SignerInterface;
}

/**
 * The signer for `address`, whichever way the user signed in.
 *
 * A Google session holds the key in this tab, so it signs locally; everything
 * else goes to Kondor. Matching on the address rather than a stored flag means
 * a stale session key can never sign for a Kondor account, or the reverse.
 */
export function getSignerFor(address: string): SignerInterface {
  const session = getSessionSigner();
  if (session && session.getAddress() === address) return session;
  return getKondorSigner(address);
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

// ---------------------------------------------------------------------------
// Dynamic token discovery (permissionless listings)
// ---------------------------------------------------------------------------

const TOKEN_META_STORAGE = "koinoskit-trade:token-meta:v1";

export interface ProbedTokenMeta {
  symbol: string;
  name: string;
  decimals: number;
  allowances: boolean;
}

function loadTokenMetaCache(): Record<string, ProbedTokenMeta> {
  try {
    const raw = localStorage.getItem(TOKEN_META_STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveTokenMetaCache(cache: Record<string, ProbedTokenMeta>): void {
  try {
    localStorage.setItem(TOKEN_META_STORAGE, JSON.stringify(cache));
  } catch {
    // storage full/blocked: metadata is re-probed next load
  }
}

// addresses that failed probing this session — skipped on the periodic
// markets poll, retried on the next full page load
const failedProbes = new Set<string>();

/**
 * Read a token contract's metadata straight from the chain. Returns null
 * when the address does not answer like a token (no contract there, or a
 * retired system-locked one).
 */
export async function probeToken(
  address: string,
  fresh = false
): Promise<ProbedTokenMeta | null> {
  if (RETIRED_ADDRESSES.includes(address)) return null;
  if (!fresh && failedProbes.has(address)) return null;
  const contract = getTokenContract(address);
  try {
    const [symbolRes, decimalsRes] = await Promise.all([
      contract.functions.symbol(),
      contract.functions.decimals(),
    ]);
    const symbol = String(symbolRes.result?.value ?? "").trim();
    const decimals = Number(decimalsRes.result?.value);
    if (!Number.isFinite(decimals) || decimals < 0 || decimals > 18) {
      throw new Error("bad decimals");
    }
    let name = symbol;
    try {
      const { result } = await contract.functions.name();
      if (result?.value) name = String(result.value);
    } catch {
      // name() is optional
    }
    // KCS-4 allowance support decides whether escrow pulls need approve ops
    let allowances = true;
    try {
      await contract.functions.allowance({ owner: address, spender: address });
    } catch {
      allowances = false;
    }
    failedProbes.delete(address);
    return { symbol, name, decimals, allowances };
  } catch {
    failedProbes.add(address);
    return null;
  }
}

function colorFromAddress(address: string): string {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = (hash * 31 + address.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360}, 62%, 55%)`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export interface MarketsSnapshot {
  markets: MarketInfo[];
  /** curated tokens first, then every discovered token that trades */
  tokens: TokenConfig[];
  /** every pair on-chain (hidden ones included), for duplicate checks */
  allPairs: { base: string; quote: string }[];
}

export async function fetchMarkets(): Promise<MarketsSnapshot> {
  const contract = getOrderbookContract();
  const { result } = await contract.functions.get_markets({});
  const raw = ((result?.markets as any[]) || []).map((entry) => ({
    marketId: asNumber(entry.marketId ?? entry.market_id),
    baseAddress: String(entry.baseToken ?? entry.base_token ?? ""),
    quoteAddress: String(entry.quoteToken ?? entry.quote_token ?? ""),
    minBaseAmount: asBigInt(entry.minBaseAmount ?? entry.min_base_amount),
    lastPrice: asBigInt(entry.lastPrice ?? entry.last_price),
    tradeCount: asBigInt(entry.tradeCount ?? entry.trade_count),
    baseVolume: asBigInt(entry.baseVolume ?? entry.base_volume),
    quoteVolume: asBigInt(entry.quoteVolume ?? entry.quote_volume),
  }));

  // resolve every token address: curated config first, then the local
  // metadata cache, then live probes for addresses never seen before
  const registry = new Map<string, TokenConfig>();
  for (const token of TOKENS) registry.set(token.address, token);

  const cache = loadTokenMetaCache();
  const unknown: string[] = [];
  for (const entry of raw) {
    for (const address of [entry.baseAddress, entry.quoteAddress]) {
      if (!address || registry.has(address)) continue;
      if (RETIRED_ADDRESSES.includes(address)) continue;
      if (!unknown.includes(address)) unknown.push(address);
    }
  }

  const probed = await Promise.all(
    unknown.map(async (address) => {
      const meta = cache[address] || (await probeToken(address));
      return [address, meta] as const;
    })
  );

  // symbols key balances and the UI, so discovered ones must stay unique
  const taken = new Set(TOKENS.map((token) => token.symbol.toUpperCase()));
  let cacheDirty = false;
  for (const [address, meta] of probed) {
    if (!meta) continue;
    if (!cache[address]) {
      cache[address] = meta;
      cacheDirty = true;
    }
    const trimmed = (meta.symbol || "").slice(0, 12) || shortAddress(address);
    let symbol = trimmed;
    if (taken.has(symbol.toUpperCase())) symbol = `${trimmed}·${address.slice(-4)}`;
    if (taken.has(symbol.toUpperCase())) symbol = address;
    taken.add(symbol.toUpperCase());
    registry.set(address, {
      symbol,
      name: meta.name || symbol,
      address,
      decimals: meta.decimals,
      allowances: meta.allowances,
      color: colorFromAddress(address),
      dynamic: true,
    });
  }
  if (cacheDirty) saveTokenMetaCache(cache);

  const markets: MarketInfo[] = [];
  for (const entry of raw) {
    const base = registry.get(entry.baseAddress);
    const quote = registry.get(entry.quoteAddress);
    if (!base || !quote) continue; // unresolvable (retired/dead) — hidden
    markets.push({
      marketId: entry.marketId,
      base,
      quote,
      minBaseAmount: entry.minBaseAmount,
      lastPrice: entry.lastPrice,
      tradeCount: entry.tradeCount,
      baseVolume: entry.baseVolume,
      quoteVolume: entry.quoteVolume,
    });
  }
  // display order: rank by each token's position in TOKENS (KOIN first), so
  // the KOIN pairs lead; discovered pairs follow in listing order
  const rank = (symbol: string) => {
    const index = TOKENS.findIndex((token) => token.symbol === symbol);
    return index === -1 ? TOKENS.length : index;
  };
  markets.sort((a, b) => {
    const baseDiff = rank(a.base.symbol) - rank(b.base.symbol);
    if (baseDiff !== 0) return baseDiff;
    return rank(a.quote.symbol) - rank(b.quote.symbol);
  });

  const tokens = [
    ...TOKENS,
    ...[...registry.values()].filter((token) => token.dynamic),
  ];
  const allPairs = raw.map((entry) => ({
    base: entry.baseAddress,
    quote: entry.quoteAddress,
  }));
  return { markets, tokens, allPairs };
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
  owner: string,
  tokens: TokenConfig[] = TOKENS
): Promise<Record<string, bigint>> {
  const entries = await Promise.all(
    tokens.map(async (token) => {
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
  const signer = getSignerFor(owner);
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

// ---------------------------------------------------------------------------
// Permissionless market creation
// ---------------------------------------------------------------------------

/**
 * Mana estimate for create_market, in rc units (1e8 = 1 KOIN of mana).
 * Calibrated on mainnet receipts: past creations used 33–39M rc, growing
 * ~0.5M per existing market (the duplicate-pair scan), plus headroom for
 * the token probes the contract now performs.
 */
export function estimateCreateMarketMana(existingMarkets: number): bigint {
  return 50_000_000n + 700_000n * BigInt(existingMarkets);
}

/** available mana (rc) of an account, in 1e8 units like KOIN */
export async function fetchAvailableMana(owner: string): Promise<bigint> {
  return BigInt(await provider.getAccountRc(owner));
}

export async function createMarket(
  owner: string,
  baseToken: string,
  quoteToken: string,
  minBaseAmount: bigint
): Promise<TxHandle> {
  const orderbook = getOrderbookContract();
  return sendOperations(owner, [
    {
      pushTo: async (tx) => {
        await tx.pushOperation(orderbook.functions.create_market, {
          baseToken,
          quoteToken,
          minBaseAmount: minBaseAmount.toString(),
        });
      },
    },
  ]);
}
