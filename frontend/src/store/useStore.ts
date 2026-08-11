import { create } from "zustand";
import {
  connectKondor,
  fetchBalances,
  fetchMarkets,
  fetchOrderbook,
  fetchTokenDecimals,
  fetchTrades,
  fetchUserOrders,
  placeOrder,
  cancelOrder,
  type KondorAccount,
  type PlaceOrderParams,
} from "../lib/koinos";
import type { MarketInfo, OrderInfo, TradeInfo } from "../lib/types";
import { TOKENS } from "../config/tokens";
import {
  MARKET_HASH_PREFIX,
  marketFromHash,
  writeMarketHash,
} from "../lib/marketLink";

export interface Toast {
  id: number;
  kind: "pending" | "success" | "error" | "info";
  title: string;
  detail?: string;
  txId?: string;
}

interface AppState {
  initialized: boolean;
  initError: string | null;

  account: string | null;
  connecting: boolean;
  /** accounts Kondor shared, pending the user's pick (null = no picker open) */
  accountChoices: KondorAccount[] | null;
  balances: Record<string, bigint>;

  markets: MarketInfo[];
  selectedMarketId: number | null;

  bids: OrderInfo[];
  asks: OrderInfo[];
  trades: TradeInfo[];
  myOrders: OrderInfo[];
  marketDataLoaded: boolean;

  toasts: Toast[];
  prefillPrice: string | null;

  init: () => Promise<void>;
  connect: () => Promise<void>;
  chooseAccount: (address: string) => void;
  dismissAccountChoices: () => void;
  disconnect: () => void;
  selectMarket: (marketId: number) => void;
  refreshMarkets: () => Promise<void>;
  refreshMarketData: () => Promise<void>;
  refreshUser: () => Promise<void>;
  submitOrder: (params: PlaceOrderParams) => Promise<boolean>;
  submitCancel: (orderId: bigint) => Promise<boolean>;
  pushToast: (toast: Omit<Toast, "id">) => number;
  dismissToast: (id: number) => void;
  setPrefillPrice: (price: string | null) => void;
}

let toastCounter = 1;
const STORAGE_ACCOUNT = "koinoskit-trade:account";
// bumped to v2 so any stale saved selection is dropped and the app lands on
// the KOIN/vUSDT default
const STORAGE_MARKET = "koinoskit-trade:market:v2";

