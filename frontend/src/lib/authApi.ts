/**
 * Talks to the Google sign-in bridge in `server/`.
 *
 * The app is also deployed as flat files with no server behind it, so every
 * call here is written to fail soft: when /api/config is missing (or a static
 * host answers the SPA shell instead of JSON) Google sign-in simply reports
 * itself unavailable and the UI stays Kondor-only.
 */

export interface AuthConfig {
  google: boolean;
  googleClientId: string | null;
}

export interface GoogleLoginResult {
  wif: string;
  address: string;
  label: string;
  created: boolean;
}

const OFF: AuthConfig = { google: false, googleClientId: null };

/**
 * Ask the server whether Google sign-in is configured. Never throws — an
 * unreachable or absent API means "no Google here".
 */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const response = await fetch("/api/config", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return OFF;
    // a static host with an SPA fallback answers index.html for /api/config
    const type = response.headers.get("content-type") || "";
    if (!type.includes("application/json")) return OFF;
    const body = await response.json();
    const auth = body?.auth;
    if (!auth?.google || !auth?.googleClientId) return OFF;
    return { google: true, googleClientId: String(auth.googleClientId) };
  } catch {
    return OFF;
  }
}

/**
 * Exchange a Google ID token for the wallet that identity owns.
 *
 * The server forwards it to Aurvania, which is what makes the address the
 * same one this Google account uses on Aurvania and OURO. Unlike the config
 * probe this does throw: a failed sign-in is something the user must see.
 */
export async function loginWithGoogle(
  idToken: string
): Promise<GoogleLoginResult> {
  let response: Response;
  try {
    response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "google", idToken }),
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

  if (!response.ok || !body?.wif || !body?.address) {
    throw new Error(body?.error || "Google sign-in failed");
  }

  return {
    wif: String(body.wif),
    address: String(body.address),
    label: String(body.label || "Google account"),
    created: !!body.created,
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
