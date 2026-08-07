import { useEffect, useRef, useState } from "react";
import { useStore, useSelectedMarket } from "../store/useStore";
import { priceToNumber, formatPriceNumber } from "../lib/format";

export function MarketSelector() {
  const markets = useStore((state) => state.markets);
  const selectMarket = useStore((state) => state.selectMarket);
  const market = useSelectedMarket();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!market) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-md border border-ink-600 bg-ink-800 px-3 py-2 transition hover:border-accent"
      >
        <span className="flex -space-x-1">
          <span
            className="inline-block h-4 w-4 rounded-full ring-2 ring-ink-800"
            style={{ backgroundColor: market.base.color }}
          />
          <span
            className="inline-block h-4 w-4 rounded-full ring-2 ring-ink-800"
            style={{ backgroundColor: market.quote.color }}
          />
        </span>
        <span className="text-sm font-bold text-white">
          {market.base.symbol}
          <span className="text-ink-400">/{market.quote.symbol}</span>
        </span>
        <svg
          className={`h-3 w-3 text-ink-400 transition ${open ? "rotate-180" : ""}`}
          viewBox="0 0 12 12"
          fill="currentColor"
        >
          <path d="M2 4l4 4 4-4z" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-md border border-ink-600 bg-ink-850 shadow-xl">
          {markets.map((entry) => {
            const price = priceToNumber(
              entry.lastPrice,
              entry.base.decimals,
              entry.quote.decimals
            );
            return (
              <button
                key={entry.marketId}
                onClick={() => {
                  selectMarket(entry.marketId);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-ink-700 ${
                  entry.marketId === market.marketId ? "bg-ink-800" : ""
                }`}
              >
                <span className="text-sm font-semibold text-white">
                  {entry.base.symbol}
                  <span className="text-ink-400">/{entry.quote.symbol}</span>
                </span>
                <span className="font-mono text-xs text-ink-300">
                  {entry.lastPrice > 0n ? formatPriceNumber(price) : "—"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
