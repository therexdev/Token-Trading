import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore, useSelectedMarket } from "../store/useStore";
import { NETWORK } from "../config/tokens";
import { formatUnits, shortAddress } from "../lib/format";
import { isKondorAvailable } from "../lib/koinos";
import { launchpadEnabled } from "../lib/launchpad";
import { ConnectModal } from "./ConnectModal";

export function Header({ section = "trade" }: { section?: "trade" | "launchpad" | "locks" }) {
  const account = useStore((state) => state.account);
  const connecting = useStore((state) => state.connecting);
  const connect = useStore((state) => state.connect);
  const disconnect = useStore((state) => state.disconnect);
  const balances = useStore((state) => state.balances);
  const tokens = useStore((state) => state.tokens);
  const authConfig = useStore((state) => state.authConfig);
  const authMethod = useStore((state) => state.authMethod);
  const authLabel = useStore((state) => state.authLabel);
  const market = useSelectedMarket();
  const [connectOpen, setConnectOpen] = useState(false);

  // with a sign-in bridge behind the app there is a choice to offer; served
  // as flat files there is only Kondor, so skip the modal and go straight
  // there exactly as before
  const startConnect = useCallback(() => {
    if (authConfig?.google) setConnectOpen(true);
    else void connect();
  }, [authConfig?.google, connect]);

  // launchpad pages live outside this component but need the same connect
  // flow - they ask for it with a window event instead of prop-drilling
  useEffect(() => {
    const open = () => startConnect();
    window.addEventListener("tk-open-connect", open);
    return () => window.removeEventListener("tk-open-connect", open);
  }, [startConnect]);

  // the balance strip shows the curated tokens, plus whichever discovered
  // tokens the selected market trades
  const stripTokens = useMemo(() => {
    const list = tokens.filter((token) => !token.dynamic);
    for (const side of [market?.base, market?.quote]) {
      if (side?.dynamic && !list.includes(side)) list.push(side);
    }
    return list;
  }, [tokens, market]);

  return (
    <>
    {connectOpen && <ConnectModal onClose={() => setConnectOpen(false)} />}
    <header className="flex shrink-0 items-center gap-2 border-b border-ink-700 bg-ink-900 px-2 py-2 sm:gap-3 sm:px-3 lg:gap-4 lg:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0">
          <rect width="32" height="32" rx="7" fill="#151a23" />
          <rect x="6" y="14" width="4" height="12" rx="1" fill="#2ebd85" />
          <rect x="7.5" y="11" width="1" height="17" fill="#2ebd85" />
          <rect x="14" y="6" width="4" height="12" rx="1" fill="#f6465d" />
          <rect x="15.5" y="4" width="1" height="16" fill="#f6465d" />
          <rect x="22" y="10" width="4" height="12" rx="1" fill="#2ebd85" />
          <rect x="23.5" y="7" width="1" height="17" fill="#2ebd85" />
        </svg>
        <div className="hidden min-w-0 leading-tight sm:block">
          <div className="whitespace-nowrap text-sm font-semibold tracking-wide text-white">
            Trade <span className="text-accent">Koinos</span>
          </div>
          <div className="truncate text-[10px] uppercase tracking-widest text-ink-400">
            <span className="hidden sm:inline">on-chain orderbook · </span>
            {NETWORK}
          </div>
        </div>
      </div>

      {(launchpadEnabled() || authConfig?.launchpad) && (
        <nav className="flex min-w-0 shrink items-center gap-0.5 overflow-x-auto rounded-md bg-ink-850 p-0.5 text-xs font-semibold [scrollbar-width:none]">
          <a
            href="#/"
            className={`shrink-0 whitespace-nowrap rounded px-2.5 py-1 transition ${
              section === "trade"
                ? "bg-ink-700 text-white"
                : "text-ink-400 hover:text-white"
            }`}
          >
            Trade
          </a>
          <a
            href="#/launchpads"
            className={`shrink-0 whitespace-nowrap rounded px-2.5 py-1 transition ${
              section === "launchpad"
                ? "bg-ink-700 text-white"
                : "text-ink-400 hover:text-white"
            }`}
          >
            Launchpad
          </a>
          <a
            href="#/locks"
            className={`shrink-0 whitespace-nowrap rounded px-2.5 py-1 transition ${
              section === "locks"
                ? "bg-ink-700 text-white"
                : "text-ink-400 hover:text-white"
            }`}
          >
            Locks
          </a>
        </nav>
      )}

      <div className="flex-1" />

      {account && (
        <div className="hidden items-center gap-3 rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs md:flex">
          {stripTokens.map((token) => (
            <div key={token.symbol} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: token.color }}
              />
              <span className="text-ink-300">{token.symbol}</span>
              <span className="font-mono text-white">
                {formatUnits(balances[token.symbol] ?? 0n, token.decimals, 4)}
              </span>
            </div>
          ))}
        </div>
      )}

      {account ? (
        <div className="flex items-center gap-1.5">
          <button
            onClick={startConnect}
            disabled={connecting}
            title={
              authMethod === "google"
                ? `${authLabel ?? "Google account"} · ${account} — switch account`
                : "Switch account"
            }
            className="flex max-w-[7.5rem] items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 font-mono text-xs text-ink-300 transition hover:border-accent hover:text-white disabled:opacity-50 sm:max-w-[13rem] sm:px-3 sm:py-2 lg:py-1.5"
          >
            {connecting ? (
              "Connecting…"
            ) : authMethod === "google" ? (
              <span className="truncate font-sans">
                {authLabel ?? "Google account"}
              </span>
            ) : (
              shortAddress(account)
            )}
            {!connecting && (
              <svg
                viewBox="0 0 16 16"
                aria-hidden="true"
                className="h-3 w-3 fill-current opacity-60"
              >
                <path d="M11.1 1.6 14.5 5l-3.4 3.4-1.06-1.06 1.59-1.59H4v-1.5h7.63l-1.59-1.59L11.1 1.6z" />
                <path d="M4.9 14.4 1.5 11l3.4-3.4 1.06 1.06-1.59 1.59H12v1.5H4.37l1.59 1.59L4.9 14.4z" />
              </svg>
            )}
          </button>
          <button
            onClick={disconnect}
            title="Disconnect"
            aria-label="Disconnect"
            className="flex h-[33px] w-[33px] items-center justify-center rounded-md border border-ink-600 bg-ink-800 text-ink-400 transition hover:border-down hover:text-down lg:h-[29px] lg:w-[29px]"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M8 1.8v5.4" />
              <path d="M4.4 3.6a5.4 5.4 0 1 0 7.2 0" />
            </svg>
          </button>
        </div>
      ) : authConfig?.google ? (
        // Google works without the extension, so the entry point stops being
        // Kondor-specific once the bridge is live
        <button
          onClick={startConnect}
          disabled={connecting}
          className="shrink-0 whitespace-nowrap rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50 sm:px-4 sm:py-2 sm:text-sm lg:py-1.5"
        >
          {connecting ? "Connecting…" : "Sign in"}
        </button>
      ) : isKondorAvailable() ? (
        <button
          onClick={connect}
          disabled={connecting}
          className="shrink-0 whitespace-nowrap rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50 sm:px-4 sm:py-2 sm:text-sm lg:py-1.5"
        >
          {connecting ? "Connecting…" : "Connect Kondor"}
        </button>
      ) : (
        <a
          href="https://chromewebstore.google.com/detail/kondor/ghipkefkpgkladckmlmdnadmcchefhjl"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 whitespace-nowrap rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 sm:px-4 sm:py-2 sm:text-sm lg:py-1.5"
        >
          Install Kondor
        </a>
      )}
    </header>
    </>
  );
}
