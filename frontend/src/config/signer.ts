/**
 * Where Google sign-in and signing happen.
 *
 * Trade Koinos is a static bundle with no server of its own. Google accounts
 * sign in and sign transactions through usekoinos.com, which custodies the key
 * and hands back a session token (never the key). Point this at that gateway.
 *
 * Empty (the default when the build var is unset) disables the Google button
 * entirely, and the app runs Kondor-only exactly as it does today — so a plain
 * static deploy with no configuration is unchanged.
 */
export const SIGNER_API: string = (
  import.meta.env.VITE_SIGNER_API || ""
).replace(/\/+$/, "");

export const SIGNER_ENABLED: boolean = !!SIGNER_API;
