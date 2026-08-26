/* ============================================================
   Google sign-in — bridged to Aurvania, custodial NOWHERE here.

   The same Google account must open the same Koinos wallet on Trade Koinos,
   Aurvania and OURO. That shared address does not come from any derivation
   we could reproduce locally — it comes from Aurvania's account store, which
   holds the encrypted key and releases the WIF on a verified login. So this
   module is a thin, stateless bridge: it forwards the Google ID token to
   aurvania.quest/api/account and hands back whatever wallet Aurvania says
   that identity owns.

   Consequences worth keeping in mind when editing:
     - We store nothing. No key file, no LOGIN_SECRET, no database. Unlike
       the Discover Koinos gateway (which also custodies X logins itself),
       this server never holds a private key at rest.
     - The ID token must be minted for AURVANIA's Google client id, because
       Aurvania checks `aud` against its own. Set GOOGLE_CLIENT_ID to it, or
       leave it unset and we inherit it from Aurvania at boot.
     - The WIF passes through this process in memory on its way to the
       browser. It is never logged and never written to disk.
   ============================================================ */
'use strict';

function createAuth(cfg) {
  const {
    googleClientId = '',
    aurvaniaApi = 'https://aurvania.quest',
    // aurvania.quest's host 403s unfamiliar User-Agents, so the bridge
    // speaks with a curl-like identity (the pattern OURO and the Discover
    // Koinos gateway already ship).
    bridgeUa = 'curl/8.5.0 (Trade-Koinos)',
  } = cfg;

  /* The Google client id we actually serve to the browser. An operator-set
     one wins; otherwise warmup() inherits Aurvania's so the ID token the
     browser mints is one Aurvania will accept. */
  let resolvedGoogleCid = String(googleClientId || '').trim();

  async function bridgeFetch(url, opts = {}) {
    const { timeoutMs = 12000, headers = {}, ...rest } = opts;
    const r = await fetch(url, {
      ...rest,
      headers: { 'User-Agent': bridgeUa, Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try { body = await r.json(); } catch (_) { /* non-JSON error page */ }
    return { ok: r.ok, status: r.status, body };
  }

  /* Best-effort at boot. If Aurvania is unreachable Google stays off and the
     app still works with Kondor — the button simply never appears. */
  async function warmup() {
    if (resolvedGoogleCid) return;
    try {
      const r = await bridgeFetch(aurvaniaApi + '/api/chain-info', { timeoutMs: 12000 });
      if (r.ok && r.body && r.body.googleClientId) {
        resolvedGoogleCid = String(r.body.googleClientId);
      }
    } catch (_) { /* leave Google disabled until a later restart or an explicit id */ }
  }

  /* The email is only the label on the account button. Aurvania performs the
     real verification, so reading the unverified payload here is fine — it
     never gates anything. */
  function jwtEmail(idToken) {
    try {
      const seg = String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const p = JSON.parse(Buffer.from(seg, 'base64').toString('utf8'));
      return p && p.email ? String(p.email) : '';
    } catch (_) { return ''; }
  }

  const googleEnabled = () => !!resolvedGoogleCid;

  async function google(idToken) {
    if (!googleEnabled()) {
      const e = new Error('Google sign-in is not configured on this server');
      e.status = 503; throw e;
    }
    if (!idToken) {
      const e = new Error('idToken required');
      e.status = 400; throw e;
    }

    let r;
    try {
      r = await bridgeFetch(aurvaniaApi + '/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'google', idToken }),
        timeoutMs: 15000,
      });
    } catch (_) {
      const e = new Error('Could not reach the Koinos account service — try again shortly');
      e.status = 502; throw e;
    }

    if (!r.ok || !r.body || !r.body.wif) {
      /* Pass Aurvania's own reason through. A client id minted for the wrong
         app surfaces here as "belongs to a different app", which points
         straight at the real fix. */
      const e = new Error((r.body && r.body.error) || 'Google sign-in failed');
      e.status = r.status || 502; throw e;
    }

    return {
      wif: r.body.wif,
      address: r.body.address,
      created: !!r.body.created,
      label: jwtEmail(idToken) || 'Google account',
    };
  }

  return {
    warmup,
    google,
    googleEnabled,
    googleClientId: () => resolvedGoogleCid,
    aurvania: () => aurvaniaApi,
  };
}

module.exports = { createAuth };
