import { useStore } from "../store/useStore";
import { BIO_WALLET_API } from "../lib/bioWallet";
import { EXPLORER_TX } from "../config/tokens";
import { transactionErrorToast } from "../lib/transactionStatus";
import type { Toast } from "../store/useStore";

const KIND_STYLES: Record<string, string> = {
  pending: "border-accent/50",
  success: "border-up/50",
  error: "border-down/50",
  info: "border-ink-500",
};

export function Toasts() {
  const authMethod = useStore((state) => state.authMethod);
  const toasts = useStore((state) => state.toasts);
  const dismissToast = useStore((state) => state.dismissToast);
  const checkTransaction = async (toast: Toast) => {
    if (!toast.checkStatus) return;
    const store = useStore.getState();
    store.dismissToast(toast.id);
    const checking = store.pushToast({ kind: "pending", title: "Checking transaction…", txId: toast.txId });
    try {
      await toast.checkStatus();
      store.pushToast({ kind: "success", title: "Transaction included", txId: toast.txId });
      void store.refreshMarkets();
      void store.refreshMarketData();
      void store.refreshUser();
    } catch (error) {
      store.pushToast(transactionErrorToast(error, "Could not check transaction"));
    } finally { store.dismissToast(checking); }
  };

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+4.5rem)] z-50 flex flex-col gap-2 lg:inset-x-auto lg:bottom-4 lg:right-4 lg:w-80">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-md border bg-ink-850 p-3 shadow-xl ${KIND_STYLES[toast.kind]}`}
        >
          <div className="flex items-start gap-2">
            {toast.kind === "pending" && (
              <span className="mt-0.5 h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            )}
            {toast.kind === "success" && (
              <span className="mt-0.5 text-up">✓</span>
            )}
            {toast.kind === "error" && (
              <span className="mt-0.5 text-down">✕</span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white">
                {toast.title}
              </div>
              {toast.detail && (
                <div className="mt-0.5 break-words text-[11px] text-ink-300">
                  {toast.detail}
                </div>
              )}
              {authMethod === "bio" && toast.kind === "pending" && !toast.txId && (
                <a href={BIO_WALLET_API + "/"} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs text-accent underline">Open KOIN Vault to approve</a>
              )}
              {toast.txId && (
                <a
                  href={EXPLORER_TX(toast.txId)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 block truncate text-[11px] text-accent hover:underline"
                >
                  view transaction ↗
                </a>
              )}
              {toast.checkStatus && (
                <button type="button" onClick={() => void checkTransaction(toast)} className="mt-2 text-xs text-accent underline">
                  Check status
                </button>
              )}
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-ink-500 transition hover:text-white"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
