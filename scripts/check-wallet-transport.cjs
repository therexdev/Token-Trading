'use strict';

// Creates and revokes an unapproved session. Never requests a signature or
// transaction, and never prints the pairing URL, response body, or credentials.
async function checkWalletTransport({
  walletOrigin = 'https://koinvault.app',
  tradeOrigin = 'https://app.tradekoinos.com',
  fetchImpl = fetch,
} = {}) {
  for (const origin of [walletOrigin, tradeOrigin]) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
      throw new Error('Deployment checks require HTTPS origins without paths or credentials');
    }
  }
  async function post(route, body) {
    let response;
    try {
      response = await fetchImpl(walletOrigin + '/api/dapp/' + route, {
        method: 'POST', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Origin: tradeOrigin },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
      });
    } catch (_) { throw new Error('Wallet compatibility request failed: ' + route); }
    let data;
    try { data = await response.json(); }
    catch (_) { throw new Error('Wallet returned invalid JSON: ' + route); }
    if (!response.ok || data?.ok !== true) throw new Error('Wallet rejected compatibility request: ' + route);
    return { data, cors: response.headers.get('access-control-allow-origin') };
  }
  // Node can POST JSON even when a browser's mandatory CORS preflight would
  // block it. Check every route the paired-wallet client needs before creating
  // a session; OPTIONS never asks the wallet to approve or sign anything.
  for (const route of ['create', 'status', 'request', 'request-status', 'disconnect']) {
    let response;
    try {
      response = await fetchImpl(walletOrigin + '/api/dapp/' + route, {
        method: 'OPTIONS', redirect: 'error', cache: 'no-store',
        headers: { Origin: tradeOrigin, 'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type' },
        signal: AbortSignal.timeout(20000),
      });
    } catch (_) { throw new Error('Wallet compatibility preflight failed: ' + route); }
    const has = (header, value) => (response.headers.get(header) || '')
      .split(',').map(item => item.trim().toLowerCase()).includes(value);
    if (!response.ok || response.headers.get('access-control-allow-origin') !== tradeOrigin
        || !has('access-control-allow-methods', 'post')
        || !has('access-control-allow-headers', 'content-type')) {
      throw new Error('Wallet browser CORS preflight is incompatible: ' + route);
    }
  }
  let credentials;
  try {
    const { data: pair, cors } = await post('create', {
      name: 'Trade Koinos deployment check', protocolVersion: 2,
    });
    if (typeof pair.sessionId !== 'string' || !pair.sessionId
        || typeof pair.secret !== 'string' || !pair.secret) {
      throw new Error('Wallet returned invalid pairing credentials');
    }
    credentials = { sessionId: pair.sessionId, secret: pair.secret };
    if (pair.protocolVersion !== 2) throw new Error('Deploy KOIN Vault protocol 2 before releasing Trade');
    let uri;
    try { uri = new URL(pair.uri); }
    catch (_) { throw new Error('Wallet returned an invalid pairing URL'); }
    const fragment = new URLSearchParams(uri.hash.slice(1));
    if (uri.origin !== walletOrigin || uri.pathname !== '/' || uri.search || uri.username || uri.password
        || fragment.get('connect') !== pair.sessionId || fragment.get('secret') !== pair.secret) {
      throw new Error('Wallet pairing URL does not match the required secure transport');
    }
    if (cors !== tradeOrigin) throw new Error('Wallet pairing CORS does not allow the Trade origin');
    const status = await post('status', credentials);
    if (status.cors !== tradeOrigin || status.data.connected !== false) {
      throw new Error('Wallet POST polling or origin policy is incompatible');
    }
  } finally {
    if (credentials) await post('disconnect', credentials);
  }
}

module.exports = { checkWalletTransport };
if (require.main === module) {
  checkWalletTransport({ walletOrigin: process.env.BIO_WALLET_API || undefined,
    tradeOrigin: process.env.TRADE_ORIGIN || undefined })
    .then(() => console.log('Wallet protocol 2 pairing, browser CORS preflights, POST polling, and disconnect passed.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
