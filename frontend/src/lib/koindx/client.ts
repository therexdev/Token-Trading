import {
  Contract,
  Provider,
  Serializer,
  Transaction,
  utils,
  type Abi,
  type OperationJson,
} from "koilib";
import { RPC_URLS, NETWORK } from "../../config/tokens";
import { getSignerFor } from "../koinos";
import { getBioSigner } from "../bioWallet";
import tokenSnapshot from "./tokens.json";
import coreJson from "./core-abi.json";
import routerJson from "./periphery-abi.json";
import accountJson from "./account-abi.json";
import {
  ROUTER,
  KOIN,
  VHP,
  tokenAddress,
  tokenKey,
  isAddress,
  amountOut,
  minimumOut,
  type DexToken,
  type DexPair,
  type Pool,
  type SwapPoint,
  type HistoryPage,
} from "./model";

const coreAbi = coreJson as Abi,
  routerAbi = routerJson as Abi;
const coreSerializer = new Serializer(coreAbi.koilib_types!);
const urls = [...new Set([...RPC_URLS, "https://api.koinosblocks.com"])];
let preferred = urls[0];
export function assertMainnet() {
  if (NETWORK !== "mainnet")
    throw new Error("KoinDX markets are available on mainnet only.");
}
export async function dexRpc<T = any>(
  method: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<T> {
  assertMainnet();
  let failure: unknown;
  for (const url of [...new Set([preferred, ...urls])]) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const timer = setTimeout(cancel, 12000);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`Koinos node returned ${response.status}`);
      const body = await response.json();
      if (body.error)
        throw new Error(
          body.error.message || body.error.error || JSON.stringify(body.error),
        );
      if (!("result" in body))
        throw new Error("Koinos node returned an invalid response.");
      preferred = url;
      return body.result;
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  throw new Error(
    `Unable to read KoinDX data. ${failure instanceof Error ? failure.message : "Please retry."}`,
  );
}
function readProvider(signal?: AbortSignal) {
  const provider = new Provider(urls);
  provider.call = (method, params) => dexRpc(method, params, signal);
  return provider;
}
function contract(id: string, abi: Abi, signal?: AbortSignal) {
  return new Contract({ id, abi, provider: readProvider(signal) });
}

