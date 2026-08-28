import { useEffect, useRef, useState } from "react";
import { useStore, useSelectedMarket } from "./store/useStore";
import { showGoogleOneTap } from "./lib/authApi";
import { Header } from "./components/Header";
import { StatsBar } from "./components/StatsBar";
import { PriceChart } from "./components/PriceChart";
import { OrderBookPanel } from "./components/OrderBookPanel";
import { TradePanel } from "./components/TradePanel";
import { TradeHistory } from "./components/TradeHistory";
import { OpenOrders } from "./components/OpenOrders";
import { Toasts } from "./components/Toasts";
import { AccountPicker } from "./components/AccountPicker";
import { ListPairModal } from "./components/ListPairModal";
import { ORDERBOOK_ADDRESS } from "./config/tokens";
import { SIDE_BUY, SIDE_SELL } from "./lib/types";
import { marketFromHash } from "./lib/marketLink";
import { LaunchpadListPage } from "./components/launchpad/LaunchpadListPage";
import { LaunchpadDetailPage } from "./components/launchpad/LaunchpadDetailPage";
import { CreateLaunchPage } from "./components/launchpad/CreateLaunchPage";
import { LocksPage } from "./components/launchpad/LocksPage";

// ---------------------------------------------------------------------------
// Hash routing. Market deep links (#/market/…) belong to the trade view;
// the launchpad lives beside it under #/launchpads and #/launchpad/….
// ---------------------------------------------------------------------------
type View =
  | { name: "trade" }
  | { name: "launchpads" }
  | { name: "launchpad"; id: number }
  | { name: "launchpad-create" }
  | { name: "locks" };

function viewFromHash(hash: string): View {
  if (hash.startsWith("#/locks")) return { name: "locks" };
  if (hash.startsWith("#/launchpads")) return { name: "launchpads" };
  if (hash.startsWith("#/launchpad/create")) return { name: "launchpad-create" };
  const detail = hash.match(/^#\/launchpad\/(\d+)/);
  if (detail) return { name: "launchpad", id: Number(detail[1]) };
  return { name: "trade" };
}

const MARKET_POLL_MS = 4000;
const USER_POLL_MS = 10000;
const MARKETS_POLL_MS = 30000;

// matches Tailwind's `lg` breakpoint — the layouts are swapped in JS (not CSS)
// so only one chart / trade panel instance is ever mounted at a time
const DESKTOP_QUERY = "(min-width: 1024px)";

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia(DESKTOP_QUERY).matches
  );
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

type MobileTab = "chart" | "book" | "trades" | "orders";

