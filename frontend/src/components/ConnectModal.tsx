import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import { isKondorAvailable } from "../lib/koinos";
import { renderGoogleButton } from "../lib/authApi";
import { SIGNER_ENABLED } from "../config/signer";
import { QRCodeSVG } from "qrcode.react";
import { createBioPair, readBioPair, type BioPair } from "../lib/bioWallet";

const KONDOR_URL =
  "https://chromewebstore.google.com/detail/kondor/ghipkefkpgkladckmlmdnadmcchefhjl";

/** Wallet chooser with independent Google configuration and script states. */
export function ConnectModal({ onClose }: { onClose: () => void }) {
  const connect = useStore((state) => state.connect);
  const connecting = useStore((state) => state.connecting);
  const signInWithGoogle = useStore((state) => state.signInWithGoogle);
  const authConfig = useStore((state) => state.authConfig);
  const refreshAuthConfig = useStore((state) => state.refreshAuthConfig);
  const connectBio = useStore((state) => state.connectBio);

  const slotRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleAttempt, setGoogleAttempt] = useState(0);
  const googleAvailable = !!(authConfig?.google && authConfig.googleClientId);
  const [bioPair, setBioPair] = useState<BioPair | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);
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
    setGoogleReady(false);
    setGoogleError(null);
    if (!googleAvailable || !clientId || !slot) return;
    const controller = new AbortController();

    void renderGoogleButton(
      slot,
      clientId,
      wrapRef.current?.getBoundingClientRect().width || 320,
      (idToken) => {
        if (controller.signal.aborted) return;
        onClose();
        void signInWithGoogle(idToken);
      },
      (message) => {
        if (!controller.signal.aborted) setGoogleError(message);
      },
      controller.signal
    )
      .then(() => {
        if (!controller.signal.aborted) setGoogleReady(true);
      })
      .catch((error: any) => {
        if (!controller.signal.aborted) setGoogleError(error?.message || String(error));
      });

    return () => {
      controller.abort();
      slot.replaceChildren();
    };
  }, [authConfig?.googleClientId, googleAvailable, googleAttempt, onClose, signInWithGoogle]);

  useEffect(() => {
    if (!bioPair) return;
    let stopped = false;
    const check = async () => {
      try {
        const status = await readBioPair(bioPair);
        if (!stopped && status.connected && status.address) {
          connectBio({ sessionId: bioPair.sessionId, secret: bioPair.secret, address: String(status.address) });
          onClose();
        }
      } catch (error: any) { if (!stopped) setBioError(error?.message || "Connection expired"); }
    };
    void check(); const timer = setInterval(check, 1500);
    return () => { stopped = true; clearInterval(timer); };
  }, [bioPair, connectBio, onClose]);

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
          {bioPair ? (
            <div className="rounded-md border border-ink-600 bg-white p-4 text-center">
              <QRCodeSVG value={bioPair.uri} size={210} className="mx-auto max-w-full" />
              <p className="mt-3 text-xs font-semibold text-ink-900">Scan with your phone camera, then sign in and approve in KOIN Vault.</p>
              <a href={bioPair.uri} target="_blank" rel="noopener noreferrer" className="mt-3 block rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white">Open KOIN Vault on this device</a>
              <button onClick={() => { setBioPair(null); setBioError(null); }} className="mt-2 text-xs text-ink-600 underline">Choose another wallet</button>
            </div>
          ) : (
            <button
              onClick={() => { setBioError(null); void createBioPair().then(setBioPair).catch((e) => setBioError(e.message)); }}
              className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Connect KOIN Vault
            </button>
          )}
          {bioError && <p className="text-xs leading-relaxed text-down">{bioError}</p>}

          {!bioPair && <>
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

          </>}

          {SIGNER_ENABLED && <>
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-ink-500">
              <span className="h-px flex-1 bg-ink-700" />
              or
              <span className="h-px flex-1 bg-ink-700" />
            </div>

            <div ref={wrapRef}>
              <div
                ref={slotRef}
                className="flex justify-center"
                style={{ colorScheme: "light" }}
              />
              {(!authConfig || (googleAvailable && !googleReady && !googleError)) && (
                <p role="status" className="py-2.5 text-center text-xs text-ink-400">
                  Loading Google sign-in…
                </p>
              )}
            </div>

            {googleError || (authConfig && !googleAvailable) ? (
              <div className="space-y-2">
                <p role="alert" className="text-xs leading-relaxed text-down">
                  {googleError || "Google sign-in is temporarily unavailable. Try again or connect with another wallet."}
                </p>
                <button
                  onClick={() => {
                    setGoogleError(null);
                    setGoogleReady(false);
                    if (!googleAvailable) void refreshAuthConfig();
                    else setGoogleAttempt((attempt) => attempt + 1);
                  }}
                  className="w-full rounded-md border border-ink-600 bg-ink-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:border-accent"
                >
                  Retry Google sign-in
                </button>
              </div>
            ) : googleAvailable && (
              <p className="text-xs leading-relaxed text-ink-400">
                Google opens the same Koinos wallet you use on Aurvania and OURO.
                Your key never touches this page — usekoinos.com signs each trade
                for you, and the sign-in lasts this browsing session.
              </p>
            )}
          </>}

        </div>
      </div>
    </div>
  );
}
