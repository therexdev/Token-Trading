const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/bioWallet.ts'), 'utf8').replaceAll('import.meta.env', 'TEST_ENV');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const session = { sessionId: 'session', secret: 'secret', address: 'account' };
const validUri = 'https://koinvault.app/#connect=session&secret=secret';
function setup({ uri = validUri, outcome = 'approved', protocolVersion = 2 } = {}) {
  const storage = new Map(), calls = [];
  const timers = new Map(), events = new EventTarget(), document = new EventTarget();
  document.hidden = false;
  let timerId = 0;
  const network = { status: 200, connected: true, address: 'account', wait: null };
  const context = {
    exports: {}, TEST_ENV: {}, URL, URLSearchParams, AbortSignal,
    document, window: events,
    setInterval: fn => { timers.set(++timerId, fn); return timerId; }, clearInterval: id => timers.delete(id),
    location: { origin: 'https://app.tradekoinos.com' },
    sessionStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    setTimeout: fn => fn(),
    fetch: async (url, init = {}) => {
      calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) });
      if (url.includes('/dapp/status')) {
        const reply = { ...network };
        if (reply.wait) await reply.wait;
        return { ok: reply.status === 200, status: reply.status, json: async () => ({ ok: reply.status === 200, connected: reply.connected, address: reply.address, error: 'connection unavailable' }) };
      }
      const data = url.endsWith('/create') ? { ok: true, ...session, uri, protocolVersion, expiresAt: Date.now() + 60000 }
        : url.includes('/request-status') ? { ok: true, status: outcome, txid: outcome === 'approved' ? 'confirmed-tx' : null, error: outcome === 'failed' ? 'chain refused' : null }
        : url.includes('/status') ? { ok: true, connected: true, address: session.address }
        : { ok: true, requestId: 'request' };
      return { ok: true, json: async () => data };
    },
  };
  vm.runInNewContext(code, context);
  return { api: context.exports, storage, calls, network, timers, events, document };
}
test('pair QR and all connection API calls use the new wallet domain', async () => {
  const { api, calls } = setup();
  const pair = await api.createBioPair();
  assert.equal(pair.uri, validUri);
  assert.equal(calls[0].url, 'https://koinvault.app/api/dapp/create');
  assert.equal(calls[0].body.walletUrl, 'https://koinvault.app');
  assert.equal(calls[0].body.protocolVersion, 2);
  assert.equal(new URL(pair.uri).search, '');
  const live = await api.readBioPair(pair);
  assert.equal(live.address, session.address);
  assert.equal(calls[1].url, 'https://koinvault.app/api/dapp/status');
  assert.equal(calls[1].method, 'POST'); assert.equal(calls[1].body.secret, session.secret);
});
test('foreign origins and mismatched QR credentials are rejected', async () => {
  for (const uri of [
    validUri.replace('koinvault.app', 'wallet.usekoinos.com'),
    validUri.replace('koinvault.app', 'koinvault.app.evil.example'),
    validUri.replace('connect=session', 'connect=wrong'),
    validUri.replace('secret=secret', 'secret=wrong'),
    validUri.replace('/#', '/other#'),
  ]) await assert.rejects(setup({ uri }).api.createBioPair(), /unexpected connection link/);
});
test('old sessions do not silently reconnect and new sessions stay address-bound', () => {
  const { api, storage } = setup();
  storage.set('trade-koinos:bio-wallet:v1', JSON.stringify(session));
  assert.equal(api.loadBioSession(), null);
  api.saveBioSession(session);
  assert.equal(api.loadBioSession().address, session.address);
  assert.equal(api.getBioSigner('other-address'), null);
  assert.equal(api.getBioSigner(session.address).getAddress(), session.address);
  api.saveBioSession(null); assert.equal(api.loadBioSession(), null);
});
test('approved transactions retain their operations and use only the new wallet relay', async () => {
  const { api, calls } = setup();
  const transaction = { operations: [{ call_contract: { contract_id: 'market', entry_point: 123, args: 'AA==' } }] };
  const result = await new api.BioWalletSigner(session).sendTransaction(transaction);
  assert.equal(result.transaction.id, 'confirmed-tx');
  assert.deepEqual(calls[0].body.operations, transaction.operations);
  assert.ok(calls.every(c => c.url.startsWith('https://koinvault.app/api/dapp/')));
  assert.ok(calls.every(c => !new URL(c.url).search && c.method === 'POST'));
  assert.equal(calls.at(-1).body.secret, session.secret);
  assert.equal(calls.filter(c => c.url.endsWith('/request')).length, 1);
});
for (const outcome of ['rejected', 'failed']) test(outcome + ' approval never resubmits a transaction', async () => {
  const { api, calls } = setup({ outcome });
  await assert.rejects(new api.BioWalletSigner(session).sendTransaction({ operations: [] }), outcome === 'rejected' ? /rejected/ : /chain refused/);
  assert.equal(calls.filter(c => c.url.endsWith('/request')).length, 1);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
test('an idle session detects wallet revocation and stops watching', async () => {
  const c = setup(); let ended = 0;
  c.api.watchBioSession(session, () => ended++); await flush();
  c.network.status = 404;
  for (const check of c.timers.values()) await check();
  assert.equal(ended, 1); assert.equal(c.timers.size, 0);
  c.events.dispatchEvent(new Event('focus')); await flush();
  assert.equal(ended, 1);
});
test('outages are retried and focus/visibility events check the live session', async () => {
  const c = setup(); let ended = 0;
  c.api.watchBioSession(session, () => ended++); await flush();
  c.network.status = 503;
  for (const check of c.timers.values()) await check();
  assert.equal(ended, 0);
  c.document.hidden = true; c.network.status = 404;
  const calls = c.calls.length;
  for (const check of c.timers.values()) await check();
  assert.equal(c.calls.length, calls);
  c.document.hidden = false; c.document.dispatchEvent(new Event('visibilitychange')); await flush();
  assert.equal(ended, 1);
});
test('stopping a watcher ignores its outstanding response', async () => {
  const c = setup(); let ended = 0, release;
  c.network.wait = new Promise(resolve => { release = resolve; }); c.network.status = 404;
  const stop = c.api.watchBioSession(session, () => ended++);
  stop(); release(); await flush();
  assert.equal(ended, 0); assert.equal(c.timers.size, 0);
});
test('disconnecting the website revokes the relay without clearing a newer session', async () => {
  const c = setup(); c.api.saveBioSession(session);
  await c.api.disconnectBioSession();
  assert.equal(c.api.loadBioSession(), null);
  assert.equal(c.calls.at(-1).url, 'https://koinvault.app/api/dapp/disconnect');
  c.api.saveBioSession({ ...session, sessionId: 'new-session' });
  await c.api.disconnectBioSession(session);
  assert.equal(c.api.loadBioSession().sessionId, 'new-session');
});

test('an older wallet service cannot silently downgrade pairing to URL query credentials', async () => {
  await assert.rejects(setup({ protocolVersion: 1 }).api.createBioPair(), /needs an update/);
  await assert.rejects(setup({ uri: validUri.replace('/#', '/?') }).api.createBioPair(), /unexpected connection link/);
});
