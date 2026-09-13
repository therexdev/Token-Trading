const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/bioWallet.ts'), 'utf8').replaceAll('import.meta.env', 'TEST_ENV');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const session = { sessionId: 'session', secret: 'secret', address: 'account' };
const validUri = 'https://koinvault.app/?connect=session&secret=secret';
function setup({ uri = validUri, outcome = 'approved' } = {}) {
  const storage = new Map(), calls = [];
  const context = {
    exports: {}, TEST_ENV: {}, URL, URLSearchParams, AbortSignal,
    location: { origin: 'https://app.tradekoinos.com' },
    sessionStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    setTimeout: fn => fn(),
    fetch: async (url, init = {}) => {
      calls.push({ url, body: init.body && JSON.parse(init.body) });
      const data = url.endsWith('/create') ? { ok: true, ...session, uri, expiresAt: Date.now() + 60000 }
        : url.includes('/request-status?') ? { ok: true, status: outcome, txid: outcome === 'approved' ? 'confirmed-tx' : null, error: outcome === 'failed' ? 'chain refused' : null }
        : url.includes('/status?') ? { ok: true, connected: true, address: session.address }
        : { ok: true, requestId: 'request' };
      return { ok: true, json: async () => data };
    },
  };
  vm.runInNewContext(code, context);
  return { api: context.exports, storage, calls };
}
test('pair QR and all connection API calls use the new wallet domain', async () => {
  const { api, calls } = setup();
  const pair = await api.createBioPair();
  assert.equal(pair.uri, validUri);
  assert.equal(calls[0].url, 'https://koinvault.app/api/dapp/create');
  assert.equal(calls[0].body.walletUrl, 'https://koinvault.app');
  const live = await api.readBioPair(pair);
  assert.equal(live.address, session.address);
  assert.ok(calls[1].url.startsWith('https://koinvault.app/api/dapp/status?'));
});
test('foreign origins and mismatched QR credentials are rejected', async () => {
  for (const uri of [
    validUri.replace('koinvault.app', 'wallet.usekoinos.com'),
    validUri.replace('koinvault.app', 'koinvault.app.evil.example'),
    validUri.replace('connect=session', 'connect=wrong'),
    validUri.replace('secret=secret', 'secret=wrong'),
    validUri.replace('/?', '/other?'),
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
  assert.equal(calls.filter(c => c.url.endsWith('/request')).length, 1);
});
for (const outcome of ['rejected', 'failed']) test(outcome + ' approval never resubmits a transaction', async () => {
  const { api, calls } = setup({ outcome });
  await assert.rejects(new api.BioWalletSigner(session).sendTransaction({ operations: [] }), outcome === 'rejected' ? /rejected/ : /chain refused/);
  assert.equal(calls.filter(c => c.url.endsWith('/request')).length, 1);
});