const MOBILE_TABS: { id: MobileTab; label: string }[] = [
  { id: "chart", label: "Chart" },
  { id: "book", label: "Book" },
  { id: "trades", label: "Trades" },
  { id: "orders", label: "Orders" },
];

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
  const authConfig = useStore((state) => state.authConfig);
  const signInWithGoogle = useStore((state) => state.signInWithGoogle);
  const refreshMarketData = useStore((state) => state.refreshMarketData);
  const refreshUser = useStore((state) => state.refreshUser);
  const refreshMarkets = useStore((state) => state.refreshMarkets);
  const myOrders = useStore((state) => state.myOrders);
  const prefillPrice = useStore((state) => state.prefillPrice);
  const market = useSelectedMarket();

  const isDesktop = useIsDesktop();
  const [tab, setTab] = useState<MobileTab>("chart");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSide, setSheetSide] = useState<number>(SIDE_BUY);
  const [view, setView] = useState<View>(() =>
    viewFromHash(window.location.hash)
  );

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

  // Google One Tap: once config lands and nobody is signed in, offer the
  // "Continue as …" chip. One tap → the same Google session flow as the modal.
  const oneTapTried = useRef(false);
  useEffect(() => {
    if (oneTapTried.current || account) return;
    if (!authConfig?.google || !authConfig.googleClientId) return;
    oneTapTried.current = true;
    void showGoogleOneTap(authConfig.googleClientId, (idToken) => {
      void signInWithGoogle(idToken);
    });
  }, [authConfig, account, signInWithGoogle]);

  // on phones, tapping a price in the book opens the order sheet prefilled
  // (the sheet's TradePanel consumes prefillPrice once it mounts)
  useEffect(() => {
    if (!isDesktop && prefillPrice !== null) setSheetOpen(true);
  }, [prefillPrice, isDesktop]);

  // a market link pasted into (or navigated to in) an already-open tab
  // switches pairs without a reload; the app's own URL updates use
  // replaceState, which never fires hashchange, so this cannot loop.
  // The same listener drives the launchpad <-> trade view switch.
  useEffect(() => {
    const onHashChange = () => {
      setView(viewFromHash(window.location.hash));
      const state = useStore.getState();
      const linked = marketFromHash(window.location.hash, state.markets);
      if (linked && linked.marketId !== state.selectedMarketId) {
        state.selectMarket(linked.marketId);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (!ORDERBOOK_ADDRESS) return <SetupNotice />;

  const openSheet = (side: number) => {
    setSheetSide(side);
    setSheetOpen(true);
  };

  return (
    <div className="app-shell flex flex-col overflow-x-clip bg-ink-950 text-white">
      <Header
        section={
          view.name === "trade"
            ? "trade"
            : view.name === "locks"
              ? "locks"
              : "launchpad"
        }
      />
      {view.name === "trade" && <StatsBar />}

      {view.name === "launchpads" ? (
        <LaunchpadListPage />
      ) : view.name === "launchpad" ? (
        <LaunchpadDetailPage id={view.id} />
      ) : view.name === "launchpad-create" ? (
        <CreateLaunchPage />
      ) : view.name === "locks" ? (
        <LocksPage />
      ) : !initialized ? (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-400">
          <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          loading markets…
        </div>
      ) : initError ? (
        <ErrorNotice message={initError} />
      ) : isDesktop ? (
        <main className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_320px] gap-px bg-ink-700">
          {/* order book */}
          <section className="min-h-0 bg-ink-900">
            <OrderBookPanel />
          </section>

          {/* chart + my orders */}
          <section className="flex min-h-0 flex-col gap-px">
            <div className="min-h-0 flex-[3] bg-ink-900">
              <PriceChart />
            </div>
            <div className="min-h-0 flex-[2] bg-ink-900">
              <OpenOrders />
            </div>
          </section>

          {/* trade panel + trades feed */}
          <section className="flex min-h-0 flex-col gap-px">
            <div className="bg-ink-900">
              <TradePanel />
            </div>
            <div className="min-h-[200px] flex-1 bg-ink-900">
              <TradeHistory />
            </div>
          </section>
        </main>
      ) : (
        <>
          {/* mobile tab bar */}
          <nav className="flex shrink-0 border-b border-ink-700 bg-ink-900">
            {MOBILE_TABS.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setTab(entry.id)}
                className={`flex-1 border-b-2 py-2.5 text-xs font-semibold uppercase tracking-wider transition ${
                  tab === entry.id
                    ? "border-accent text-white"
                    : "border-transparent text-ink-400"
                }`}
              >
                {entry.label}
                {entry.id === "orders" && account && myOrders.length > 0
                  ? ` (${myOrders.length})`
                  : ""}
              </button>
            ))}
          </nav>

          {/* active tab panel — panels stay mounted so chart zoom, sub-tabs
              and scroll positions survive tab switches */}
          <main className="min-h-0 flex-1 bg-ink-900">
            <div className={tab === "chart" ? "h-full" : "hidden"}>
              <PriceChart />
            </div>
            <div className={tab === "book" ? "h-full" : "hidden"}>
              <OrderBookPanel />
            </div>
            <div className={tab === "trades" ? "h-full" : "hidden"}>
              <TradeHistory />
            </div>
            <div className={tab === "orders" ? "h-full" : "hidden"}>
              <OpenOrders />
            </div>
          </main>

          {/* buy / sell always within thumb reach */}
          {market && (
            <div className="flex shrink-0 gap-2 border-t border-ink-700 bg-ink-900 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] pt-2">
              <button
                onClick={() => openSheet(SIDE_BUY)}
                className="flex-1 rounded-md bg-up py-3 text-sm font-bold text-white transition active:brightness-90"
              >
                Buy {market.base.symbol}
              </button>
              <button
                onClick={() => openSheet(SIDE_SELL)}
                className="flex-1 rounded-md bg-down py-3 text-sm font-bold text-white transition active:brightness-90"
              >
                Sell {market.base.symbol}
              </button>
            </div>
          )}

          {/* order form bottom sheet */}
          {sheetOpen && market && (
            <div className="fixed inset-0 z-40">
              <div
                className="absolute inset-0 animate-fade-in bg-black/60"
                onClick={() => setSheetOpen(false)}
              />
              <div className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] animate-slide-up flex-col rounded-t-2xl border-t border-ink-600 bg-ink-900 shadow-2xl">
                <div className="relative shrink-0 border-b border-ink-700 px-4 pb-2.5 pt-4">
                  <div className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-ink-600" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white">
                      {market.base.symbol}
                      <span className="text-ink-400">/{market.quote.symbol}</span>
                    </span>
                    <button
                      onClick={() => setSheetOpen(false)}
                      aria-label="Close"
                      className="-mr-2 flex h-8 w-8 items-center justify-center rounded-md text-ink-400 transition hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="min-h-0 overflow-y-auto pb-[env(safe-area-inset-bottom,0px)]">
                  <TradePanel
                    initialSide={sheetSide}
                    onSubmitted={() => setSheetOpen(false)}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <AccountPicker />
      <ListPairModal />
      <Toasts />
    </div>
  );
}
