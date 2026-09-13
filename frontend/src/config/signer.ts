/**
 * Where Google sign-in and signing happen.
 *
 * Trade Koinos is a static bundle with no server of its own. Google accounts
 * sign in and sign transactions through usekoinos.com, which custodies the key
 * and hands back a session token (never the key). Point this at that gateway.
 *
 * Use the existing gateway by default so static builds work without a host
 * environment variable. An explicitly empty value disables Google sign-in.
 */
export const SIGNER_API: string = (
  import.meta.env.VITE_SIGNER_API ?? "https://usekoinos.com"
).trim().replace(/\/+$/, "");

export const SIGNER_ENABLED: boolean = !!SIGNER_API;
