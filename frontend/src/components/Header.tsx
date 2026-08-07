import { useStore } from "../store/useStore";
import { NETWORK, TOKENS } from "../config/tokens";
import { formatUnits, shortAddress } from "../lib/format";
import { isKondorAvailable } from "../lib/koinos";

export function Header() {
  const account = useStore((state) => state.account);
  const connecting = useStore((state) => state.connecting);
  const connect = useStore((state) => state.connect);
  const disconnect = useStore((state) => state.disconnect);
  const balances = useStore((state) => state.balances);

  return (
    <header className="flex items-center gap-4 border-b border-ink-700 bg-ink-900 px-4 py-2">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 32 32" className="h-7 w-7">
          <rect width="32" height="32" rx="7" fill="#151a23" />
          <rect x="6" y="14" width="4" height="12" rx="1" fill="#2ebd85" />
          <rect x="7.5" y="11" width="1" height="17" fill="#2ebd85" />
          <rect x="14" y="6" width="4" height="12" rx="1" fill="#f6465d" />
          <rect x="15.5" y="4" width="1" height="16" fill="#f6465d" />
          <rect x="22" y="10" width="4" height="12" rx="1" fill="#2ebd85" />
          <rect x="23.5" y="7" width="1" height="17" fill="#2ebd85" />
        </svg>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-wide text-white">
            Trade <span className="text-accent">Koinos</span>
          </div>
          <div className="text-[10px] uppercase tracking-widest text-ink-400">
            on-chain orderbook · {NETWORK}
          </div>
        </div>
      </div>

      <div className="flex-1" />

      {account && (
        <div className="hidden items-center gap-3 rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs md:flex">
          {TOKENS.map((token) => (
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
        <button
          onClick={disconnect}
          title="Disconnect"
          className="rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 font-mono text-xs text-ink-300 transition hover:border-down hover:text-down"
        >
          {shortAddress(account)}
        </button>
      ) : isKondorAvailable() ? (
        <button
          onClick={connect}
          disabled={connecting}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {connecting ? "Connecting…" : "Connect Kondor"}
        </button>
      ) : (
        <a
          href="https://chromewebstore.google.com/detail/kondor/ghipkefkpgkladckmlmdnadmcchefhjl"
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Install Kondor
        </a>
      )}
    </header>
  );
}
