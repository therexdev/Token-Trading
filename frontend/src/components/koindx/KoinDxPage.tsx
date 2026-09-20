import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../store/useStore";
import { EXPLORER_TX } from "../../config/tokens";
import { BIO_WALLET_API } from "../../lib/bioWallet";
import {
  formatUnits,
  formatPriceNumber,
  formatCompact,
  shortAddress,
} from "../../lib/format";
import {
  fallbackTokens,
  fetchTokens,
  fetchPool,
  readToken,
  readBalance,
  fetchHistory,
  submitSwap,
} from "../../lib/koindx/client";
import {
  KOIN,
  VETH,
  displaySymbol,
  pairId,
  pairUrl,
  readPairKeys,
  resolveToken,
  parseAmount,
  amountOut,
  minimumOut,
  poolPrice,
  mergePoints,
  dayStats,
  type DexPair,
  type Pool,
  type SwapPoint,
} from "../../lib/koindx/model";
import { DexChart } from "./DexChart";
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const openConnect = () => window.dispatchEvent(new Event("tk-open-connect"));
const inputClass =
  "w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-3 text-sm text-white outline-none focus:border-accent disabled:opacity-50";

export function KoinDxPage() {
  const [tokens, setTokens] = useState(fallbackTokens),
    [catalogFallback, setCatalogFallback] = useState(false);
  const [pair, setPair] = useState<DexPair | null>(null),
    [routeVersion, setRouteVersion] = useState(0),
    [routeError, setRouteError] = useState("");
  const [refresh, setRefresh] = useState(0),
    [pool, setPool] = useState<Pool | null>(null),
    [poolError, setPoolError] = useState(""),
    [poolLoading, setPoolLoading] = useState(false);
  const [points, setPoints] = useState<SwapPoint[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false),
    [historyError, setHistoryError] = useState(""),
    [historyLoaded, setHistoryLoaded] = useState(false),
    [missingDates, setMissingDates] = useState(false);
  const [balances, setBalances] = useState<{
      owner: string;
      pair: string;
      base: bigint;
      quote: bigint;
    } | null>(null),
    [balanceError, setBalanceError] = useState("");
  const [buy, setBuy] = useState(true),
    [amount, setAmount] = useState(""),
    [slippage, setSlippage] = useState("0.5");
  const [busy, setBusy] = useState(false),
    [swapError, setSwapError] = useState(""),
    [submitted, setSubmitted] = useState(""),
    [copied, setCopied] = useState(false),
    [custom, setCustom] = useState("");
  const account = useStore((s) => s.account),
    authMethod = useStore((s) => s.authMethod),
    pushToast = useStore((s) => s.pushToast);
  const id = pair ? pairId(pair) : "";
  const current = useRef({ id, account, authMethod });
  current.current = { id, account, authMethod };
  const mounted = useRef(true),
    historyAbort = useRef<AbortController | null>(null),
    historyReading = useRef(false),
    sending = useRef(false);
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void fetchTokens(controller.signal)
      .then((result) => {
        setTokens(result.tokens);
        setCatalogFallback(result.fallback);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setRouteError(errorText(error));
      });
    const route = () => setRouteVersion((v) => v + 1);
    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", route);
    return () => {
      mounted.current = false;
      controller.abort();
      historyAbort.current?.abort();
      window.removeEventListener("hashchange", route);
      window.removeEventListener("popstate", route);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setPair(null);
    setRouteError("");
    setPool(null);
    setPoolError("");
    setBalances(null);
    setPoints([]);
    setHistoryLoaded(false);
    setHistoryError("");
    setCursor(null);
    setAmount("");
    setBuy(true);
    setSwapError("");
    setSubmitted("");
    async function resolve() {
      const keys = readPairKeys(window.location.hash, window.location.search);
      const found = await Promise.all(
        keys.map(
          async (key) =>
            resolveToken(key, tokensRef.current) ||
            (await readToken(key, controller.signal)),
        ),
      );
      if (controller.signal.aborted) return;
      if (found[0].address === found[1].address)
        throw new Error("Select two different tokens.");
      setTokens((prev) => [
        ...prev,
        ...found.filter((t) => !prev.some((p) => p.address === t.address)),
      ]);
      const selected = { base: found[0], quote: found[1] };
      setPair(selected);
      history.replaceState(null, "", pairUrl(selected));
    }
    void resolve().catch((error) => {
      if (!controller.signal.aborted) setRouteError(errorText(error));
    });
    return () => {
      controller.abort();
      historyAbort.current?.abort();
    };
  }, [routeVersion]);
  useEffect(() => {
    if (!pair) return;
    const controller = new AbortController();
    let reading = false;
    async function load() {
      if (reading) return;
      reading = true;
      setPoolLoading(true);
      try {
        const result = await fetchPool(pair!, controller.signal);
        if (!controller.signal.aborted) {
          setPool(result);
          setPoolError("");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setPool(null);
          setPoolError(errorText(error));
        }
      } finally {
        if (!controller.signal.aborted) setPoolLoading(false);
        reading = false;
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [id, refresh]);
  useEffect(() => {
    setBalances(null);
    setBalanceError("");
    if (!pair || !account) return;
    const controller = new AbortController();
    let reading = false;
    async function load() {
      if (reading) return;
      reading = true;
      try {
        const [base, quote] = await Promise.all([
          readBalance(pair!.base, account!, controller.signal),
          readBalance(pair!.quote, account!, controller.signal),
        ]);
        if (!controller.signal.aborted) {
          setBalances({ owner: account!, pair: id, base, quote });
          setBalanceError("");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setBalances(null);
          setBalanceError(errorText(error));
        }
      } finally {
        reading = false;
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [id, account, refresh]);
  useEffect(() => {
    if (!pool) {
      setHistoryLoading(false);
      return;
    }
    const controller = new AbortController();
    historyAbort.current?.abort();
    historyAbort.current = controller;
    historyReading.current = false;
    async function load() {
      if (historyReading.current) return;
      historyReading.current = true;
      setHistoryLoading(true);
      try {
        let next: string | null = null,
          loaded: SwapPoint[] = [],
          missing = false;
        for (let page = 0; page < 4; page++) {
          const batch = await fetchHistory(pool!, next, controller.signal);
          loaded = mergePoints(loaded, batch.points);
          missing ||= batch.missingDates;
          next = batch.cursor;
          if (
            !next ||
            (loaded[0] && loaded[0].timestamp <= Date.now() - 86400000)
          )
            break;
        }
        if (!controller.signal.aborted) {
          setPoints(loaded);
          setCursor(next);
          setMissingDates(missing);
          setHistoryLoaded(true);
          setHistoryError("");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setHistoryError(errorText(error));
          setHistoryLoaded(false);
        }
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
        if (historyAbort.current === controller) historyReading.current = false;
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden && !sending.current) void load();
    }, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [pool?.address, id, refresh]);
  async function loadMore() {
    if (!pool || !cursor || historyReading.current) return;
    const controller = historyAbort.current;
    if (!controller || controller.signal.aborted) return;
    historyReading.current = true;
    setHistoryLoading(true);
    try {
      const batch = await fetchHistory(pool, cursor, controller.signal);
      if (!controller.signal.aborted) {
        setPoints((prev) => mergePoints(prev, batch.points));
        setCursor(batch.cursor);
        setMissingDates((prev) => prev || batch.missingDates);
        setHistoryError("");
      }
    } catch (error) {
      if (!controller.signal.aborted) setHistoryError(errorText(error));
    } finally {
      if (!controller.signal.aborted) setHistoryLoading(false);
      if (historyAbort.current === controller) historyReading.current = false;
    }
  }
  function navigate(next: DexPair) {
    if (!busy) {
      history.pushState(null, "", pairUrl(next));
      setRouteVersion((v) => v + 1);
    }
  }
  const markets = useMemo(() => {
    const koin = tokens.find((t) => t.address === KOIN),
      eth = tokens.find((t) => t.address === VETH);
    if (!koin) return [];
    const result: DexPair[] = eth ? [{ base: koin, quote: eth }] : [];
    for (const token of tokens)
      if (token.address !== KOIN && token.address !== VETH)
        result.push({ base: token, quote: koin });
    if (pair && !result.some((p) => pairId(p) === id)) result.push(pair);
    return result;
  }, [tokens, id]);
  const stats = dayStats(
    points,
    historyLoaded && cursor === null,
    missingDates || !historyLoaded,
  );
  const inputToken = pair && (buy ? pair.quote : pair.base),
    outputToken = pair && (buy ? pair.base : pair.quote);
  const balance =
    balances?.owner === account && balances?.pair === id
      ? buy
        ? balances.quote
        : balances.base
      : null;
  const quote = useMemo(() => {
    if (!pool || !inputToken || !amount) return null;
    try {
      const input = parseAmount(amount, inputToken.decimals),
        output = amountOut(
          input,
          buy ? pool.reserveQuote : pool.reserveBase,
          buy ? pool.reserveBase : pool.reserveQuote,
        );
      const minimum = minimumOut(output, Number(slippage) * 100);
      const ideal =
        (Number(input) * Number(buy ? pool.reserveBase : pool.reserveQuote)) /
        Number(buy ? pool.reserveQuote : pool.reserveBase);
      return {
        input,
        output,
        minimum,
        impact: Math.max(0, (1 - Number(output) / ideal) * 100),
        error: "",
      };
    } catch (error) {
      return {
        input: 0n,
        output: 0n,
        minimum: 0n,
        impact: 0,
        error: errorText(error),
      };
    }
  }, [pool, amount, buy, slippage, inputToken]);
  const insufficient = quote && balance != null && quote.input > balance;
  const canSwap =
    !!pool &&
    !!quote &&
    !quote.error &&
    !!account &&
    balance != null &&
    !insufficient &&
    !poolError &&
    !busy;
  async function trade() {
    if (!canSwap || !quote || !pool || !account || sending.current) return;
    const snapshot = { account, authMethod, id };
    sending.current = true;
    setBusy(true);
    setSwapError("");
    setSubmitted("");
    try {
      if (!useStore.getState().guardCanSign()) return;
      const txid = await submitSwap(
        account,
        pool,
        buy,
        quote.input,
        quote.minimum,
        authMethod === "bio",
        () =>
          mounted.current &&
          current.current.account === snapshot.account &&
          current.current.authMethod === snapshot.authMethod &&
          current.current.id === snapshot.id &&
          useStore.getState().account === snapshot.account,
      );
      pushToast({
        kind: "success",
        title: "KoinDX swap submitted",
        detail:
          "Your wallet submitted the swap. The chart updates after confirmation.",
        txId: txid,
      });
      if (mounted.current && current.current.id === id) {
        setSubmitted(txid);
        setAmount("");
        setRefresh((v) => v + 1);
      }
    } catch (error) {
      if (mounted.current) setSwapError(errorText(error));
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function copy() {
    if (!pair) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}${pairUrl(pair)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      pushToast({
        kind: "info",
        title: "Copy the pair link from your browser’s address bar",
      });
    }
  }
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-ink-900">
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-7 lg:px-10 lg:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
              KoinDX markets
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Explore. Chart. Swap.
            </h1>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <label className="min-w-0 flex-1 sm:min-w-[220px]">
              <span className="sr-only">Select KoinDX market</span>
              <select
                aria-label="Select KoinDX market"
                className={`${inputClass} font-semibold`}
                disabled={busy}
                value={id || ""}
                onChange={(e) => {
                  const next = markets.find(
                    (p) => pairId(p) === e.target.value,
                  );
                  if (next) navigate(next);
                }}
              >
                {!id && <option value="">Select a market</option>}
                {markets.map((p) => (
                  <option key={pairId(p)} value={pairId(p)}>
                    {displaySymbol(p.base)} / {displaySymbol(p.quote)} ·{" "}
                    {shortAddress(
                      p.base.address === KOIN
                        ? p.quote.address
                        : p.base.address,
                    )}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => void copy()}
              disabled={!pair}
              className="shrink-0 rounded-lg border border-ink-600 px-3 text-xs text-ink-300 hover:text-white"
            >
              {copied ? "Copied!" : "Copy pair link"}
            </button>
          </div>
        </div>
        {routeError && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-down/40 bg-down/10 p-4 text-sm text-down"
          >
            {routeError}
          </div>
        )}
        {catalogFallback && (
          <p className="mb-4 text-xs text-ink-300">
            Showing the bundled KoinDX token list. Live list updates are
            temporarily unavailable.
          </p>
        )}
        {pair && (
          <>
            <section
              className="mb-6 grid gap-5 border-y border-ink-700 py-6 lg:grid-cols-[1fr_auto_auto_auto] lg:gap-12"
              aria-label="Market statistics"
            >
              <div>
                <p className="mb-2 text-xs text-ink-300">
                  {pair.base.symbol} against {displaySymbol(pair.quote)}, priced
                  by the KoinDX pool
                </p>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-3xl font-light tracking-tight sm:text-4xl">
                    {pool && pool.reserveBase > 0n
                      ? formatPriceNumber(poolPrice(pool))
                      : "—"}
                  </span>
                  <span className="text-sm text-ink-300">
                    {displaySymbol(pair.quote)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-300">
                  {pool && pool.reserveBase > 0n && pool.reserveQuote > 0n
                    ? `1 ${displaySymbol(pair.quote)} buys ${formatPriceNumber(1 / poolPrice(pool))} ${pair.base.symbol} at pool price`
                    : poolLoading
                      ? "Reading pool reserves…"
                      : "Pool price unavailable"}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4 lg:contents">
                <Stat
                  label="24h change"
                  value={
                    stats.change == null
                      ? "—"
                      : `${stats.change >= 0 ? "+" : ""}${stats.change.toFixed(2)}%`
                  }
                  detail={
                    stats.covered
                      ? `${stats.count} swaps`
                      : "History incomplete"
                  }
                  color={
                    stats.change == null
                      ? ""
                      : stats.change >= 0
                        ? "text-up"
                        : "text-down"
                  }
                />
                <Stat
                  label="24h volume"
                  value={
                    stats.volume == null ? "—" : formatCompact(stats.volume)
                  }
                  detail={`${displaySymbol(pair.quote)} traded`}
                />
                <Stat
                  label="Pool holds"
                  value={
                    pool
                      ? `${formatCompact(Number(pool.reserveQuote) / 10 ** pair.quote.decimals)} ${displaySymbol(pair.quote)}`
                      : "—"
                  }
                  detail={
                    pool
                      ? `${formatCompact(Number(pool.reserveBase) / 10 ** pair.base.decimals)} ${pair.base.symbol}`
                      : "Reading reserves"
                  }
                />
              </div>
            </section>
            {poolError && (
              <div
                role="alert"
                className="mb-5 rounded-lg border border-down/30 bg-down/10 p-4 text-sm text-down"
              >
                {poolError}{" "}
                <button
                  className="ml-2 underline"
                  onClick={() => setRefresh((v) => v + 1)}
                >
                  Retry
                </button>
              </div>
            )}
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_350px]">
              <div className="min-w-0">
                <DexChart
                  points={points}
                  marketId={id}
                  loading={historyLoading || poolLoading}
                  error={historyError || poolError}
                  quote={displaySymbol(pair.quote)}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-300">
                  <span>
                    {points.length.toLocaleString()} confirmed swap price points
                    {missingDates ? " · Some block dates unavailable" : ""}
                  </span>
                  <button
                    className="text-accent disabled:opacity-40"
                    disabled={historyLoading || busy}
                    onClick={() => setRefresh((v) => v + 1)}
                  >
                    {historyLoading ? "Loading…" : "Refresh"}
                  </button>
                </div>
                {historyError && points.length > 0 && (
                  <p role="alert" className="mt-3 text-xs text-down">
                    History refresh failed. Showing previously loaded swaps.{" "}
                    {historyError}
                  </p>
                )}
                <section className="mt-6 overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
                  <div className="flex justify-between border-b border-ink-700 px-4 py-3">
                    <h2 className="text-sm font-semibold">Recent swaps</h2>
                    <span className="text-xs text-ink-300">
                      Confirmed on Koinos
                    </span>
                  </div>
                  <div className="max-h-[310px] overflow-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-ink-300">
                        <tr>
                          <th className="px-4 py-3 font-normal">Time (UTC)</th>
                          <th className="px-3 py-3 font-normal">Side</th>
                          <th className="px-3 py-3 text-right font-normal">
                            Price ({displaySymbol(pair.quote)})
                          </th>
                          <th className="px-4 py-3 text-right font-normal">
                            {pair.base.symbol}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...points]
                          .reverse()
                          .slice(0, 30)
                          .map((p) => (
                            <tr
                              key={`${p.id}:${p.event}`}
                              className="border-t border-ink-700/70"
                            >
                              <td className="whitespace-nowrap px-4 py-3">
                                <a
                                  className="text-ink-300 hover:text-accent"
                                  href={EXPLORER_TX(p.id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {new Date(p.timestamp)
                                    .toISOString()
                                    .slice(5, 16)
                                    .replace("T", " ")}{" "}
                                  ↗
                                </a>
                              </td>
                              <td
                                className={`px-3 py-3 ${p.buy ? "text-up" : "text-down"}`}
                              >
                                {p.buy ? "Buy" : "Sell"}
                              </td>
                              <td className="px-3 py-3 text-right font-mono">
                                {formatPriceNumber(p.price)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono">
                                {formatCompact(p.quantity)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {!points.length && (
                      <p className="px-4 pb-5 text-xs text-ink-300">
                        {historyLoading
                          ? "Loading swaps…"
                          : historyError || poolError
                            ? "Swap history is unavailable."
                            : "No confirmed swaps loaded."}
                      </p>
                    )}
                  </div>
                  {cursor && (
                    <button
                      onClick={() => void loadMore()}
                      disabled={historyLoading}
                      className="w-full border-t border-ink-700 py-3 text-xs font-semibold text-accent disabled:opacity-40"
                    >
                      {historyLoading ? "Loading…" : "Load older swaps"}
                    </button>
                  )}
                </section>
              </div>
              <section
                className="rounded-2xl border border-ink-700 bg-ink-850 p-5"
                aria-label="Swap tokens"
              >
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Swap</h2>
                  <span className="rounded bg-ink-700 px-2 py-1 text-[10px] text-ink-300">
                    KoinDX pool
                  </span>
                </div>
                <div className="mb-5 space-y-3 text-xs">
                  {(["base", "quote"] as const).map((side) => (
                    <div
                      key={side}
                      className="flex justify-between gap-3 border-b border-ink-700 pb-3"
                    >
                      <span className="text-ink-300">
                        Your {pair[side].symbol}
                      </span>
                      <span className="break-all text-right font-mono">
                        {balances?.owner === account && balances?.pair === id
                          ? formatUnits(balances[side], pair[side].decimals, 6)
                          : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                {!account && (
                  <button
                    onClick={openConnect}
                    className="mb-5 w-full rounded-lg bg-accent py-3 text-sm font-bold text-white"
                  >
                    Connect Kondor or KOIN Vault
                  </button>
                )}
                <div className="mb-5 grid grid-cols-2 gap-2">
                  <button
                    disabled={busy}
                    aria-pressed={buy}
                    onClick={() => {
                      setBuy(true);
                      setAmount("");
                      setSwapError("");
                    }}
                    className={`rounded-lg border py-2.5 text-sm font-semibold ${buy ? "border-up/40 bg-up/15 text-up" : "border-ink-600 text-ink-300"}`}
                  >
                    Buy {pair.base.symbol}
                  </button>
                  <button
                    disabled={busy}
                    aria-pressed={!buy}
                    onClick={() => {
                      setBuy(false);
                      setAmount("");
                      setSwapError("");
                    }}
                    className={`rounded-lg border py-2.5 text-sm font-semibold ${!buy ? "border-down/40 bg-down/15 text-down" : "border-ink-600 text-ink-300"}`}
                  >
                    Sell {pair.base.symbol}
                  </button>
                </div>
                <div className="block">
                  <span className="mb-2 flex justify-between text-xs text-ink-300">
                    <label htmlFor="koindx-amount">
                      Amount to spend ({inputToken?.symbol})
                    </label>
                    {balance != null && (
                      <button
                        type="button"
                        disabled={busy}
                        className="font-semibold text-accent"
                        onClick={() =>
                          setAmount(
                            formatUnits(balance, inputToken!.decimals).replace(
                              /,/g,
                              "",
                            ),
                          )
                        }
                      >
                        Max
                      </button>
                    )}
                  </span>
                  <input
                    id="koindx-amount"
                    aria-label="Amount to spend"
                    className={`${inputClass} font-mono text-lg`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={amount}
                    disabled={busy}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setSwapError("");
                      setSubmitted("");
                    }}
                  />
                </div>
                <div className="my-5 rounded-lg bg-ink-900 p-3">
                  <div className="mb-1 text-xs text-ink-300">
                    Estimated receive
                  </div>
                  <div className="break-all text-xl font-semibold">
                    {quote && !quote.error && outputToken
                      ? formatUnits(quote.output, outputToken.decimals, 8)
                      : "—"}{" "}
                    <span className="text-sm font-normal text-ink-300">
                      {outputToken?.symbol}
                    </span>
                  </div>
                </div>
                <label className="mb-4 flex items-center justify-between text-xs text-ink-300">
                  Slippage tolerance
                  <select
                    aria-label="Slippage tolerance"
                    value={slippage}
                    disabled={busy}
                    onChange={(e) => setSlippage(e.target.value)}
                    className="rounded border border-ink-600 bg-ink-800 px-2 py-1.5 text-white"
                  >
                    <option value="0.1">0.1%</option>
                    <option value="0.5">0.5%</option>
                    <option value="1">1%</option>
                    <option value="3">3%</option>
                  </select>
                </label>
                <div className="mb-5 space-y-2 text-xs text-ink-300">
                  <div className="flex justify-between gap-2">
                    <span>Minimum received</span>
                    <span className="text-right text-white">
                      {quote && !quote.error && outputToken
                        ? `${formatUnits(quote.minimum, outputToken.decimals)} ${outputToken.symbol}`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>KoinDX fee</span>
                    <span>0.25%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Fee + price impact</span>
                    <span
                      className={quote && quote.impact >= 5 ? "text-down" : ""}
                    >
                      {quote && !quote.error
                        ? `${quote.impact.toFixed(2)}%`
                        : "—"}
                    </span>
                  </div>
                </div>
                {(pair.base.address === VETH ||
                  pair.quote.address === VETH) && (
                  <p className="mb-4 text-xs leading-relaxed text-ink-300">
                    vETH is bridged ETH held on Koinos.
                  </p>
                )}
                {quote?.error && (
                  <p role="alert" className="mb-3 text-xs text-down">
                    {quote.error}
                  </p>
                )}
                {insufficient && (
                  <p role="alert" className="mb-3 text-xs text-down">
                    Insufficient {inputToken?.symbol} balance.
                  </p>
                )}
                {balanceError && (
                  <p role="alert" className="mb-3 text-xs text-down">
                    Could not read wallet balances.{" "}
                    <button
                      onClick={() => setRefresh((v) => v + 1)}
                      className="underline"
                    >
                      Retry
                    </button>
                  </p>
                )}
                {swapError && (
                  <p
                    role="alert"
                    className="mb-3 break-words text-xs text-down"
                  >
                    {swapError}
                  </p>
                )}
                {submitted && (
                  <a
                    className="mb-4 block text-xs text-up underline"
                    href={EXPLORER_TX(submitted)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Swap submitted · View transaction ↗
                  </a>
                )}
                <button
                  onClick={() => (account ? void trade() : openConnect())}
                  disabled={!!account && !canSwap}
                  className={`w-full rounded-lg py-3.5 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-35 ${buy ? "bg-up" : "bg-down"}`}
                >
                  {busy
                    ? authMethod === "bio"
                      ? "Approve in KOIN Vault…"
                      : "Confirm in your wallet…"
                    : !account
                      ? "Connect wallet to swap"
                      : `${buy ? "Buy" : "Sell"} ${pair.base.symbol}`}
                </button>
                {busy && authMethod === "bio" && (
                  <a
                    href={BIO_WALLET_API + "/"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 block text-center text-xs text-accent underline"
                  >
                    Open KOIN Vault to approve
                  </a>
                )}
                <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-300">
                  Review and approve each swap in your wallet.
                </p>
              </section>
            </div>
            {pool && (
              <p className="mt-6 break-all text-xs text-ink-300">
                Pool:{" "}
                <a
                  className="text-accent"
                  href={`https://koinosblocks.com/address/${pool.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {pool.address} ↗
                </a>
              </p>
            )}
          </>
        )}
        <details className="mt-6 text-xs text-ink-300">
          <summary className="cursor-pointer">
            Find another KoinDX token
          </summary>
          <p className="mt-3 leading-relaxed">
            The dropdown follows KoinDX’s token list. Enter another token’s
            contract address to open its KOIN pool.
          </p>
          <form
            className="mt-3 flex max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              history.pushState(
                null,
                "",
                `/koindx/#/market/${encodeURIComponent(custom.trim())}_${KOIN}`,
              );
              setRouteVersion((v) => v + 1);
            }}
          >
            <input
              aria-label="Token contract address"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className={inputClass}
              placeholder="Token contract address"
              required
            />
            <button
              disabled={busy}
              className="shrink-0 rounded-lg border border-ink-600 px-4 text-white"
            >
              Open pool
            </button>
          </form>
        </details>
      </div>
    </main>
  );
}
function Stat({
  label,
  value,
  detail,
  color = "",
}: {
  label: string;
  value: string;
  detail: string;
  color?: string;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] text-ink-300">{label}</p>
      <p className={`break-words text-sm font-semibold sm:text-base ${color}`}>
        {value}
      </p>
      <p className="mt-1 text-[11px] text-ink-300">{detail}</p>
    </div>
  );
}
