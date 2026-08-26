import { Signer } from "koilib";
import type { SignerInterface } from "koilib";

/**
 * Session-scoped custody for a Google account's key.
 *
 * Signing in with Google hands this browser a real private key (the WIF
 * Aurvania released), so from that moment the tab can move funds on its own —
 * unlike Kondor, which keeps the key in the extension and only ever returns a
 * signature.
 *
 * That is why this key is deliberately shorter-lived than the one the
 * Discover Koinos gateway keeps: there a stolen key costs a free NFT, here it
 * controls balances and anything escrowed in the orderbook. So:
 *
 *   - the key lives in a module-level variable (memory);
 *   - it is mirrored to sessionStorage, not localStorage, so a refresh keeps
 *     you signed in but closing the tab ends the session and nothing is left
 *     on disk;
 *   - it never leaves this module — callers get a Signer, never the WIF.
 *
 * Signing back in is one Google popup, so the cost of the shorter lifetime is
 * small and it is the same wallet every time.
 */

const SESSION_WIF = "koinoskit-trade:session-wif";
const SESSION_LABEL = "koinoskit-trade:session-label";

let memoryWif: string | null = null;
let memoryLabel: string | null = null;
let cachedSigner: SignerInterface | null = null;
let cachedFor: string | null = null;

/** Safari in private mode throws on any sessionStorage access. */
function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // memory-only for this session
  }
}

function currentWif(): string | null {
  if (memoryWif) return memoryWif;
  const stored = readSession(SESSION_WIF);
  if (stored) memoryWif = stored;
  return memoryWif;
}

/**
 * Adopt the key a Google sign-in released. Returns the address it derives, so
 * the caller can verify it against what the server reported rather than
 * trusting either side alone.
 */
export function adoptWif(wif: string): string {
  const trimmed = String(wif).trim();
  // Signer.fromWif throws on a malformed key, which is the validation we want
  // before anything is stored.
  const signer = Signer.fromWif(trimmed);
  const address = signer.getAddress();
  memoryWif = trimmed;
  cachedSigner = signer as unknown as SignerInterface;
  cachedFor = address;
  writeSession(SESSION_WIF, trimmed);
  return address;
}

export function setSessionLabel(label: string | null): void {
  memoryLabel = label;
  writeSession(SESSION_LABEL, label);
}

export function getSessionLabel(): string | null {
  if (memoryLabel) return memoryLabel;
  memoryLabel = readSession(SESSION_LABEL);
  return memoryLabel;
}

/**
 * The address the held key controls, or null when there is no session key.
 * Used on boot to decide whether a remembered Google account is still live in
 * this tab or has to sign in again.
 */
export function sessionAddress(): string | null {
  const wif = currentWif();
  if (!wif) return null;
  try {
    if (cachedFor && cachedSigner) return cachedFor;
    const signer = Signer.fromWif(wif);
    cachedSigner = signer as unknown as SignerInterface;
    cachedFor = signer.getAddress();
    return cachedFor;
  } catch {
    // a corrupted entry is not recoverable — drop it rather than wedge boot
    clearSessionKey();
    return null;
  }
}

/** Signer for the held key, or null when this tab has none. */
export function getSessionSigner(): SignerInterface | null {
  const wif = currentWif();
  if (!wif) return null;
  if (cachedSigner) return cachedSigner;
  try {
    const signer = Signer.fromWif(wif);
    cachedSigner = signer as unknown as SignerInterface;
    cachedFor = signer.getAddress();
    return cachedSigner;
  } catch {
    clearSessionKey();
    return null;
  }
}

export function clearSessionKey(): void {
  memoryWif = null;
  memoryLabel = null;
  cachedSigner = null;
  cachedFor = null;
  writeSession(SESSION_WIF, null);
  writeSession(SESSION_LABEL, null);
}
