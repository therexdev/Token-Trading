const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')
    .replaceAll('import.meta.env', 'TEST_ENV');
  return ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
}
const signerCode = compile('config/signer.ts');
const authCode = compile('lib/authApi.ts');
const modalCode = compile('components/ConnectModal.tsx');

function setup({ env = {}, response, fetchError } = {}) {
  const signer = { exports: {}, TEST_ENV: env };
  vm.runInNewContext(signerCode, signer);
  const calls = [], scripts = [], timers = new Map();
  let timerId = 0;
  const context = {
    exports: {}, AbortSignal,
    require: name => {
      assert.equal(name, '../config/signer');
      return signer.exports;
    },
    window: {},
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    document: {
      head: { appendChild: script => scripts.push(script) },
      createElement: () => ({ remove() { this.removed = true; } }),
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (fetchError) throw new Error('network unavailable');
      return response || { ok: true, headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({ signer: true, google: true, googleClientId: 'test-client',
          launchpad: 'launchpad', tokenLaunch: true }) };
    },
  };
  vm.runInNewContext(authCode, context);
  return { api: context.exports, signer: signer.exports, context, calls, scripts, timers };
}

test('a build with no signer environment connects to the existing Google gateway', async () => {
  const { api, calls, signer } = setup();
  assert.equal(signer.SIGNER_ENABLED, true);
  const config = await api.fetchAuthConfig();
  assert.equal(calls[0].url, 'https://usekoinos.com/api/signer-config');
  assert.equal(config.googleClientId, 'test-client');
  assert.equal(config.launchpad, 'launchpad');
  assert.equal(config.tokenLaunch, true);
});

test('explicitly disabling or overriding the gateway is preserved', async () => {
  const disabled = setup({ env: { VITE_SIGNER_API: '' } });
  assert.equal(disabled.signer.SIGNER_ENABLED, false);
  assert.equal((await disabled.api.fetchAuthConfig()).google, false);
  assert.equal(disabled.calls.length, 0);
  const custom = setup({ env: { VITE_SIGNER_API: ' https://gateway.example/ ' } });
  await custom.api.fetchAuthConfig();
  assert.equal(custom.calls[0].url, 'https://gateway.example/api/signer-config');
});

test('failed, HTML, and incomplete discovery responses settle as unavailable', async () => {
  for (const options of [
    { fetchError: true },
    { response: { ok: false } },
    { response: { ok: true, headers: new Headers({ 'Content-Type': 'text/html' }) } },
    { response: { ok: true, headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ signer: true, google: true }) } },
  ]) {
    const config = await setup(options).api.fetchAuthConfig();
    assert.equal(config.google, false);
    assert.equal(config.googleClientId, null);
  }
});

for (const failure of ['error', 'timeout', 'missing API']) {
  test(`Google script ${failure} cleans up and allows a fresh retry`, async () => {
    const { api, context, scripts, timers } = setup();
    const first = api.loadGoogleIdentity();
    assert.equal(api.loadGoogleIdentity(), first);
    const rejected = assert.rejects(first, /Google sign-in/);
    if (failure === 'error') scripts[0].onerror();
    else if (failure === 'timeout') [...timers.values()][0]();
    else scripts[0].onload();
    await rejected;
    assert.equal(scripts[0].removed, true);
    assert.equal(scripts[0].onload, null);
    assert.equal(timers.size, 0);
    const retry = api.loadGoogleIdentity();
    assert.equal(scripts.length, 2);
    context.window.google = { accounts: { id: {} } };
    scripts[1].onload();
    await retry;
    assert.equal(timers.size, 0);
  });
}

test('closing a modal during script loading cannot render a stale button', async () => {
  const { api, context, scripts } = setup();
  const controller = new AbortController();
  let renders = 0;
  const result = api.renderGoogleButton({ isConnected: true }, 'client', 320,
    () => assert.fail('stale token'), () => assert.fail('stale error'), controller.signal);
  controller.abort();
  context.window.google = { accounts: { id: {
    initialize: () => renders++, renderButton: () => renders++,
  } } };
  scripts[0].onload();
  await result;
  assert.equal(renders, 0);
});

test('the rendered button passes credentials to sign-in and ignores a canceled modal', async () => {
  const { api, context } = setup();
  let config, options, rendered;
  const tokens = [], errors = [];
  const slot = { isConnected: true, innerHTML: 'old' };
  const controller = new AbortController();
  context.window.google = { accounts: { id: {
    initialize: value => { config = value; },
    renderButton: (target, value) => { rendered = target; options = value; },
  } } };
  await api.renderGoogleButton(slot, 'client', 345, token => tokens.push(token),
    error => errors.push(error), controller.signal);
  assert.equal(rendered, slot);
  assert.equal(slot.innerHTML, '');
  assert.equal(options.text, 'continue_with');
  assert.equal(config.ux_mode, 'popup');
  config.callback({ credential: 'test-id-token' });
  config.callback({});
  controller.abort();
  config.callback({ credential: 'stale-id-token' });
  assert.deepEqual(tokens, ['test-id-token']);
  assert.deepEqual(errors, ['Google did not return a sign-in token']);
});

function renderModal(authConfig, enabled = true) {
  const context = { exports: {}, require: name => {
    if (name === '../store/useStore') return { useStore: selector => selector({ authConfig }) };
    if (name === '../lib/koinos') return { isKondorAvailable: () => false };
    if (name === '../config/signer') return { SIGNER_ENABLED: enabled };
    if (name === '../lib/authApi' || name === '../lib/bioWallet') return {};
    return require(name);
  } };
  vm.runInNewContext(modalCode, context);
  return require('react-dom/server').renderToStaticMarkup(
    require('react').createElement(context.exports.ConnectModal, { onClose() {} }));
}

test('unavailable Google configuration renders a retry instead of permanent loading', () => {
  for (const config of [{ google: false, googleClientId: null }, { google: true, googleClientId: null }]) {
    const html = renderModal(config);
    assert.doesNotMatch(html, /Loading Google sign-in/);
    assert.match(html, /Retry Google sign-in/);
    assert.match(html, /temporarily unavailable/);
    assert.match(html, /Connect KOIN Vault/);
    assert.match(html, /Install Kondor/);
  }
  assert.match(renderModal(null), /Loading Google sign-in/);
  assert.doesNotMatch(renderModal(null, false), /Loading Google sign-in|Retry Google sign-in/);
});
