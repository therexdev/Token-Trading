import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { buildDexCandles, type SwapPoint } from "../../lib/koindx/model";
import { priceDisplayDecimals } from "../../lib/format";
const intervals = [
  ["1H", 3600],
  ["4H", 14400],
  ["1D", 86400],
  ["1W", 604800],
] as const;
export function DexChart({
  points,
  marketId,
  loading,
  error,
  quote,
}: {
  points: SwapPoint[];
  marketId: string;
  loading: boolean;
  error: string;
  quote: string;
}) {
  const [interval, setInterval] = useState(86400);
  const root = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick"> | null>(null),
    volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fitted = useRef("");
  const candles = useMemo(
    () => buildDexCandles(points, interval),
    [points, interval],
  );
  useEffect(() => {
    if (!root.current) return;
    const api = createChart(root.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#10141b" },
        textColor: "#8b98b0",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1d2431" },
        horzLines: { color: "#1d2431" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "#2a3344",
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: { borderColor: "#2a3344", timeVisible: true },
    });
    chart.current = api;
    price.current = api.addCandlestickSeries({
      upColor: "#2ebd85",
      downColor: "#f6465d",
      borderVisible: false,
      wickUpColor: "#2ebd85",
      wickDownColor: "#f6465d",
    });
    volume.current = api.addHistogramSeries({
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
    });
    api
      .priceScale("volume")
      .applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    return () => {
      api.remove();
      chart.current = null;
      price.current = null;
      volume.current = null;
      fitted.current = "";
    };
  }, []);
  useEffect(() => {
    const precision = priceDisplayDecimals(
      candles[candles.length - 1]?.close || 0,
    );
    price.current?.applyOptions({
      priceFormat: { type: "price", precision, minMove: 10 ** -precision },
    });
    price.current?.setData(
      candles.map(({ volume: _, ...c }) => ({
        ...c,
        time: c.time as UTCTimestamp,
      })),
    );
    volume.current?.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "#2ebd8545" : "#f6465d45",
      })),
    );
    const key = `${marketId}:${interval}`;
    if (candles.length && fitted.current !== key) {
      chart.current?.timeScale().fitContent();
      fitted.current = key;
    }
  }, [candles, interval, marketId]);
  return (
    <section
      aria-label="KoinDX price chart"
      className="overflow-hidden rounded-xl border border-ink-700 bg-ink-850"
    >
      <div className="flex items-center justify-between gap-2 border-b border-ink-700 px-3 py-3 sm:px-4">
        <div className="flex gap-3 text-[11px] text-ink-300">
          <span className="text-up">■ Up</span>
          <span className="text-down">■ Down</span>
          <span className="hidden sm:inline">■ Volume ({quote})</span>
        </div>
        <div className="flex gap-1">
          {intervals.map(([label, seconds]) => (
            <button
              key={seconds}
              aria-pressed={interval === seconds}
              onClick={() => setInterval(seconds)}
              className={`rounded px-2 py-1 text-xs font-semibold ${interval === seconds ? "bg-ink-600 text-white" : "text-ink-300 hover:bg-ink-700"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative h-[320px] sm:h-[460px]">
        <div ref={root} className="absolute inset-0" />
        {!candles.length && (
          <div
            role="status"
            className="absolute inset-0 flex items-center justify-center bg-ink-850/80 p-8 text-center text-sm text-ink-300"
          >
            {loading
              ? "Loading confirmed swaps…"
              : error || "No confirmed swaps found for this pool yet."}
          </div>
        )}
      </div>
      <div className="border-t border-ink-700 px-4 py-3 text-[11px] text-ink-300">
        Pool price after each confirmed swap · Times in UTC ·{" "}
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Charts by TradingView
        </a>
      </div>
    </section>
  );
}
