import type { SignerInterface } from "koilib";
import { RemoteSigner } from "./remoteSigner";

/**
 * Session state for a Google account — which now holds NO private key.
 *
 * Signing in with Google gives this tab a short-lived session token and the
 * account address. The key stays on usekoinos.com; signing happens there (see
 * remoteSigner.ts). So the worst an XSS can do is ask usekoinos to sign during
 * the token's lifetime, through a rate-limited endpoint — it can never walk
 * off with a key, because there is none here.
 *
 * The token lives in sessionStorage, never localStorage: a refresh keeps you
 * signed in, closing the tab ends the session, and nothing persists to disk.
 * (This file kept its name from when it held a WIF; it no longer does.)
 */

const SESSION_TOKEN = "koinoskit-trade:session-token";
const SESSION_ADDR = "koinoskit-trade:session-addr";
const SESSION_LABEL = "koinoskit-trade:session-label";

let memToken: string | null = null;
let memAddr: string | null = null;
let memLabel: string | null = null;
let cachedSigner: RemoteSigner | null = null;

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // memory-only this session
  }
}

function token(): string | null {
  if (memToken) return memToken;
  memToken = read(SESSION_TOKEN);
  return memToken;
}

/**
 * Adopt the session a Google sign-in returned. No key is involved — only a
 * token authorizing this account to sign through usekoinos.
 */
export function adoptSession(
  tokenValue: string,
  address: string,
  label: string,
): void {
  memToken = String(tokenValue);
  memAddr = String(address);
  memLabel = label;
  cachedSigner = null; // rebuilt on next use with the new token
  write(SESSION_TOKEN, memToken);
  write(SESSION_ADDR, memAddr);
  write(SESSION_LABEL, memLabel);
}

export function setSessionLabel(label: string | null): void {
  memLabel = label;
  write(SESSION_LABEL, label);
}
export function getSessionLabel(): string | null {
  if (memLabel) return memLabel;
  memLabel = read(SESSION_LABEL);
  return memLabel;
}

/** The address this session controls, or null when there is no live session. */
export function sessionAddress(): string | null {
  if (!token()) return null;
  if (memAddr) return memAddr;
  memAddr = read(SESSION_ADDR);
  return memAddr;
}

/**
 * A signer for the session account, or null when this tab has no session.
 * It is a RemoteSigner — signing goes to usekoinos, never a local key.
 */
export function getSessionSigner(): SignerInterface | null {
  const t = token();
  const addr = sessionAddress();
  if (!t || !addr) return null;
  if (cachedSigner && cachedSigner.getAddress() === addr) {
    return cachedSigner as unknown as SignerInterface;
  }
  cachedSigner = new RemoteSigner(addr, t, clearSessionKey);
  return cachedSigner as unknown as SignerInterface;
}

export function clearSessionKey(): void {
  memToken = null;
  memAddr = null;
  memLabel = null;
  cachedSigner = null;
  write(SESSION_TOKEN, null);
  write(SESSION_ADDR, null);
  write(SESSION_LABEL, null);
}
