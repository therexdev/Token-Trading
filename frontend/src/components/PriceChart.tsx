import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useStore, useSelectedMarket } from "../store/useStore";
import { buildCandles, INTERVALS } from "../lib/candles";

export function PriceChart() {
  const market = useSelectedMarket();
  const trades = useStore((state) => state.trades);
  const marketDataLoaded = useStore((state) => state.marketDataLoaded);
  const [intervalSeconds, setIntervalSeconds] = useState(3600);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const candles = useMemo(
    () => (market ? buildCandles(trades, market, intervalSeconds) : []),
    [trades, market, intervalSeconds]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b98b0",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#151a23" },
        horzLines: { color: "#151a23" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "#1d2431",
        scaleMargins: { top: 0.08, bottom: 0.25 },
      },
      timeScale: {
        borderColor: "#1d2431",
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#2ebd85",
      downColor: "#f6465d",
      borderUpColor: "#2ebd85",
      borderDownColor: "#f6465d",
      wickUpColor: "#2ebd85",
      wickDownColor: "#f6465d",
      priceFormat: { type: "price", precision: 6, minMove: 0.000001 },
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // adapt price precision to the market's magnitude
  useEffect(() => {
    if (!candleSeriesRef.current || !candles.length) return;
    const lastClose = candles[candles.length - 1].close;
    let precision = 2;
    if (lastClose < 0.0001) precision = 10;
    else if (lastClose < 0.01) precision = 8;
    else if (lastClose < 1) precision = 6;
    else if (lastClose < 100) precision = 4;
    candleSeriesRef.current.applyOptions({
      priceFormat: {
        type: "price",
        precision,
        minMove: Math.pow(10, -precision),
      },
    });
  }, [candles]);

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    candleSeriesRef.current.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }))
    );
    volumeSeriesRef.current.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.volume,
        color:
          candle.close >= candle.open
            ? "rgba(46, 189, 133, 0.35)"
            : "rgba(246, 70, 93, 0.35)",
      }))
    );
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-ink-700 px-3 py-1.5">
        {INTERVALS.map((interval) => (
          <button
            key={interval.seconds}
            onClick={() => setIntervalSeconds(interval.seconds)}
            className={`rounded px-2 py-0.5 text-xs transition ${
              interval.seconds === intervalSeconds
                ? "bg-ink-600 text-white"
                : "text-ink-400 hover:text-white"
            }`}
          >
            {interval.label}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[10px] uppercase tracking-wider text-ink-400">
          built from on-chain trades
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {marketDataLoaded && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-400">
            No trades yet — the chart appears after the first fill
          </div>
        )}
      </div>
    </div>
  );
}
