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

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[90px]">
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

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-ink-700 bg-ink-900 px-4 py-2">
      <MarketSelector />

      <div>
        <div className="text-[10px] uppercase tracking-wider text-ink-400">
          Last price
        </div>
        <div className={`font-mono text-lg font-bold leading-tight ${changeClass}`}>
          {stats.lastPrice > 0n ? formatPriceNumber(lastPriceNumber) : "—"}
          <span className="ml-1 text-[10px] font-normal text-ink-400">
            {market.quote.symbol}
          </span>
        </div>
      </div>

      <Stat label="24h change">
        <span className={changeClass}>
          {stats.change24h === null
            ? "—"
            : `${stats.change24h >= 0 ? "+" : ""}${stats.change24h.toFixed(2)}%`}
        </span>
      </Stat>

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
  );
}
