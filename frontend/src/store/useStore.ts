import { create } from "zustand";
import {
  connectKondor,
  createMarket,
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
import { TOKENS, type TokenConfig } from "../config/tokens";
import {
  MARKET_HASH_PREFIX,
  marketFromHash,
  writeMarketHash,
} from "../lib/marketLink";
import {
  adoptWif,
  clearSessionKey,
  getSessionLabel,
  sessionAddress,
  setSessionLabel,
} from "../lib/sessionKey";
import {
  fetchAuthConfig,
  loginWithGoogle,
  type AuthConfig,
} from "../lib/authApi";

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
  /** how the current account signs — Kondor extension, or a Google session key */
  authMethod: AuthMethod;
  /** email label for a Google session, shown on the account button */
  authLabel: string | null;
  /** null until probed; google stays false wherever there is no server */
  authConfig: AuthConfig | null;
  connecting: boolean;
  /** accounts Kondor shared, pending the user's pick (null = no picker open) */
  accountChoices: KondorAccount[] | null;
  balances: Record<string, bigint>;

  markets: MarketInfo[];
  /** curated tokens plus every token discovered from on-chain listings */
  tokens: TokenConfig[];
  /** every pair on-chain, hidden ones included (duplicate pre-check) */
  allPairs: { base: string; quote: string }[];
  selectedMarketId: number | null;

  bids: OrderInfo[];
  asks: OrderInfo[];
  trades: TradeInfo[];
  myOrders: OrderInfo[];
  marketDataLoaded: boolean;

  toasts: Toast[];
  prefillPrice: string | null;
  listPairOpen: boolean;

  init: () => Promise<void>;
  connect: () => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  chooseAccount: (address: string) => void;
  dismissAccountChoices: () => void;
  disconnect: () => void;
  selectMarket: (marketId: number) => void;
  refreshMarkets: () => Promise<void>;
  refreshMarketData: () => Promise<void>;
  refreshUser: () => Promise<void>;
  submitOrder: (params: PlaceOrderParams) => Promise<boolean>;
  submitCancel: (orderId: bigint) => Promise<boolean>;
  submitCreateMarket: (
    baseToken: string,
    quoteToken: string,
    minBaseAmount: bigint
  ) => Promise<boolean>;
  setListPairOpen: (open: boolean) => void;
  pushToast: (toast: Omit<Toast, "id">) => number;
  dismissToast: (id: number) => void;
  setPrefillPrice: (price: string | null) => void;
}

let toastCounter = 1;
export type AuthMethod = "kondor" | "google" | null;
const STORAGE_ACCOUNT = "koinoskit-trade:account";
const STORAGE_METHOD = "koinoskit-trade:auth-method";
// bumped to v2 so any stale saved selection is dropped and the app lands on
// the KOIN/vUSDT default
const STORAGE_MARKET = "koinoskit-trade:market:v2";

/**
 * What survives a reload.
 *
 * A Kondor account is only an address — the extension still holds the key, so
 * remembering it across sessions costs nothing. A Google account is different:
 * its key lives in this tab and dies with it, so it is only restored while
 * that session key is still here. A new tab starts signed out rather than
 * showing an account that cannot sign.
 */
function restoreSession(): {
  account: string | null;
  authMethod: AuthMethod;
  authLabel: string | null;
} {
  const saved = localStorage.getItem(STORAGE_ACCOUNT);
  const method = localStorage.getItem(STORAGE_METHOD) as AuthMethod;

  if (method === "google") {
    const live = sessionAddress();
    if (!live || (saved && live !== saved)) {
      localStorage.removeItem(STORAGE_ACCOUNT);
      localStorage.removeItem(STORAGE_METHOD);
      clearSessionKey();
      return { account: null, authMethod: null, authLabel: null };
    }
    return { account: live, authMethod: "google", authLabel: getSessionLabel() };
  }

  return { account: saved, authMethod: saved ? "kondor" : null, authLabel: null };
}

const restored = restoreSession();

