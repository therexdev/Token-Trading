const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/store/useStore.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const session = { sessionId: 'old', secret: 'fixture', address: 'account' };
function setup(restored = null) {
  const storage = new Map(), watches = [], revoked = [];
  let saved = restored;
  if (restored) { storage.set('koinoskit-trade:account', restored.address); storage.set('koinoskit-trade:auth-method', 'bio'); }
  const context = {
    exports: {}, setTimeout() {},
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    require(name) {
      if (name === 'zustand') return require('zustand');
      if (name === '../lib/bioWallet') return {
        loadBioSession: () => saved, saveBioSession: value => { saved = value; },
        disconnectBioSession: (value = saved) => { if (value) revoked.push(value); if (saved?.sessionId === value?.sessionId) saved = null; },
        watchBioSession: (value, ended) => { const watch = { session: value, ended, stopped: false }; watches.push(watch); return () => { watch.stopped = true; }; },
      };
      if (name === '../lib/koinos') return { fetchBalances: async () => ({}), fetchUserOrders: async () => [] };
      if (name === '../config/tokens') return { TOKENS: [] };
      if (name === '../lib/sessionKey') return { clearSessionKey() {}, sessionAddress: () => null, adoptSession() {} };
      if (name === '../lib/authApi') return { loginWithGoogle: async () => ({ token: 'fixture', address: 'google-account', label: 'Google' }) };
      return {};
    },
  };
  vm.runInNewContext(code, context);
  return { store: context.exports.useStore, storage, watches, revoked, saved: () => saved };
}
test('remote revocation resets the actual Trade Koinos store and cached account', () => {
  const c = setup(); c.store.getState().connectBio(session);
  c.store.setState({ balances: { KOIN: 12n }, myOrders: [{ id: 1 }] });
  assert.equal(c.watches.length, 1, 'State updates do not create extra pollers');
  c.watches[0].ended();
  const state = c.store.getState();
  assert.equal(state.account, null); assert.equal(state.authMethod, null); assert.equal(state.authLabel, null);
  assert.equal(Object.keys(state.balances).length, 0); assert.equal(state.myOrders.length, 0);
  assert.equal(c.storage.has('koinoskit-trade:account'), false); assert.equal(c.saved(), null);
  assert.equal(c.watches[0].stopped, true);
});
test('restored sessions are watched and an old watcher cannot log out a new session at the same address', () => {
  const c = setup(session); assert.equal(c.watches.length, 1);
  c.store.getState().connectBio({ ...session, sessionId: 'new' });
  assert.equal(c.watches.length, 2); assert.equal(c.watches[0].stopped, true);
  c.watches[0].ended();
  assert.equal(c.store.getState().account, 'account'); assert.equal(c.saved().sessionId, 'new');
  c.watches[1].ended(); assert.equal(c.store.getState().account, null);
});
test('switching to Google or Kondor retires the watcher and ignores late revocation', async () => {
  for (const method of ['google', 'kondor']) {
    const c = setup(session);
    if (method === 'google') await c.store.getState().signInWithGoogle('fixture');
    else c.store.getState().chooseAccount('kondor-account');
    c.watches[0].ended();
    assert.equal(c.store.getState().authMethod, method);
    assert.equal(c.store.getState().account, method + '-account');
    assert.equal(c.watches[0].stopped, true);
    assert.equal(c.revoked.length, 1);
  }
});
