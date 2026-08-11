import { useMemo } from "react";
import { useStore, useSelectedMarket } from "../store/useStore";
import { computeStats } from "../lib/candles";
import {
  priceToNumber,
  formatPriceNumber,
  formatUnits,
  formatCompact,
} from "../lib/format";
import { MarketSelector } from "./MarketSelector";
import { marketLink } from "../lib/marketLink";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[90px] shrink-0 whitespace-nowrap">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">
        {label}
      </div>
      <div className="font-mono text-xs text-white">{children}</div>
    </div>
  );
}

export function StatsBar() {
  const market = useSelectedMarket();
  const trades = useStore((state) => state.trades);
  const pushToast = useStore((state) => state.pushToast);

  const copyLink = async () => {
    if (!market) return;
    const link = marketLink(market);
    try {
      await navigator.clipboard.writeText(link);
      pushToast({
        kind: "success",
        title: `${market.base.symbol}/${market.quote.symbol} link copied`,
        detail: "Anyone opening it lands directly on this pair.",
      });
    } catch {
      pushToast({
        kind: "error",
        title: "Could not copy the link",
        detail: link,
      });
    }
  };

  const stats = useMemo(
    () => (market ? computeStats(trades, market) : null),
    [trades, market]
  );

  if (!market || !stats) {
    return (
      <div className="flex items-center gap-4 border-b border-ink-700 bg-ink-900 px-4 py-2" />
    );
  }

  const baseDec = market.base.decimals;
  const quoteDec = market.quote.decimals;
  const lastPriceNumber = priceToNumber(stats.lastPrice, baseDec, quoteDec);
  const changeClass =
    stats.change24h === null
      ? "text-ink-300"
      : stats.change24h >= 0
        ? "text-up"
        : "text-down";
  const changeText =
    stats.change24h === null
      ? "—"
      : `${stats.change24h >= 0 ? "+" : ""}${stats.change24h.toFixed(2)}%`;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-ink-700 bg-ink-900 px-3 py-2 lg:gap-6 lg:px-4">
      <div className="flex shrink-0 items-center gap-1.5">
        <MarketSelector />
        <button
          onClick={() => void copyLink()}
          title="Copy a link to this pair"
          aria-label="Copy a link to this pair"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-ink-600 bg-ink-800 text-ink-400 transition hover:border-accent hover:text-white"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M6.5 9.5l3-3" />
            <path d="M7.75 4.75 9.4 3.1a2.33 2.33 0 0 1 3.3 0l.2.2a2.33 2.33 0 0 1 0 3.3l-1.65 1.65" />
            <path d="M8.25 11.25 6.6 12.9a2.33 2.33 0 0 1-3.3 0l-.2-.2a2.33 2.33 0 0 1 0-3.3l1.65-1.65" />
          </svg>
        </button>
      </div>

      <div className="shrink-0">
        <div className="text-[10px] uppercase tracking-wider text-ink-400">
          Last price
        </div>
        <div
          className={`font-mono text-base font-bold leading-tight lg:text-lg ${changeClass}`}
        >
          {stats.lastPrice > 0n ? formatPriceNumber(lastPriceNumber) : "—"}
          <span className="ml-1 text-[10px] font-normal text-ink-400">
            {market.quote.symbol}
          </span>
          {/* on phones the 24h change rides beside the price */}
          {stats.change24h !== null && (
            <span className="ml-1.5 text-[11px] font-semibold lg:hidden">
              {changeText}
            </span>
          )}
        </div>
      </div>

      {/* remaining stats scroll horizontally on narrow screens */}
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-4 overflow-x-auto lg:gap-6">
        <div className="hidden lg:block">
          <Stat label="24h change">
            <span className={changeClass}>{changeText}</span>
          </Stat>
        </div>

        <Stat label="24h high">
          {stats.high24h !== null
            ? formatPriceNumber(priceToNumber(stats.high24h, baseDec, quoteDec))
            : "—"}
        </Stat>

        <Stat label="24h low">
          {stats.low24h !== null
            ? formatPriceNumber(priceToNumber(stats.low24h, baseDec, quoteDec))
            : "—"}
        </Stat>

        <Stat label={`24h volume (${market.base.symbol})`}>
          {formatCompact(
            Number(formatUnits(stats.baseVolume24h, baseDec).replace(/,/g, ""))
          )}
        </Stat>

        <Stat label={`24h volume (${market.quote.symbol})`}>
          {formatCompact(
            Number(formatUnits(stats.quoteVolume24h, quoteDec).replace(/,/g, ""))
          )}
        </Stat>

        <Stat label="All-time trades">{market.tradeCount.toString()}</Stat>
      </div>
    </div>
  );
}