export const useStore = create<AppState>((set, get) => ({
  initialized: false,
  initError: null,

  account: restored.account,
  authMethod: restored.authMethod,
  authLabel: restored.authLabel,
  authConfig: null,
  connecting: false,
  accountChoices: null,
  balances: {},

  markets: [],
  tokens: TOKENS,
  allPairs: [],
  selectedMarketId: null,

  bids: [],
  asks: [],
  trades: [],
  myOrders: [],
  marketDataLoaded: false,

  toasts: [],
  prefillPrice: null,
  listPairOpen: false,

  init: async () => {
    // probe the sign-in bridge alongside the chain reads rather than before
    // them: served as flat files there is no /api/config to answer, and the
    // orderbook must not wait on that finding out
    void fetchAuthConfig().then((authConfig) => set({ authConfig }));
    try {
      // correct static decimals with the on-chain values before anything else
      const decimals = await fetchTokenDecimals();
      for (const token of TOKENS) {
        if (decimals[token.symbol] !== undefined) {
          token.decimals = decimals[token.symbol];
        }
      }
      const { markets, tokens, allPairs } = await fetchMarkets();
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
        tokens,
        allPairs,
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

  signInWithGoogle: async (idToken: string) => {
    set({ connecting: true });
    try {
      const result = await loginWithGoogle(idToken);
      // derive the address from the key itself rather than trusting the
      // server's word: if the two disagree the key is not what was claimed
      const address = adoptWif(result.wif);
      if (address !== result.address) {
        clearSessionKey();
        throw new Error(
          "The signed-in wallet did not match its key — sign-in refused"
        );
      }
      setSessionLabel(result.label);
      localStorage.setItem(STORAGE_ACCOUNT, address);
      localStorage.setItem(STORAGE_METHOD, "google");
      if (get().account !== address) set({ balances: {}, myOrders: [] });
      set({
        account: address,
        authMethod: "google",
        authLabel: result.label,
        accountChoices: null,
        connecting: false,
      });
      get().pushToast({
        kind: "success",
        title: result.created ? "Wallet created" : "Signed in",
        detail: `${result.label} · ${address}`,
      });
      void get().refreshUser();
    } catch (error: any) {
      clearSessionKey();
      set({ connecting: false });
      get().pushToast({
        kind: "error",
        title: "Google sign-in failed",
        detail: error?.message || String(error),
      });
    }
  },

  chooseAccount: (address: string) => {
    // picking a Kondor account replaces any Google session outright — the
    // held key must not outlive the account it belongs to
    clearSessionKey();
    localStorage.setItem(STORAGE_ACCOUNT, address);
    localStorage.setItem(STORAGE_METHOD, "kondor");
    if (get().account !== address) {
      // drop the previous account's data so it never shows under the new one
      set({ balances: {}, myOrders: [] });
    }
    set({
      account: address,
      authMethod: "kondor",
      authLabel: null,
      accountChoices: null,
      connecting: false,
    });
    void get().refreshUser();
  },

  dismissAccountChoices: () => set({ accountChoices: null }),

  disconnect: () => {
    localStorage.removeItem(STORAGE_ACCOUNT);
    localStorage.removeItem(STORAGE_METHOD);
    // the whole point of signing out is that the key stops being usable
    clearSessionKey();
    set({
      account: null,
      authMethod: null,
      authLabel: null,
      balances: {},
      myOrders: [],
      accountChoices: null,
    });
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
      const { markets, tokens, allPairs } = await fetchMarkets();
      set({ markets, tokens, allPairs });
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
        fetchBalances(account, get().tokens),
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

  submitCreateMarket: async (baseToken, quoteToken, minBaseAmount) => {
    const account = get().account;
    if (!account) return false;
    const { pushToast, dismissToast } = get();
    const pendingId = pushToast({
      kind: "pending",
      title: "Confirm the listing in Kondor…",
    });
    try {
      const handle = await createMarket(
        account,
        baseToken,
        quoteToken,
        minBaseAmount
      );
      dismissToast(pendingId);
      const miningId = pushToast({
        kind: "pending",
        title: "Listing submitted, waiting for the block…",
        txId: handle.id,
      });
      await handle.wait();
      dismissToast(miningId);
      await get().refreshMarkets();
      // land the user on the freshly listed pair
      const created = get().markets.find(
        (market) =>
          (market.base.address === baseToken &&
            market.quote.address === quoteToken) ||
          (market.base.address === quoteToken &&
            market.quote.address === baseToken)
      );
      pushToast({
        kind: "success",
        title: created
          ? `${created.base.symbol}/${created.quote.symbol} is now listed`
          : "Trading pair listed",
        txId: handle.id,
      });
      if (created) get().selectMarket(created.marketId);
      set({ listPairOpen: false });
      void get().refreshUser();
      return true;
    } catch (error: any) {
      dismissToast(pendingId);
      pushToast({
        kind: "error",
        title: "Listing failed",
        detail: error?.message || String(error),
      });
      return false;
    }
  },

  setListPairOpen: (open: boolean) => set({ listPairOpen: open }),

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
