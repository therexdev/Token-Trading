import type { DexToken } from "../../lib/koindx/model";
import { useStore } from "../../store/useStore";
import { TokenLogo } from "../launchpad/shared";

export function SwapToken({ token }: { token: DexToken }) {
  const pushToast = useStore((s) => s.pushToast);
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(token.address);
      pushToast({ kind: "success", title: `${token.symbol} address copied` });
    } catch {
      pushToast({
        kind: "info",
        title: `${token.symbol} contract address`,
        detail: token.address,
      });
    }
  }
  return (
    <div className="ml-auto flex max-w-[60%] shrink-0 items-center gap-2">
      <TokenLogo
        key={token.address}
        address={token.address}
        symbol={token.symbol}
        size={28}
      />
      <span className="truncate text-base font-semibold" title={token.symbol}>
        {token.symbol}
      </span>
      <button
        type="button"
        aria-label={`Copy ${token.symbol} contract address`}
        title={`Copy ${token.symbol} contract address`}
        onClick={() => void copyAddress()}
        className="-mr-1 shrink-0 rounded-lg p-1.5 text-ink-300 transition hover:bg-ink-700 hover:text-white focus-visible:outline focus-visible:outline-accent"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="8" y="8" width="12" height="13" rx="2" />
          <path d="M16 4H5a2 2 0 0 0-2 2v11" />
        </svg>
      </button>
    </div>
  );
}
