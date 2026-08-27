/**
 * Talks to the Google sign-in + signer on usekoinos.com (SIGNER_API).
 *
 * Signing in no longer brings a private key into this page. usekoinos verifies
 * the Google token, custodies the key, and returns a short-lived SESSION
 * TOKEN; transactions are signed by usekoinos (see remoteSigner.ts). The key
 * never touches the browser.
 *
 * Every call fails soft: when SIGNER_API is unset (a plain static deploy) or
 * usekoinos is unreachable, Google reports itself unavailable and the app runs
 * Kondor-only, exactly as before.
 */
import { SIGNER_API } from "../config/signer";

export interface AuthConfig {
  google: boolean;
  googleClientId: string | null;
}

export interface GoogleSessionResult {
  token: string;
  address: string;
  label: string;
}

const OFF: AuthConfig = { google: false, googleClientId: null };

/**
 * Ask usekoinos whether Google sign-in / signing is configured. Never throws —
 * an unset SIGNER_API, an unreachable host, or a non-JSON answer all mean
 * "no Google here", and the app stays Kondor-only.
 */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  if (!SIGNER_API) return OFF;
  try {
    const response = await fetch(`${SIGNER_API}/api/signer-config`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return OFF;
    const type = response.headers.get("content-type") || "";
    if (!type.includes("application/json")) return OFF;
    const body = await response.json();
    if (!body?.signer || !body?.google || !body?.googleClientId) return OFF;
    return { google: true, googleClientId: String(body.googleClientId) };
  } catch {
    return OFF;
  }
}

/**
 * Exchange a Google ID token for a signing SESSION on usekoinos.
 *
 * Returns a session token and the account address — never a key. The address
 * is the same one this Google account uses on Aurvania and OURO. Unlike the
 * config probe this throws: a failed sign-in is something the user must see.
 */
export async function loginWithGoogle(
  idToken: string
): Promise<GoogleSessionResult> {
  if (!SIGNER_API) throw new Error("Google sign-in is not configured");
  let response: Response;
  try {
    response = await fetch(`${SIGNER_API}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error("Could not reach the sign-in service — try again shortly");
  }

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // fall through to the status-based message below
  }

  if (!response.ok || !body?.token || !body?.address) {
    throw new Error(body?.error || "Google sign-in failed");
  }

  return {
    token: String(body.token),
    address: String(body.address),
    label: String(body.label || "Google account"),
  };
}

/* ---------------------------------------------------------------------------
 * Google Identity Services
 * ------------------------------------------------------------------------ */

let gsiPromise: Promise<void> | null = null;

const GSI_TIMEOUT_MS = 8000;
const GSI_BLOCKED =
  "Google sign-in could not load — check for script or tracker blockers, or use Kondor";

/**
 * Load Google's script once. Rejects if it is blocked or never lands.
 *
 * The timeout is not belt-and-braces: a tracker blocker or a filtering proxy
 * usually stalls the request rather than failing it, so `onerror` never fires
 * and without this the button would sit at "loading…" for good above a dead
 * click target.
 */
export function loadGoogleIdentity(): Promise<void> {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise<void>((resolve, reject) => {
    if ((window as any).google?.accounts?.id) return resolve();

    const timer = setTimeout(() => reject(new Error(GSI_BLOCKED)), GSI_TIMEOUT_MS);
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () =>
      settle(() =>
        (window as any).google?.accounts?.id
          ? resolve()
          : reject(new Error("Google sign-in loaded but did not initialise"))
      );
    script.onerror = () => settle(() => reject(new Error(GSI_BLOCKED)));
    document.head.appendChild(script);
  }).catch((error) => {
    // let a later attempt retry instead of caching the failure forever
    gsiPromise = null;
    throw error;
  });
  return gsiPromise;
}

/**
 * Render Google's own button into `slot` and resolve with the ID token once
 * the user completes the popup.
 *
 * Only Google's iframe may open that popup and it cannot be restyled, so the
 * caller stretches its own button underneath and renders this one nearly
 * invisible over the top — the same approach Aurvania, OURO and the Discover
 * Koinos gateway use.
 */
export async function renderGoogleButton(
  slot: HTMLElement,
  clientId: string,
  width: number,
  onToken: (idToken: string) => void,
  onError: (message: string) => void
): Promise<void> {
  await loadGoogleIdentity();
  const gsi = (window as any).google.accounts.id;
  gsi.initialize({
    client_id: clientId,
    ux_mode: "popup",
    callback: (response: { credential?: string }) => {
      if (response?.credential) onToken(response.credential);
      else onError("Google did not return a sign-in token");
    },
  });
  slot.innerHTML = "";
  gsi.renderButton(slot, {
    theme: "filled_black",
    size: "large",
    text: "continue_with",
    shape: "rectangular",
    width: Math.max(200, Math.min(400, Math.round(width) || 320)),
  });
}

/**
 * Show Google One Tap — the small "Continue as …" chip — so a visitor who is
 * already signed into Google (and has used this wallet before) lands on the
 * page and is one tap from signed in, without opening the connect modal.
 *
 * Deliberately NOT `auto_select` (which would sign in with no interaction):
 * this is a funds-holding app, so a live signing session should follow a
 * deliberate tap, not merely opening the tab. Fails soft — if GSI is blocked
 * or One Tap is suppressed, nothing happens and the connect button still works.
 */
export async function showGoogleOneTap(
  clientId: string,
  onToken: (idToken: string) => void
): Promise<void> {
  try {
    await loadGoogleIdentity();
  } catch {
    return; // blocked/unavailable — the manual connect button remains
  }
  const gsi = (window as any).google?.accounts?.id;
  if (!gsi) return;
  gsi.initialize({
    client_id: clientId,
    auto_select: false,
    cancel_on_tap_outside: true,
    callback: (response: { credential?: string }) => {
      if (response?.credential) onToken(response.credential);
    },
  });
  try {
    gsi.prompt();
  } catch {
    // One Tap can throw if suppressed (cooldown, no session) — harmless
  }
}
