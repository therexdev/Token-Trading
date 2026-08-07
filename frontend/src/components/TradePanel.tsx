import { useEffect, useMemo, useState } from "react";
import { useStore, useSelectedMarket } from "../store/useStore";
import {
  parseUnits,
  formatUnits,
  priceToContract,
  priceToHuman,
  quoteAmount,
  quoteEscrow,
  PRICE_SCALE,
  priceExponent,
} from "../lib/format";
import { SIDE_BUY, SIDE_SELL, FLAG_GTC, FLAG_IOC, FLAG_POST_ONLY } from "../lib/types";
import type { OrderInfo } from "../lib/types";
import { isKondorAvailable } from "../lib/koinos";

type OrderType = "limit" | "market";
type Tif = "gtc" | "ioc" | "post";

const SLIPPAGE_BPS = 100n; // 1% price protection on market orders

/** walk the opposite side of the book to price a market order */
function walkBook(
  orders: OrderInfo[],
  side: number,
  quantity: bigint
): { filled: bigint; cost: bigint; worstPrice: bigint } {
  const sorted = [...orders].sort((a, b) => {
    if (a.price === b.price) return 0;
    const ascending = a.price < b.price ? -1 : 1;
    // buys consume asks from the lowest price, sells consume bids from the highest
    return side === SIDE_BUY ? ascending : -ascending;
  });
  let remaining = quantity;
  let filled = 0n;
  let cost = 0n;
  let worstPrice = 0n;
  for (const order of sorted) {
    if (remaining <= 0n) break;
    const take = remaining < order.remaining ? remaining : order.remaining;
    filled += take;
    cost += quoteAmount(take, order.price);
    worstPrice = order.price;
    remaining -= take;
  }
  return { filled, cost, worstPrice };
}

/** how much base a quote budget can buy walking the asks */
function walkBookByBudget(asks: OrderInfo[], budget: bigint): bigint {
  const sorted = [...asks].sort((a, b) =>
    a.price === b.price ? 0 : a.price < b.price ? -1 : 1
  );
  let remainingBudget = budget;
  let amount = 0n;
  for (const order of sorted) {
    if (remainingBudget <= 0n) break;
    const levelCost = quoteAmount(order.remaining, order.price);
    if (levelCost <= remainingBudget) {
      amount += order.remaining;
      remainingBudget -= levelCost;
    } else {
      amount += (remainingBudget * PRICE_SCALE) / order.price;
      remainingBudget = 0n;
    }
  }
  return amount;
}

interface TradePanelProps {
  /** side preselected when the panel mounts (used by the mobile sheet) */
  initialSide?: number;
  /** called after an order lands on-chain (the mobile sheet closes itself) */
  onSubmitted?: () => void;
}

