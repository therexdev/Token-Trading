import { useStore } from "../store/useStore";

/**
 * Modal listing the accounts Kondor shared with the site so the user can
 * pick which one to trade with (instead of the app silently taking the
 * wallet's first account). Opens whenever the store has accountChoices.
 */
export function AccountPicker() {
  const accountChoices = useStore((state) => state.accountChoices);
  const account = useStore((state) => state.account);
  const chooseAccount = useStore((state) => state.chooseAccount);
  const connect = useStore((state) => state.connect);
  const connecting = useStore((state) => state.connecting);
  const dismissAccountChoices = useStore(
    (state) => state.dismissAccountChoices
  );

  if (!accountChoices) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-black/60"
        onClick={dismissAccountChoices}
      />
      <div className="relative w-full max-w-sm animate-fade-in rounded-lg border border-ink-600 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <span className="text-sm font-bold text-white">Select an account</span>
          <button
            onClick={dismissAccountChoices}
            aria-label="Close"
            className="-mr-1 flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[60dvh] overflow-y-auto p-2">
          {accountChoices.map((choice) => {
            const isCurrent = choice.address === account;
            return (
              <button
                key={choice.address}
                onClick={() => chooseAccount(choice.address)}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition hover:bg-ink-800 ${
                  isCurrent ? "bg-ink-850" : ""
                }`}
              >
                <span className="min-w-0">
                  {choice.name && (
                    <span className="block truncate text-sm font-semibold text-white">
                      {choice.name}
                    </span>
                  )}
                  <span className="block truncate font-mono text-xs text-ink-300">
                    {choice.address}
                  </span>
                </span>
                {isCurrent && (
                  <span className="shrink-0 rounded border border-up/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-up">
                    connected
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="border-t border-ink-700 px-4 py-2.5 text-[10px] leading-relaxed text-ink-500">
          Missing an account? Kondor decides which accounts it shares with
          this site.{" "}
          <button
            onClick={() => void connect()}
            disabled={connecting}
            className="font-semibold text-accent transition hover:underline disabled:opacity-50"
          >
            {connecting ? "Asking Kondor…" : "Ask Kondor again"}
          </button>{" "}
          and tick it in the popup — or unlink this site under Kondor&apos;s
          settings and reconnect to choose accounts from scratch.
        </div>
      </div>
    </div>
  );
}
