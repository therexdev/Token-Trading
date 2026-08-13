import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, useSelectedMarket } from "../store/useStore";
import { priceToNumber, formatPriceNumber } from "../lib/format";
import { TOKENS } from "../config/tokens";

export function MarketSelector() {
  const markets = useStore((state) => state.markets);
  const selectMarket = useStore((state) => state.selectMarket);
  const setListPairOpen = useStore((state) => state.setListPairOpen);
  const market = useSelectedMarket();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string>("All");
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // pop the keyboard only on desktop; on phones it would cover the list
    if (window.matchMedia("(min-width: 1024px)").matches) {
      searchRef.current?.focus();
    }
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // one tab per curated token that appears in at least one live market
  // (TOKENS order), plus "Other" for pairs of purely discovered tokens
  const tokenTabs = useMemo(() => {
    const present = new Set<string>();
    for (const entry of markets) {
      present.add(entry.base.symbol);
      present.add(entry.quote.symbol);
    }
    const tabs = TOKENS.filter((token) => present.has(token.symbol)).map(
      (token) => token.symbol
    );
    const hasOther = markets.some(
      (entry) => entry.base.dynamic && entry.quote.dynamic
    );
    return hasOther ? [...tabs, "Other"] : tabs;
  }, [markets]);

  const visible = useMemo(() => {
    // typing searches across ALL pairs, regardless of the active tab
    const needle = query.trim().toLowerCase();
    if (needle) {
      return markets.filter((entry) =>
        `${entry.base.symbol}/${entry.quote.symbol}`
          .toLowerCase()
          .includes(needle)
      );
    }
    if (tab === "All") return markets;
    if (tab === "Other") {
      // pairs where neither side is one of the curated tokens
      return markets.filter(
        (entry) => entry.base.dynamic && entry.quote.dynamic
      );
    }
    const filtered = markets.filter(
      (entry) => entry.base.symbol === tab || entry.quote.symbol === tab
    );
    // pairs where the tab token is the traded (base) asset lead the list;
    // Array.sort is stable, so market order is preserved within each group
    return [...filtered].sort(
      (a, b) => Number(b.base.symbol === tab) - Number(a.base.symbol === tab)
    );
  }, [markets, tab, query]);

  if (!market) return null;

  const toggle = () => {
    setQuery("");
    setOpen(!open);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={toggle}
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
        <span className="whitespace-nowrap text-sm font-bold text-white">
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
        <div className="fixed inset-0 z-50 flex flex-col bg-ink-900 lg:absolute lg:inset-auto lg:left-0 lg:top-full lg:z-30 lg:mt-1 lg:max-h-[26rem] lg:w-[22rem] lg:rounded-md lg:border lg:border-ink-600 lg:bg-ink-850 lg:shadow-xl">
          {/* phone-only header */}
          <div className="flex shrink-0 items-center justify-between border-b border-ink-700 px-4 py-3 lg:hidden">
            <span className="text-sm font-bold text-white">Markets</span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="-mr-2 flex h-8 w-8 items-center justify-center rounded-md text-ink-400 transition hover:text-white"
            >
              ✕
            </button>
          </div>

          <div className="shrink-0 border-b border-ink-700 p-2">
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pairs"
              className="w-full rounded-md border border-ink-600 bg-ink-850 px-3 py-2 text-base text-white outline-none transition placeholder:text-ink-500 focus:border-accent lg:bg-ink-900 lg:py-1.5 lg:text-xs"
            />
          </div>

          {/* token tabs: pick the currency, see every pair it trades in */}
          <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-ink-700 px-2 py-2">
            {["All", ...tokenTabs].map((symbol) => (
              <button
                key={symbol}
                onClick={() => setTab(symbol)}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition lg:px-2.5 lg:py-1 ${
                  tab === symbol
                    ? "bg-ink-600 text-white"
                    : "text-ink-400 hover:text-white"
                }`}
              >
                {symbol}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom,0px)] lg:pb-0">
            {visible.map((entry) => {
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
                  className={`flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-ink-700 lg:px-3 lg:py-2.5 ${
                    entry.marketId === market.marketId ? "bg-ink-800" : ""
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex shrink-0 -space-x-1">
                      <span
                        className="inline-block h-4 w-4 rounded-full ring-2 ring-ink-900 lg:ring-ink-850"
                        style={{ backgroundColor: entry.base.color }}
                      />
                      <span
                        className="inline-block h-4 w-4 rounded-full ring-2 ring-ink-900 lg:ring-ink-850"
                        style={{ backgroundColor: entry.quote.color }}
                      />
                    </span>
                    <span className="truncate text-sm font-semibold text-white">
                      {entry.base.symbol}
                      <span className="text-ink-400">/{entry.quote.symbol}</span>
                    </span>
                  </span>
                  <span className="ml-3 shrink-0 font-mono text-xs text-ink-300">
                    {entry.lastPrice > 0n ? formatPriceNumber(price) : "—"}
                  </span>
                </button>
              );
            })}
            {visible.length === 0 && (
              <div className="py-8 text-center text-xs text-ink-500">
                No pairs match
              </div>
            )}
          </div>

          {/* anyone can list a new pair — the creator pays the mana */}
          <div className="shrink-0 border-t border-ink-700 p-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] lg:pb-2">
            <button
              onClick={() => {
                setOpen(false);
                setListPairOpen(true);
              }}
              className="w-full rounded-md border border-dashed border-ink-600 py-2 text-xs font-semibold text-ink-300 transition hover:border-accent hover:text-white"
            >
              + List a new pair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
