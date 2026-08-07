import { useMemo } from "react";
import { useStore, useSelectedMarket } from "../store/useStore";
import { aggregateLevels } from "../lib/candles";
import {
  priceToNumber,
  priceToHuman,
  formatPriceNumber,
  formatUnits,
  priceExponent,
} from "../lib/format";
import type { BookLevel, MarketInfo } from "../lib/types";

const ROWS = 11;

function LevelRow({
  level,
  market,
  side,
  maxCumulative,
  onClick,
}: {
  level: BookLevel;
  market: MarketInfo;
  side: "bid" | "ask";
  maxCumulative: bigint;
  onClick: () => void;
}) {
  const priceNumber = priceToNumber(
    level.price,
    market.base.decimals,
    market.quote.decimals
  );
  const depth =
    maxCumulative > 0n
      ? Number((level.cumulative * 1000n) / maxCumulative) / 10
      : 0;
  const color = side === "bid" ? "rgba(46,189,133,0.12)" : "rgba(246,70,93,0.12)";

  return (
    <button
      onClick={onClick}
      className="relative grid w-full grid-cols-3 gap-1 px-3 py-1 text-right font-mono text-xs leading-4 transition hover:bg-ink-700 lg:py-[3px] lg:text-[11px]"
    >
      <span
        className="absolute inset-y-0 right-0"
        style={{ width: `${depth}%`, backgroundColor: color }}
      />
      <span
        className={`relative text-left ${side === "bid" ? "text-up" : "text-down"}`}
      >
        {formatPriceNumber(priceNumber)}
      </span>
      <span className="relative text-ink-300">
        {formatUnits(level.quantity, market.base.decimals, 4)}
      </span>
      <span className="relative text-ink-400">
        {formatUnits(level.cumulative, market.base.decimals, 4)}
      </span>
    </button>
  );
}

export function OrderBookPanel() {
  const market = useSelectedMarket();
  const bids = useStore((state) => state.bids);
  const asks = useStore((state) => state.asks);
  const setPrefillPrice = useStore((state) => state.setPrefillPrice);

  const { bidLevels, askLevels, maxCumulative, spread } = useMemo(() => {
    if (!market) {
      return {
        bidLevels: [] as BookLevel[],
        askLevels: [] as BookLevel[],
        maxCumulative: 0n,
        spread: null as number | null,
      };
    }
    const bidLevelsAll = aggregateLevels(bids, true).slice(0, ROWS);
    const askLevelsAll = aggregateLevels(asks, false).slice(0, ROWS);
    const maxBid = bidLevelsAll.length
      ? bidLevelsAll[bidLevelsAll.length - 1].cumulative
      : 0n;
    const maxAsk = askLevelsAll.length
      ? askLevelsAll[askLevelsAll.length - 1].cumulative
      : 0n;
    let spreadValue: number | null = null;
    if (bidLevelsAll.length && askLevelsAll.length) {
      const bestBid = priceToNumber(
        bidLevelsAll[0].price,
        market.base.decimals,
        market.quote.decimals
      );
      const bestAsk = priceToNumber(
        askLevelsAll[0].price,
        market.base.decimals,
        market.quote.decimals
      );
      if (bestBid > 0) {
        spreadValue = ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 100;
      }
    }
    return {
      bidLevels: bidLevelsAll,
      askLevels: askLevelsAll,
      maxCumulative: maxBid > maxAsk ? maxBid : maxAsk,
      spread: spreadValue,
    };
  }, [bids, asks, market]);

  if (!market) return null;

  const prefill = (level: BookLevel) => {
    const exponent = priceExponent(market.base.decimals, market.quote.decimals);
    setPrefillPrice(
      priceToHuman(level.price, market.base.decimals, market.quote.decimals, Math.min(exponent, 12)).replace(/,/g, "")
    );
  };

  const lastPriceNumber = priceToNumber(
    market.lastPrice,
    market.base.decimals,
    market.quote.decimals
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-300">
          Order book
        </span>
        <span className="text-[10px] text-ink-400">
          {spread !== null ? `spread ${spread.toFixed(2)}%` : ""}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1 px-3 py-1 text-right text-[10px] uppercase tracking-wider text-ink-400">
        <span className="text-left">Price {market.quote.symbol}</span>
        <span>Size {market.base.symbol}</span>
        <span>Total</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* asks, worst at top / best at bottom */}
        <div className="flex flex-1 flex-col justify-end overflow-hidden">
          {[...askLevels].reverse().map((level) => (
            <LevelRow
              key={level.price.toString()}
              level={level}
              market={market}
              side="ask"
              maxCumulative={maxCumulative}
              onClick={() => prefill(level)}
            />
          ))}
          {askLevels.length === 0 && (
            <div className="py-3 text-center text-[11px] text-ink-500">
              no asks
            </div>
          )}
        </div>

        <div className="border-y border-ink-700 bg-ink-850 px-3 py-1.5 text-center">
          <span className="font-mono text-sm font-bold text-white">
            {market.lastPrice > 0n ? formatPriceNumber(lastPriceNumber) : "—"}
          </span>
          <span className="ml-1 text-[10px] text-ink-400">last</span>
        </div>

        {/* bids, best at top */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {bidLevels.map((level) => (
            <LevelRow
              key={level.price.toString()}
              level={level}
              market={market}
              side="bid"
              maxCumulative={maxCumulative}
              onClick={() => prefill(level)}
            />
          ))}
          {bidLevels.length === 0 && (
            <div className="py-3 text-center text-[11px] text-ink-500">
              no bids
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
