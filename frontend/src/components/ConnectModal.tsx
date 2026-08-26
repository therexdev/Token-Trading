import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import { isKondorAvailable } from "../lib/koinos";
import { renderGoogleButton } from "../lib/authApi";

const KONDOR_URL =
  "https://chromewebstore.google.com/detail/kondor/ghipkefkpgkladckmlmdnadmcchefhjl";

/**
 * Sign-in chooser, shown only where Google is actually configured — with no
 * server behind the app the header still connects straight to Kondor and this
 * never opens.
 */
export function ConnectModal({ onClose }: { onClose: () => void }) {
  const connect = useStore((state) => state.connect);
  const connecting = useStore((state) => state.connecting);
  const signInWithGoogle = useStore((state) => state.signInWithGoogle);
  const authConfig = useStore((state) => state.authConfig);

  const slotRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const kondor = isKondorAvailable();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const clientId = authConfig?.googleClientId;
    const slot = slotRef.current;
    if (!clientId || !slot) return;
    let cancelled = false;

    void renderGoogleButton(
      slot,
      clientId,
      wrapRef.current?.getBoundingClientRect().width || 320,
      (idToken) => {
        if (cancelled) return;
        onClose();
        void signInWithGoogle(idToken);
      },
      (message) => {
        if (!cancelled) setGoogleError(message);
      }
    )
      .then(() => {
        if (!cancelled) setGoogleReady(true);
      })
      .catch((error: any) => {
        if (!cancelled) setGoogleError(error?.message || String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [authConfig?.googleClientId, onClose, signInWithGoogle]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-black/60"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm animate-fade-in rounded-lg border border-ink-600 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <span className="text-sm font-bold text-white">Sign in to trade</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 p-4">
          {kondor ? (
            <button
              onClick={() => {
                onClose();
                void connect();
              }}
              disabled={connecting}
              className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect Kondor"}
            </button>
          ) : (
            <a
              href={KONDOR_URL}
              target="_blank"
              rel="noreferrer"
              className="block w-full rounded-md bg-accent px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:brightness-110"
            >
              Install Kondor
            </a>
          )}

          <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-ink-500">
            <span className="h-px flex-1 bg-ink-700" />
            or
            <span className="h-px flex-1 bg-ink-700" />
          </div>

          {/*
            Google's iframe is the only thing allowed to open the sign-in
            popup and it cannot be restyled, so it is rendered nearly
            invisible and stretched over a button that matches the rest of
            the app. The click lands on Google's iframe; the user sees ours.
          */}
          <div ref={wrapRef} className="relative">
            <div
              aria-hidden="true"
              className={`flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-semibold transition ${
                googleError
                  ? "border-ink-700 bg-ink-850 text-ink-500"
                  : "border-ink-600 bg-ink-800 text-white"
              }`}
            >
              <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
                />
              </svg>
              Continue with Google
            </div>
            <div
              ref={slotRef}
              className="absolute inset-0 overflow-hidden opacity-[0.001]"
              style={{ colorScheme: "light" }}
            />
            {!googleReady && !googleError && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-ink-900/60 text-xs text-ink-400">
                loading…
              </div>
            )}
          </div>

          {googleError ? (
            <p className="text-xs leading-relaxed text-down">{googleError}</p>
          ) : (
            <p className="text-xs leading-relaxed text-ink-400">
              Google opens the same Koinos wallet you use on Aurvania and OURO.
              For safety on a trading app the key is held for this tab only —
              close it and you sign in again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
