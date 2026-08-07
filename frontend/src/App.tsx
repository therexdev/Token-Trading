import { useEffect } from "react";
import { useStore } from "./store/useStore";
import { Header } from "./components/Header";
import { StatsBar } from "./components/StatsBar";
import { PriceChart } from "./components/PriceChart";
import { OrderBookPanel } from "./components/OrderBookPanel";
import { TradePanel } from "./components/TradePanel";
import { TradeHistory } from "./components/TradeHistory";
import { OpenOrders } from "./components/OpenOrders";
import { Toasts } from "./components/Toasts";
import { ORDERBOOK_ADDRESS } from "./config/tokens";

const MARKET_POLL_MS = 4000;
const USER_POLL_MS = 10000;
const MARKETS_POLL_MS = 30000;

function SetupNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 p-6">
      <div className="max-w-xl rounded-lg border border-ink-600 bg-ink-850 p-8">
        <h1 className="mb-3 text-lg font-bold text-white">
          Trade Koinos needs configuration
        </h1>
        <p className="mb-4 text-sm leading-relaxed text-ink-300">
          The orderbook contract address is not configured. Deploy the contract
          (see <span className="font-mono text-white">scripts/</span> in the
          repository) and set{" "}
          <span className="font-mono text-accent">VITE_ORDERBOOK_ADDRESS</span>{" "}
          in <span className="font-mono text-white">frontend/.env</span>, then
          rebuild.
        </p>
        <pre className="rounded bg-ink-950 p-3 text-xs text-ink-300">
          {`cd scripts && npm install
npm run generate-key           # fresh contract account
KOINOS_WIF=<wif> npm run deploy
KOINOS_WIF=<wif> npm run create-markets`}
        </pre>
      </div>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-down/40 bg-ink-850 p-6 text-center">
        <div className="mb-2 text-sm font-semibold text-down">
          Could not load markets
        </div>
        <div className="text-xs leading-relaxed text-ink-300">{message}</div>
      </div>
    </div>
  );
}

export default function App() {
  const init = useStore((state) => state.init);
  const initialized = useStore((state) => state.initialized);
  const initError = useStore((state) => state.initError);
  const account = useStore((state) => state.account);
  const refreshMarketData = useStore((state) => state.refreshMarketData);
  const refreshUser = useStore((state) => state.refreshUser);
  const refreshMarkets = useStore((state) => state.refreshMarkets);

  useEffect(() => {
    if (!ORDERBOOK_ADDRESS) return;
    void init();
  }, [init]);

  useEffect(() => {
    if (!ORDERBOOK_ADDRESS) return;
    const marketTimer = setInterval(() => void refreshMarketData(), MARKET_POLL_MS);
    const marketsTimer = setInterval(() => void refreshMarkets(), MARKETS_POLL_MS);
    return () => {
      clearInterval(marketTimer);
      clearInterval(marketsTimer);
    };
  }, [refreshMarketData, refreshMarkets]);

  useEffect(() => {
    if (!ORDERBOOK_ADDRESS || !account) return;
    void refreshUser();
    const userTimer = setInterval(() => void refreshUser(), USER_POLL_MS);
    return () => clearInterval(userTimer);
  }, [account, refreshUser]);

  if (!ORDERBOOK_ADDRESS) return <SetupNotice />;

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-white">
      <Header />
      <StatsBar />

      {!initialized ? (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-400">
          <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          loading markets…
        </div>
      ) : initError ? (
        <ErrorNotice message={initError} />
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-ink-700 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
          {/* order book */}
          <section className="order-2 min-h-[360px] bg-ink-900 lg:order-1 lg:min-h-0">
            <OrderBookPanel />
          </section>

          {/* chart + my orders */}
          <section className="order-1 flex min-h-0 flex-col gap-px lg:order-2">
            <div className="min-h-[300px] flex-[3] bg-ink-900 lg:min-h-0">
              <PriceChart />
            </div>
            <div className="min-h-[180px] flex-[2] bg-ink-900">
              <OpenOrders />
            </div>
          </section>

          {/* trade panel + trades feed */}
          <section className="order-3 flex min-h-0 flex-col gap-px">
            <div className="bg-ink-900">
              <TradePanel />
            </div>
            <div className="min-h-[200px] flex-1 bg-ink-900">
              <TradeHistory />
            </div>
          </section>
        </main>
      )}

      <Toasts />
    </div>
  );
}