export function TradePanel({ initialSide, onSubmitted }: TradePanelProps = {}) {
  const market = useSelectedMarket();
  const account = useStore((state) => state.account);
  const connect = useStore((state) => state.connect);
  const balances = useStore((state) => state.balances);
  const bids = useStore((state) => state.bids);
  const asks = useStore((state) => state.asks);
  const submitOrder = useStore((state) => state.submitOrder);
  const prefillPrice = useStore((state) => state.prefillPrice);
  const setPrefillPrice = useStore((state) => state.setPrefillPrice);

  const [side, setSide] = useState<number>(initialSide ?? SIDE_BUY);
  const [orderType, setOrderType] = useState<OrderType>("limit");
  const [tif, setTif] = useState<Tif>("gtc");
  const [priceStr, setPriceStr] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [totalStr, setTotalStr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const baseDec = market?.base.decimals ?? 8;
  const quoteDec = market?.quote.decimals ?? 8;

  // reset the form when switching markets
  useEffect(() => {
    setPriceStr("");
    setAmountStr("");
    setTotalStr("");
  }, [market?.marketId]);

  // clicking a book level fills the price box
  useEffect(() => {
    if (prefillPrice !== null) {
      setOrderType("limit");
      setPriceStr(prefillPrice);
      setPrefillPrice(null);
    }
  }, [prefillPrice, setPrefillPrice]);

  // seed the price with the market's last price once known — unless a book
  // tap is about to prefill it (the sheet mounts with prefillPrice pending,
  // and both effects fire in the same commit)
  useEffect(() => {
    if (!market || priceStr || prefillPrice !== null) return;
    if (market.lastPrice > 0n) {
      setPriceStr(
        priceToHuman(market.lastPrice, baseDec, quoteDec, 12).replace(/,/g, "")
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.marketId, market?.lastPrice]);

  const parsed = useMemo(() => {
    if (!market) return null;
    let price: bigint | null = null;
    let amount: bigint | null = null;
    let error: string | null = null;

    try {
      if (priceStr.trim()) price = priceToContract(priceStr, baseDec, quoteDec);
    } catch (err: any) {
      error = err.message;
    }
    try {
      if (amountStr.trim()) amount = parseUnits(amountStr, baseDec);
    } catch {
      error = error || "invalid amount";
    }
    return { price, amount, error };
  }, [priceStr, amountStr, market, baseDec, quoteDec]);

  const oppositeBook = side === SIDE_BUY ? asks : bids;

  const marketEstimate = useMemo(() => {
    if (!market || orderType !== "market" || !parsed?.amount) return null;
    const { filled, cost, worstPrice } = walkBook(
      oppositeBook,
      side,
      parsed.amount
    );
    if (filled === 0n || worstPrice === 0n) return null;
    const limitPrice =
      side === SIDE_BUY
        ? (worstPrice * (10000n + SLIPPAGE_BPS)) / 10000n
        : (worstPrice * (10000n - SLIPPAGE_BPS)) / 10000n;
    return { filled, cost, worstPrice, limitPrice };
  }, [market, orderType, parsed?.amount, oppositeBook, side]);

  const effectivePrice =
    orderType === "market" ? marketEstimate?.limitPrice ?? null : parsed?.price ?? null;

  const total = useMemo(() => {
    if (!parsed?.amount || !effectivePrice) return null;
    if (orderType === "market" && marketEstimate) {
      return marketEstimate.cost;
    }
    return quoteAmount(parsed.amount, effectivePrice);
  }, [parsed?.amount, effectivePrice, orderType, marketEstimate]);

  const escrowNeeded = useMemo(() => {
    if (!parsed?.amount || !effectivePrice) return null;
    return side === SIDE_BUY
      ? quoteEscrow(parsed.amount, effectivePrice)
      : parsed.amount;
  }, [parsed?.amount, effectivePrice, side]);

  const baseBalance = market ? (balances[market.base.symbol] ?? 0n) : 0n;
  const quoteBalance = market ? (balances[market.quote.symbol] ?? 0n) : 0n;

  const applyPercent = (percent: number) => {
    if (!market) return;
    const factor = BigInt(Math.round(percent * 100));
    if (side === SIDE_SELL) {
      const amount = (baseBalance * factor) / 10000n;
      setAmountStr(formatUnits(amount, baseDec).replace(/,/g, ""));
      setTotalStr("");
      return;
    }
    const budget = (quoteBalance * factor) / 10000n;
    if (orderType === "market") {
      const amount = walkBookByBudget(asks, budget);
      setAmountStr(formatUnits(amount, baseDec).replace(/,/g, ""));
    } else if (parsed?.price && parsed.price > 0n) {
      const amount = (budget * PRICE_SCALE) / parsed.price;
      setAmountStr(formatUnits(amount, baseDec).replace(/,/g, ""));
      setTotalStr(formatUnits(budget, quoteDec).replace(/,/g, ""));
    }
  };

  const onTotalEdited = (value: string) => {
    setTotalStr(value);
    if (!market || !parsed?.price || parsed.price <= 0n) return;
    try {
      const totalUnits = parseUnits(value || "0", quoteDec);
      const amount = (totalUnits * PRICE_SCALE) / parsed.price;
      setAmountStr(formatUnits(amount, baseDec).replace(/,/g, ""));
    } catch {
      // ignore bad input while typing
    }
  };

  const onAmountEdited = (value: string) => {
    setAmountStr(value);
    setTotalStr("");
  };

  const validation = useMemo((): string | null => {
    if (!market) return "no market";
    if (!account) return null; // connect button takes over
    if (parsed?.error) return parsed.error;
    if (!parsed?.amount || parsed.amount <= 0n) return "enter an amount";
    if (orderType === "limit") {
      if (!parsed.price || parsed.price <= 0n) return "enter a price";
      if (quoteAmount(parsed.amount, parsed.price) <= 0n)
        return "order value rounds to zero";
    } else {
      if (oppositeBook.length === 0)
        return side === SIDE_BUY ? "no asks to buy from" : "no bids to sell into";
      if (!marketEstimate) return "not enough liquidity";
    }
    if (parsed.amount < market.minBaseAmount) {
      return `minimum order is ${formatUnits(market.minBaseAmount, baseDec)} ${market.base.symbol}`;
    }
    if (escrowNeeded !== null) {
      const balance = side === SIDE_BUY ? quoteBalance : baseBalance;
      if (escrowNeeded > balance) {
        return `insufficient ${side === SIDE_BUY ? market.quote.symbol : market.base.symbol} balance`;
      }
    }
    return null;
  }, [
    market,
    account,
    parsed,
    orderType,
    oppositeBook.length,
    marketEstimate,
    escrowNeeded,
    side,
    quoteBalance,
    baseBalance,
    baseDec,
  ]);

  const submit = async () => {
    if (!market || !account || !parsed?.amount || !effectivePrice || !escrowNeeded)
      return;
    setSubmitting(true);
    const flags =
      orderType === "market"
        ? FLAG_IOC
        : tif === "ioc"
          ? FLAG_IOC
          : tif === "post"
            ? FLAG_POST_ONLY
            : FLAG_GTC;
    const ok = await submitOrder({
      owner: account,
      market,
      side,
      price: effectivePrice,
      quantity: parsed.amount,
      flags,
      escrowAmount: escrowNeeded,
    });
    setSubmitting(false);
    if (ok) {
      setAmountStr("");
      setTotalStr("");
      onSubmitted?.();
    }
  };

  if (!market) return null;

  const isBuy = side === SIDE_BUY;
  const actionColor = isBuy ? "bg-up" : "bg-down";
  const escrowToken = isBuy ? market.quote : market.base;

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* side tabs */}
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-ink-600">
        <button
          onClick={() => setSide(SIDE_BUY)}
          className={`py-2.5 text-sm font-bold transition lg:py-2 ${
            isBuy ? "bg-up text-white" : "bg-ink-800 text-ink-400 hover:text-white"
          }`}
        >
          Buy {market.base.symbol}
        </button>
        <button
          onClick={() => setSide(SIDE_SELL)}
          className={`py-2.5 text-sm font-bold transition lg:py-2 ${
            !isBuy ? "bg-down text-white" : "bg-ink-800 text-ink-400 hover:text-white"
          }`}
        >
          Sell {market.base.symbol}
        </button>
      </div>

      {/* order type + tif */}
      <div className="flex items-center gap-2 text-xs">
        <div className="flex overflow-hidden rounded border border-ink-600">
          {(["limit", "market"] as OrderType[]).map((type) => (
            <button
              key={type}
              onClick={() => setOrderType(type)}
              className={`px-3.5 py-1.5 capitalize transition lg:px-3 lg:py-1 ${
                orderType === type
                  ? "bg-ink-600 text-white"
                  : "bg-ink-850 text-ink-400 hover:text-white"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
        {orderType === "limit" && (
          <select
            value={tif}
            onChange={(event) => setTif(event.target.value as Tif)}
            className="min-w-0 rounded border border-ink-600 bg-ink-850 px-2 py-1.5 text-base text-ink-300 outline-none lg:py-1 lg:text-xs"
            title="Time in force"
          >
            <option value="gtc">Good till cancelled</option>
            <option value="ioc">Immediate or cancel</option>
            <option value="post">Post only</option>
          </select>
        )}
        {orderType === "market" && (
          <span className="text-ink-400">1% price protection</span>
        )}
      </div>

      {/* balance */}
      <div className="flex justify-between text-[11px] text-ink-400">
        <span>Available</span>
        <span className="font-mono text-ink-300">
          {formatUnits(isBuy ? quoteBalance : baseBalance, isBuy ? quoteDec : baseDec, 6)}{" "}
          {isBuy ? market.quote.symbol : market.base.symbol}
        </span>
      </div>

      {/* price */}
      {orderType === "limit" ? (
        <label className="block">
          <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-400">
            Price ({market.quote.symbol} per {market.base.symbol})
          </div>
          <input
            value={priceStr}
            onChange={(event) => setPriceStr(event.target.value)}
            inputMode="decimal"
            placeholder="0.0"
            className="w-full rounded-md border border-ink-600 bg-ink-850 px-3 py-2.5 font-mono text-base text-white outline-none transition focus:border-accent lg:py-2 lg:text-sm"
          />
        </label>
      ) : (
        <div className="rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-[11px] text-ink-400">
          {marketEstimate ? (
            <>
              est. avg price{" "}
              <span className="font-mono text-white">
                {marketEstimate.filled > 0n
                  ? priceToHuman(
                      (marketEstimate.cost * PRICE_SCALE) / marketEstimate.filled,
                      baseDec,
                      quoteDec
                    )
                  : "—"}
              </span>{" "}
              · max{" "}
              <span className="font-mono text-white">
                {priceToHuman(marketEstimate.limitPrice, baseDec, quoteDec)}
              </span>
            </>
          ) : (
            "executes at the best available book price"
          )}
        </div>
      )}

      {/* amount */}
      <label className="block">
        <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-400">
          Amount ({market.base.symbol})
        </div>
        <input
          value={amountStr}
          onChange={(event) => onAmountEdited(event.target.value)}
          inputMode="decimal"
          placeholder="0.0"
          className="w-full rounded-md border border-ink-600 bg-ink-850 px-3 py-2.5 font-mono text-base text-white outline-none transition focus:border-accent lg:py-2 lg:text-sm"
        />
      </label>

      <div className="grid grid-cols-4 gap-1">
        {[25, 50, 75, 100].map((percent) => (
          <button
            key={percent}
            onClick={() => applyPercent(percent)}
            className="rounded border border-ink-600 bg-ink-850 py-1.5 text-xs text-ink-400 transition hover:border-accent hover:text-white lg:py-1 lg:text-[11px]"
          >
            {percent}%
          </button>
        ))}
      </div>

      {/* total */}
      {orderType === "limit" && (
        <label className="block">
          <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-400">
            Total ({market.quote.symbol})
          </div>
          <input
            value={
              totalStr ||
              (total !== null ? formatUnits(total, quoteDec).replace(/,/g, "") : "")
            }
            onChange={(event) => onTotalEdited(event.target.value)}
            inputMode="decimal"
            placeholder="0.0"
            className="w-full rounded-md border border-ink-600 bg-ink-850 px-3 py-2.5 font-mono text-base text-white outline-none transition focus:border-accent lg:py-2 lg:text-sm"
          />
        </label>
      )}

      {orderType === "market" && total !== null && (
        <div className="flex justify-between text-[11px] text-ink-400">
          <span>Est. {isBuy ? "cost" : "proceeds"}</span>
          <span className="font-mono text-ink-300">
            ≈ {formatUnits(total, quoteDec, 6)} {market.quote.symbol}
          </span>
        </div>
      )}

      {escrowNeeded !== null && account && (
        <div className="flex justify-between text-[11px] text-ink-400">
          <span>Locked in escrow</span>
          <span className="font-mono text-ink-300">
            {formatUnits(escrowNeeded, escrowToken.decimals, 6)} {escrowToken.symbol}
            {escrowToken.allowances ? " (with approval)" : ""}
          </span>
        </div>
      )}

      {/* submit */}
      {!account ? (
        isKondorAvailable() ? (
          <button
            onClick={connect}
            className="rounded-md bg-accent py-3 text-sm font-bold text-white transition hover:brightness-110 lg:py-2.5"
          >
            Connect Kondor to trade
          </button>
        ) : (
          <a
            href="https://chromewebstore.google.com/detail/kondor/ghipkefkpgkladckmlmdnadmcchefhjl"
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-accent py-3 text-center text-sm font-bold text-white transition hover:brightness-110 lg:py-2.5"
          >
            Install Kondor to trade
          </a>
        )
      ) : (
        <button
          onClick={submit}
          disabled={!!validation || submitting}
          className={`rounded-md py-3 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 lg:py-2.5 ${actionColor}`}
        >
          {submitting
            ? "Submitting…"
            : validation
              ? validation
              : `${isBuy ? "Buy" : "Sell"} ${market.base.symbol}`}
        </button>
      )}

      <div className="text-[10px] leading-relaxed text-ink-500">
        Funds are locked in the orderbook contract while the order is open and
        released on fill or cancel. Trades execute at the resting order's
        price.
      </div>
    </div>
  );
}
