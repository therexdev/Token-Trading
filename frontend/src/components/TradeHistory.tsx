import { useStore, useSelectedMarket } from "../store/useStore";
import {
  priceToNumber,
  formatPriceNumber,
  formatUnits,
  timeAgo,
} from "../lib/format";
import { SIDE_BUY } from "../lib/types";

export function TradeHistory() {
  const market = useSelectedMarket();
  const trades = useStore((state) => state.trades);

  if (!market) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-700 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-300">
        Recent trades
      </div>
      <div className="grid grid-cols-3 gap-1 px-3 py-1 text-right text-[10px] uppercase tracking-wider text-ink-400">
        <span className="text-left">Price</span>
        <span>Size {market.base.symbol}</span>
        <span>Age</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {trades.slice(0, 80).map((trade) => (
          <div
            key={trade.seq.toString()}
            className="grid grid-cols-3 gap-1 px-3 py-1 text-right font-mono text-xs leading-4 lg:py-[3px] lg:text-[11px]"
          >
            <span
              className={`text-left ${
                trade.takerSide === SIDE_BUY ? "text-up" : "text-down"
              }`}
            >
              {formatPriceNumber(
                priceToNumber(
                  trade.price,
                  market.base.decimals,
                  market.quote.decimals
                )
              )}
            </span>
            <span className="text-ink-300">
              {formatUnits(trade.quantity, market.base.decimals, 4)}
            </span>
            <span className="text-ink-500">{timeAgo(trade.timestamp)}</span>
          </div>
        ))}
        {trades.length === 0 && (
          <div className="py-4 text-center text-[11px] text-ink-500">
            no trades yet
          </div>
        )}
      </div>
    </div>
  );
}
