import { useStore } from "../store/useStore";
import { EXPLORER_TX } from "../config/tokens";

const KIND_STYLES: Record<string, string> = {
  pending: "border-accent/50",
  success: "border-up/50",
  error: "border-down/50",
  info: "border-ink-500",
};

export function Toasts() {
  const toasts = useStore((state) => state.toasts);
  const dismissToast = useStore((state) => state.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
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