export function normalizeTokens(raw: unknown): DexToken[] {
  if (!Array.isArray(raw)) throw new Error("Token list is unavailable.");
  const seen = new Set<string>();
  return raw.flatMap((t: any) => {
    const key = tokenKey(String(t.address || "")),
      address = tokenAddress(key),
      decimals = Number(t.decimals);
    if (
      !isAddress(address) ||
      seen.has(address) ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 18 ||
      !t.symbol
    )
      return [];
    seen.add(address);
    return [
      {
        key,
        address,
        decimals,
        symbol: String(t.symbol).slice(0, 32),
        name: String(t.name || t.symbol).slice(0, 100),
        allowances: t.allowance !== false,
        color: "#4f8cff",
        dynamic: true,
      },
    ];
  });
}
export const fallbackTokens = normalizeTokens(tokenSnapshot.tokens);
export async function fetchTokens(
  signal?: AbortSignal,
): Promise<{ tokens: DexToken[]; fallback: boolean }> {
  assertMainnet();
  for (const url of [
    "https://tokens.koindx.com/mainnet.json",
    "https://raw.githubusercontent.com/koindx/token-list/main/src/tokens/mainnet.json",
  ]) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 8000);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error();
      const tokens = normalizeTokens((await response.json()).tokens);
      if (!tokens.some((t) => t.address === KOIN) || tokens.length < 2)
        throw new Error();
      return { tokens, fallback: false };
    } catch {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  return { tokens: fallbackTokens, fallback: true };
}
export async function readToken(
  address: string,
  signal?: AbortSignal,
): Promise<DexToken> {
  if (!isAddress(address))
    throw new Error(
      "Token not found. Select a token or use its contract address.",
    );
  const fn = contract(address, utils.tokenAbi, signal).functions;
  const [s, d] = await Promise.all([fn.symbol(), fn.decimals()]);
  const decimals = Number(d.result?.value),
    symbol = String(s.result?.value || "");
  if (!symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("Unable to verify token metadata.");
  return {
    address,
    key: tokenKey(address),
    symbol,
    name: symbol,
    decimals,
    allowances: true,
    color: "#4f8cff",
    dynamic: true,
  };
}
const orientations = new Map<string, [string, string]>();
const verifiedDecimals = new Map<string, number>();
async function verifyDecimals(token: DexToken, signal?: AbortSignal) {
  let decimals = verifiedDecimals.get(token.address);
  if (decimals === undefined) {
    const { result } = await contract(
      token.address,
      utils.tokenAbi,
      signal,
    ).functions.decimals();
    decimals = Number(result?.value);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
      throw new Error("Unable to verify token precision.");
    verifiedDecimals.set(token.address, decimals);
  }
  if (decimals !== token.decimals)
    throw new Error(
      "Token precision differs from the KoinDX list. Trading is paused until the list is corrected.",
    );
}
async function poolTokens(
  address: string,
  signal?: AbortSignal,
): Promise<[string, string]> {
  const cached = orientations.get(address);
  if (cached) return cached;
  let tokens: [string, string];
  try {
    const { result } = await contract(
      address,
      coreAbi,
      signal,
    ).functions.get_tokens();
    tokens = [String(result?.tokenA || ""), String(result?.tokenB || "")];
    if (!tokens.every(isAddress)) throw new Error();
  } catch {
    // Older pools expose their ordering only in the initialization receipt.
    // Never infer ordering from symbols, lexical order, or current balances.
    const history = await dexRpc(
      "account_history.get_account_history",
      {
        address,
        seq_num: "0",
        limit: "20",
        ascending: true,
        irreversible: true,
      },
      signal,
    );
    let found: [string, string] | undefined;
    for (const row of history.values || []) {
      if (row.trx?.receipt?.reverted) continue;
      for (const event of row.trx?.receipt?.events || []) {
        if (event.source !== address || event.name !== "core.initialize_event")
          continue;
        const data = await coreSerializer.deserialize(
          event.data,
          "core.initialize_event",
        );
        found = [
          tokenAddress(String(data.tokenA)),
          tokenAddress(String(data.tokenB)),
        ];
      }
    }
    if (!found?.every(isAddress))
      throw new Error(
        "Cannot verify this pool’s token ordering. Trading is paused.",
      );
    tokens = found;
  }
  orientations.set(address, tokens);
  return tokens;
}
export async function fetchPool(
  pair: DexPair,
  signal?: AbortSignal,
): Promise<Pool> {
  assertMainnet();
  if (pair.base.address === pair.quote.address)
    throw new Error("Select two different tokens.");
  await Promise.all([
    verifyDecimals(pair.base, signal),
    verifyDecimals(pair.quote, signal),
  ]);
  const { result } = await contract(
    ROUTER,
    routerAbi,
    signal,
  ).functions.get_pair({ tokenA: pair.base.key, tokenB: pair.quote.key });
  const address = String(result?.value || "");
  if (!isAddress(address))
    throw new Error(
      "No direct KoinDX pool exists for this pair. Select another market.",
    );
  const [tokens, reserves] = await Promise.all([
    poolTokens(address, signal),
    contract(address, coreAbi, signal).functions.get_reserves(),
  ]);
  const baseIsA = tokens[0] === pair.base.address;
  if (
    (baseIsA ? tokens[1] : tokens[0]) !== pair.quote.address ||
    (!baseIsA && tokens[1] !== pair.base.address)
  )
    throw new Error("Pool tokens do not match this market.");
  const a = BigInt(String(reserves.result?.reserveA || "0")),
    b = BigInt(String(reserves.result?.reserveB || "0"));
  return {
    ...pair,
    address,
    baseIsA,
    reserveBase: baseIsA ? a : b,
    reserveQuote: baseIsA ? b : a,
    fetchedAt: Date.now(),
  };
}
export async function readBalance(
  token: DexToken,
  owner: string,
  signal?: AbortSignal,
): Promise<bigint> {
  const { result } = await contract(
    token.address,
    utils.tokenAbi,
    signal,
  ).functions.balanceOf({ owner });
  if (result?.value == null) throw new Error("Balance is unavailable.");
  return BigInt(String(result.value));
}
export async function decodeHistory(
  values: any[],
  pool: Pool,
  dates: Map<string, number>,
): Promise<SwapPoint[]> {
  const points: SwapPoint[] = [];
  for (const row of values) {
    const receipt = row.trx?.receipt,
      id = row.trx?.transaction?.id;
    if (!receipt || receipt.reverted || !dates.has(id)) continue;
    let reserves: any = null;
    for (let i = 0; i < (receipt.events || []).length; i++) {
      const event = receipt.events[i];
      if (event.source !== pool.address) continue;
      if (event.name === "core.sync_event")
        reserves = await coreSerializer.deserialize(event.data, event.name);
      if (event.name !== "core.swap_event" || !reserves) continue;
      const swap = await coreSerializer.deserialize(event.data, event.name);
      const base =
        Number(pool.baseIsA ? reserves.reserveA : reserves.reserveB) /
        10 ** pool.base.decimals;
      const quote =
        Number(pool.baseIsA ? reserves.reserveB : reserves.reserveA) /
        10 ** pool.quote.decimals;
      const baseIn = BigInt(
        String((pool.baseIsA ? swap.amountInA : swap.amountInB) || "0"),
      );
      const baseOut = BigInt(
        String((pool.baseIsA ? swap.amountOutA : swap.amountOutB) || "0"),
      );
      const quoteIn = BigInt(
        String((pool.baseIsA ? swap.amountInB : swap.amountInA) || "0"),
      );
      const quoteOut = BigInt(
        String((pool.baseIsA ? swap.amountOutB : swap.amountOutA) || "0"),
      );
      if (base > 0 && quote > 0)
        points.push({
          id,
          sequence: BigInt(row.seq_num || "0"),
          event: i,
          timestamp: dates.get(id)!,
          price: quote / base,
          volume: Number(quoteIn + quoteOut) / 10 ** pool.quote.decimals,
          quantity: baseIn + baseOut,
          buy: baseOut > 0n,
        });
      reserves = null;
    }
  }
  return points;
}
export async function fetchHistory(
  pool: Pool,
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<HistoryPage> {
  const response = await dexRpc(
    "account_history.get_account_history",
    {
      address: pool.address,
      limit: "100",
      ascending: false,
      irreversible: true,
      ...(cursor != null ? { seq_num: cursor } : {}),
    },
    signal,
  );
  const values = response.values || [];
  if (!Array.isArray(values)) throw new Error("Price history is unavailable.");
  const ids = [
    ...new Set<string>(
      values
        .filter(
          (r: any) =>
            !r.trx?.receipt?.reverted &&
            r.trx?.receipt?.events?.some(
              (e: any) =>
                e.source === pool.address && e.name === "core.swap_event",
            ),
        )
        .map((r: any) => r.trx.transaction.id),
    ),
  ];
  const dates = new Map<string, number>();
  if (ids.length) {
    const transactions = await dexRpc(
      "transaction_store.get_transactions_by_id",
      { transaction_ids: ids },
      signal,
    );
    const blocksByTx = new Map<string, string>(
      (transactions.transactions || [])
        .filter((t: any) => t.containing_blocks?.length === 1)
        .map((t: any) => [t.transaction.id, t.containing_blocks[0]]),
    );
    const blockIds = [...new Set(blocksByTx.values())];
    if (blockIds.length) {
      const blocks = await dexRpc(
        "block_store.get_blocks_by_id",
        { block_ids: blockIds, return_block: true, return_receipt: false },
        signal,
      );
      const byBlock = new Map<string, number>(
        (blocks.block_items || []).map((b: any) => [
          b.block_id,
          Number(b.block?.header?.timestamp),
        ]),
      );
      for (const [id, block] of blocksByTx) {
        const timestamp = byBlock.get(block);
        if (timestamp && Number.isSafeInteger(timestamp))
          dates.set(id, timestamp);
      }
    }
  }
  const last = values.reduce(
    (min: bigint | null, row: any) =>
      min == null || BigInt(row.seq_num || "0") < min
        ? BigInt(row.seq_num || "0")
        : min,
    null,
  );
  return {
    points: await decodeHistory(values, pool, dates),
    cursor:
      values.length === 100 && last != null && last > 0n
        ? String(last - 1n)
        : null,
    missingDates: ids.some((id) => !dates.has(id)),
  };
}
export async function swapOperations(
  owner: string,
  pool: Pool,
  buy: boolean,
  input: bigint,
  minimum: bigint,
  vault: boolean,
): Promise<OperationJson[]> {
  assertMainnet();
  if (input <= 0n || minimum <= 0n)
    throw new Error("A positive input and minimum output are required.");
  const tokenIn = buy ? pool.quote : pool.base,
    tokenOut = buy ? pool.base : pool.quote;
  const operations: OperationJson[] = [];
  if (tokenIn.allowances) {
    operations.push(
      (
        await contract(tokenIn.address, utils.tokenAbi).functions.approve(
          { owner, spender: ROUTER, value: input.toString() },
          { onlyOperation: true },
        )
      ).operation!,
    );
  }
  operations.push(
    (
      await contract(ROUTER, routerAbi).functions.swap_tokens_in(
        {
          from: owner,
          receiver: owner,
          amountIn: input.toString(),
          amountOutMin: minimum.toString(),
          path: [tokenIn.key, tokenOut.key],
        },
        { onlyOperation: true },
      )
    ).operation!,
  );
  if (!vault) return operations;
  const account = new Contract({ id: owner, abi: accountJson as Abi });
  return Promise.all(
    operations.map(
      async (operation) =>
        (
          await account.functions.execute_user(
            { operation: operation.call_contract },
            { onlyOperation: true },
          )
        ).operation!,
    ),
  );
}
export async function submitSwap(
  owner: string,
  pool: Pool,
  buy: boolean,
  input: bigint,
  minimum: bigint,
  vault: boolean,
  stillCurrent: () => boolean,
): Promise<string> {
  const fresh = await fetchPool(pool);
  const balance = await readBalance(buy ? pool.quote : pool.base, owner);
  if (balance < input) throw new Error("Insufficient token balance.");
  const out = amountOut(
    input,
    buy ? fresh.reserveQuote : fresh.reserveBase,
    buy ? fresh.reserveBase : fresh.reserveQuote,
  );
  if (out < minimum)
    throw new Error(
      "The price changed beyond your slippage limit. Review the updated quote.",
    );
  const operations = await swapOperations(
    owner,
    fresh,
    buy,
    input,
    minimum,
    vault,
  );
  if (!stillCurrent())
    throw new Error("Wallet or market changed. Review your swap again.");
  if (vault) {
    const signer = getBioSigner(owner);
    if (!signer) throw new Error("Reconnect KOIN Vault to continue.");
    const result = await signer.sendTransaction({ operations });
    if (!result.transaction.id)
      throw new Error("The wallet did not return a transaction ID.");
    return result.transaction.id;
  }
  const provider = readProvider();
  const available = BigInt(await provider.getAccountRc(owner));
  const budget = (available * 8n) / 10n;
  if (budget <= 0n)
    throw new Error("Your wallet needs available mana to swap.");
  const rcLimit = (budget < 10000000000n ? budget : 10000000000n).toString();
  const tx = new Transaction({
    signer: getSignerFor(owner),
    provider,
    options: { rcLimit },
  });
  for (const operation of operations) await tx.pushOperation(operation);
  if (!stillCurrent())
    throw new Error("Wallet or market changed. Review your swap again.");
  const receipt = await tx.send();
  if (receipt?.reverted)
    throw new Error(
      receipt.logs?.join("; ") || "The swap was rejected by the chain.",
    );
  if (!tx.transaction?.id)
    throw new Error("The wallet did not return a transaction ID.");
  return tx.transaction.id;
}
export { minimumOut };