export const useStore = create<AppState>((set, get) => ({
  initialized: false,
  initError: null,

  account: localStorage.getItem(STORAGE_ACCOUNT),
  connecting: false,
  accountChoices: null,
  balances: {},

  markets: [],
  selectedMarketId: null,

  bids: [],
  asks: [],
  trades: [],
  myOrders: [],
  marketDataLoaded: false,

  toasts: [],
  prefillPrice: null,

  init: async () => {
    try {
      // correct static decimals with the on-chain values before anything else
      const decimals = await fetchTokenDecimals();
      for (const token of TOKENS) {
        if (decimals[token.symbol] !== undefined) {
          token.decimals = decimals[token.symbol];
        }
      }
      const markets = await fetchMarkets();
      const hash = window.location.hash;
      const linked = marketFromHash(hash, markets);
      const savedRaw = localStorage.getItem(STORAGE_MARKET);
      const savedMarket = savedRaw ? Number(savedRaw) : NaN;
      // a market deep link wins; then the previously chosen market;
      // otherwise land on KOIN/vUSDT
      const defaultMarket =
        markets.find(
          (market) =>
            market.base.symbol === "KOIN" && market.quote.symbol === "vUSDT"
        ) || markets[0];
      const selected =
        linked ||
        (savedRaw
          ? markets.find((market) => market.marketId === savedMarket)
          : null) ||
        defaultMarket;
      set({
        markets,
        selectedMarketId: selected ? selected.marketId : null,
        initialized: true,
        initError: markets.length ? null : "No markets found on the contract",
      });
      if (selected) {
        // canonicalize the URL (also rewrites symbol links to addresses)
        writeMarketHash(selected);
        void get().refreshMarketData();
      }
      if (!linked && hash.startsWith(MARKET_HASH_PREFIX)) {
        get().pushToast({
          kind: "info",
          title: "Market link not recognized",
          detail:
            "The link points at a pair that isn't listed here — showing the default market instead.",
        });
      }
      if (get().account) void get().refreshUser();
    } catch (error: any) {
      set({
        initialized: true,
        initError: error?.message || "Failed to reach the Koinos RPC",
      });
    }
  },

  connect: async () => {
    set({ connecting: true });
    try {
      const accounts = await connectKondor();
      if (!accounts.length) throw new Error("No account selected in Kondor");
      // when the picker is already open, a re-request that comes back with
      // the identical list deserves an explanation: Kondor answers from its
      // saved site permissions, so a missing account stays missing until
      // this site is removed from Kondor's website list
      const previous = get().accountChoices;
      const unchanged =
        previous !== null &&
        previous.length === accounts.length &&
        accounts.every((entry) =>
          previous.some((other) => other.address === entry.address)
        );
      if (unchanged) {
        get().pushToast({
          kind: "info",
          title: "Kondor shared the same accounts",
          detail:
            "Kondor answers from its saved permissions for this site. To add an account: open Kondor, remove this site from its connected websites, then reconnect here and tick every account you want.",
        });
      }
      // always let the user confirm which account to use — reconnecting is
      // exactly when people want a different account
      set({ accountChoices: accounts, connecting: false });
    } catch (error: any) {
      set({ connecting: false });
      get().pushToast({
        kind: "error",
        title: "Wallet connection failed",
        detail: error?.message || String(error),
      });
    }
  },

  chooseAccount: (address: string) => {
    localStorage.setItem(STORAGE_ACCOUNT, address);
    if (get().account !== address) {
      // drop the previous account's data so it never shows under the new one
      set({ balances: {}, myOrders: [] });
    }
    set({ account: address, accountChoices: null, connecting: false });
    void get().refreshUser();
  },

  dismissAccountChoices: () => set({ accountChoices: null }),

  disconnect: () => {
    localStorage.removeItem(STORAGE_ACCOUNT);
    set({ account: null, balances: {}, myOrders: [], accountChoices: null });
  },

  selectMarket: (marketId: number) => {
    if (marketId === get().selectedMarketId) return;
    localStorage.setItem(STORAGE_MARKET, String(marketId));
    const market = get().markets.find(
      (entry) => entry.marketId === marketId
    );
    if (market) writeMarketHash(market);
    set({
      selectedMarketId: marketId,
      bids: [],
      asks: [],
      trades: [],
      marketDataLoaded: false,
      prefillPrice: null,
    });
    void get().refreshMarketData();
  },

  refreshMarkets: async () => {
    try {
      const markets = await fetchMarkets();
      set({ markets });
    } catch {
      // keep previous data on transient RPC errors
    }
  },

  refreshMarketData: async () => {
    const marketId = get().selectedMarketId;
    if (marketId === null) return;
    try {
      const [book, trades] = await Promise.all([
        fetchOrderbook(marketId, 60),
        fetchTrades(marketId, 500),
      ]);
      if (get().selectedMarketId !== marketId) return; // stale
      set({
        bids: book.bids,
        asks: book.asks,
        trades,
        marketDataLoaded: true,
      });
    } catch {
      // keep previous data on transient RPC errors
    }
  },

  refreshUser: async () => {
    const account = get().account;
    if (!account) return;
    try {
      const [balances, myOrders] = await Promise.all([
        fetchBalances(account),
        fetchUserOrders(account),
      ]);
      if (get().account !== account) return;
      set({ balances, myOrders });
    } catch {
      // keep previous data on transient RPC errors
    }
  },

  submitOrder: async (params: PlaceOrderParams) => {
    const { pushToast, dismissToast } = get();
    const pendingId = pushToast({
      kind: "pending",
      title: "Confirm the transaction in Kondor…",
    });
    try {
      const handle = await placeOrder(params);
      dismissToast(pendingId);
      const miningId = pushToast({
        kind: "pending",
        title: "Order submitted, waiting for the block…",
        txId: handle.id,
      });
      await handle.wait();
      dismissToast(miningId);
      pushToast({
        kind: "success",
        title: "Order transaction included",
        txId: handle.id,
      });
      void get().refreshMarketData();
      void get().refreshUser();
      void get().refreshMarkets();
      return true;
    } catch (error: any) {
      dismissToast(pendingId);
      pushToast({
        kind: "error",
        title: "Order failed",
        detail: error?.message || String(error),
      });
      return false;
    }
  },

  submitCancel: async (orderId: bigint) => {
    const account = get().account;
    if (!account) return false;
    const { pushToast, dismissToast } = get();
    const pendingId = pushToast({
      kind: "pending",
      title: "Confirm the cancellation in Kondor…",
    });
    try {
      const handle = await cancelOrder(account, orderId);
      dismissToast(pendingId);
      const miningId = pushToast({
        kind: "pending",
        title: "Cancellation submitted…",
        txId: handle.id,
      });
      await handle.wait();
      dismissToast(miningId);
      pushToast({
        kind: "success",
        title: `Order #${orderId} cancelled`,
        txId: handle.id,
      });
      void get().refreshMarketData();
      void get().refreshUser();
      return true;
    } catch (error: any) {
      dismissToast(pendingId);
      pushToast({
        kind: "error",
        title: "Cancellation failed",
        detail: error?.message || String(error),
      });
      return false;
    }
  },

  pushToast: (toast) => {
    const id = toastCounter++;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    if (toast.kind !== "pending") {
      setTimeout(() => get().dismissToast(id), 8000);
    }
    return id;
  },

  dismissToast: (id: number) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },

  setPrefillPrice: (price) => set({ prefillPrice: price }),
}));

export function useSelectedMarket(): MarketInfo | null {
  const markets = useStore((state) => state.markets);
  const selectedMarketId = useStore((state) => state.selectedMarketId);
  return (
    markets.find((market) => market.marketId === selectedMarketId) || null
  );
}
