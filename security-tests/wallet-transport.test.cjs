'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkWalletTransport } = require('../scripts/check-wallet-transport.cjs');
const wallet = 'https://koinvault.app', origin = 'https://app.tradekoinos.com';

function fixture(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const route = new URL(url).pathname.split('/').pop();
    assert.equal(new URL(url).search, '');
    assert.equal(new URL(url).hash, '');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Origin, origin);
    const body = JSON.parse(options.body);
    calls.push({ route, body });
    if (route !== 'create') assert.deepEqual(body, { sessionId: 'session', secret: 'fixture-secret' });
    if (overrides[route]) return overrides[route](body);
    return reply(route === 'create'
      ? { ok: true, protocolVersion: 2, sessionId: 'session', secret: 'fixture-secret',
        uri: wallet + '/#connect=session&secret=fixture-secret' }
      : { ok: true, connected: false });
  };
  return { calls, fetchImpl };
}
function reply(data, cors = origin, status = 200) {
  return new Response(JSON.stringify(data), { status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': cors } });
}

test('compatible wallet passes and revokes the unapproved probe session', async () => {
  const f = fixture(); await checkWalletTransport(f);
  assert.deepEqual(f.calls.map(c => c.route), ['create', 'status', 'disconnect']);
  assert.equal(f.calls[0].body.protocolVersion, 2);
});

for (const [name, changes] of [
  ['legacy protocol', { protocolVersion: 1 }],
  ['query credentials', { uri: wallet + '/?connect=session&secret=fixture-secret' }],
  ['foreign wallet', { uri: 'https://foreign.example/#connect=session&secret=fixture-secret' }],
  ['mismatched credentials', { uri: wallet + '/#connect=other&secret=fixture-secret' }],
]) test(name + ' blocks release and still revokes the session', async () => {
  const f = fixture({ create: () => reply({ ok: true, protocolVersion: 2,
    sessionId: 'session', secret: 'fixture-secret', uri: wallet + '/#connect=session&secret=fixture-secret', ...changes }) });
  await assert.rejects(checkWalletTransport(f));
  assert.deepEqual(f.calls.map(c => c.route), ['create', 'disconnect']);
});

for (const [name, status] of [
  ['missing POST endpoint', () => reply({ error: 'no such endpoint' }, origin, 404)],
  ['wrong CORS origin', () => reply({ ok: true, connected: false }, 'https://foreign.example')],
  ['network failure', () => { throw new Error('sensitive upstream data'); }],
]) test(name + ' blocks release without exposing server data', async () => {
  const f = fixture({ status });
  await assert.rejects(checkWalletTransport(f), error => {
    assert.doesNotMatch(error.message, /fixture-secret|sensitive upstream data/); return true;
  });
  assert.equal(f.calls.at(-1).route, 'disconnect');
});

test('failed disconnect also blocks release', async () => {
  const f = fixture({ disconnect: () => reply({ ok: false }, origin, 503) });
  await assert.rejects(checkWalletTransport(f), /disconnect/);
});

test('invalid deployment origins fail before any request', async () => {
  const f = fixture();
  await assert.rejects(checkWalletTransport({ ...f, walletOrigin: 'http://koinvault.app' }));
  assert.equal(f.calls.length, 0);
});
