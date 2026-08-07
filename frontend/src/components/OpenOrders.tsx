import { useMemo, useState } from "react";
import { useStore } from "../store/useStore";
import {
  priceToNumber,
  formatPriceNumber,
  formatUnits,
  timeAgo,
} from "../lib/format";
import { SIDE_BUY } from "../lib/types";

export function OpenOrders() {
  const account = useStore((state) => state.account);
  const markets = useStore((state) => state.markets);
  const myOrders = useStore((state) => state.myOrders);
  const trades = useStore((state) => state.trades);
  const selectedMarketId = useStore((state) => state.selectedMarketId);
  const submitCancel = useStore((state) => state.submitCancel);
  const selectMarket = useStore((state) => state.selectMarket);
  const [tab, setTab] = useState<"orders" | "fills">("orders");
  const [cancelling, setCancelling] = useState<string | null>(null);

  const marketById = useMemo(
    () => new Map(markets.map((market) => [market.marketId, market])),
    [markets]
  );

  const myFills = useMemo(() => {
    if (!account) return [];
    return trades.filter(
      (trade) => trade.maker === account || trade.taker === account
    );
  }, [trades, account]);

  const cancel = async (orderId: bigint) => {
    setCancelling(orderId.toString());
    await submitCancel(orderId);
    setCancelling(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b border-ink-700 px-3 py-2">
        <button
          onClick={() => setTab("orders")}
          className={`text-xs font-semibold uppercase tracking-wider transition ${
            tab === "orders" ? "text-white" : "text-ink-400 hover:text-ink-300"
          }`}
        >
          Open orders {account ? `(${myOrders.length})` : ""}
        </button>
        <button
          onClick={() => setTab("fills")}
          className={`text-xs font-semibold uppercase tracking-wider transition ${
            tab === "fills" ? "text-white" : "text-ink-400 hover:text-ink-300"
          }`}
        >
          My trades{tab === "fills" ? " (this market)" : ""}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!account ? (
          <div className="py-6 text-center text-xs text-ink-500">
            Connect your wallet to see your orders
          </div>
        ) : tab === "orders" ? (
          myOrders.length === 0 ? (
            <div className="py-6 text-center text-xs text-ink-500">
              No open orders
            </div>
          ) : (
            <table className="w-full text-right font-mono text-[11px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-ink-400">
                  <th className="px-3 py-1.5 text-left font-normal">Market</th>
                  <th className="px-2 py-1.5 font-normal">Side</th>
                  <th className="px-2 py-1.5 font-normal">Price</th>
                  <th className="px-2 py-1.5 font-normal">Amount</th>
                  <th className="px-2 py-1.5 font-normal">Filled</th>
                  <th className="px-2 py-1.5 font-normal">Age</th>
                  <th className="px-3 py-1.5 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {myOrders.map((order) => {
                  const market = marketById.get(order.marketId);
                  if (!market) return null;
                  const filledPercent =
                    order.quantity > 0n
                      ? Number(
                          ((order.quantity - order.remaining) * 100n) /
                            order.quantity
                        )
                      : 0;
                  return (
                    <tr
                      key={order.id.toString()}
                      className="border-t border-ink-800 hover:bg-ink-850"
                    >
                      <td
                        className="cursor-pointer px-3 py-1.5 text-left text-ink-300 hover:text-white"
                        onClick={() =>
                          order.marketId !== selectedMarketId &&
                          selectMarket(order.marketId)
                        }
                      >
                        {market.base.symbol}/{market.quote.symbol}
                      </td>
                      <td
                        className={`px-2 py-1.5 ${
                          order.side === SIDE_BUY ? "text-up" : "text-down"
                        }`}
                      >
                        {order.side === SIDE_BUY ? "BUY" : "SELL"}
                      </td>
                      <td className="px-2 py-1.5 text-white">
                        {formatPriceNumber(
                          priceToNumber(
                            order.price,
                            market.base.decimals,
                            market.quote.decimals
                          )
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-ink-300">
                        {formatUnits(order.remaining, market.base.decimals, 4)}
                      </td>
                      <td className="px-2 py-1.5 text-ink-400">
                        {filledPercent}%
                      </td>
                      <td className="px-2 py-1.5 text-ink-500">
                        {order.timestamp ? timeAgo(order.timestamp) : "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <button
                          onClick={() => cancel(order.id)}
                          disabled={cancelling === order.id.toString()}
                          className="rounded border border-ink-600 px-2 py-0.5 text-[10px] text-ink-300 transition hover:border-down hover:text-down disabled:opacity-50"
                        >
                          {cancelling === order.id.toString()
                            ? "…"
                            : "Cancel"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : myFills.length === 0 ? (
          <div className="py-6 text-center text-xs text-ink-500">
            No fills in this market's recent history
          </div>
        ) : (
          <table className="w-full text-right font-mono text-[11px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-ink-400">
                <th className="px-3 py-1.5 text-left font-normal">Side</th>
                <th className="px-2 py-1.5 font-normal">Role</th>
                <th className="px-2 py-1.5 font-normal">Price</th>
                <th className="px-2 py-1.5 font-normal">Amount</th>
                <th className="px-2 py-1.5 font-normal">Total</th>
                <th className="px-3 py-1.5 font-normal">Age</th>
              </tr>
            </thead>
            <tbody>
              {myFills.map((trade) => {
                const market = marketById.get(trade.marketId);
                if (!market) return null;
                const isTaker = trade.taker === account;
                const mySide = isTaker ? trade.takerSide : 1 - trade.takerSide;
                return (
                  <tr
                    key={trade.seq.toString()}
                    className="border-t border-ink-800 hover:bg-ink-850"
                  >
                    <td
                      className={`px-3 py-1.5 text-left ${
                        mySide === SIDE_BUY ? "text-up" : "text-down"
                      }`}
                    >
                      {mySide === SIDE_BUY ? "BUY" : "SELL"}
                    </td>
                    <td className="px-2 py-1.5 text-ink-400">
                      {isTaker ? "taker" : "maker"}
                    </td>
                    <td className="px-2 py-1.5 text-white">
                      {formatPriceNumber(
                        priceToNumber(
                          trade.price,
                          market.base.decimals,
                          market.quote.decimals
                        )
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-ink-300">
                      {formatUnits(trade.quantity, market.base.decimals, 4)}
                    </td>
                    <td className="px-2 py-1.5 text-ink-300">
                      {formatUnits(trade.quoteAmount, market.quote.decimals, 4)}{" "}
                      {market.quote.symbol}
                    </td>
                    <td className="px-3 py-1.5 text-ink-500">
                      {timeAgo(trade.timestamp)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
