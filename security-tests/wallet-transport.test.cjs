'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkWalletTransport } = require('../scripts/check-wallet-transport.cjs');
const wallet = 'https://koinvault.app', origin = 'https://app.tradekoinos.com';

function fixture(overrides = {}) {
  const calls = [], preflights = [];
  const fetchImpl = async (url, options) => {
    const route = new URL(url).pathname.split('/').pop();
    assert.equal(new URL(url).search, '');
    assert.equal(new URL(url).hash, '');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Origin, origin);
    if (options.method === 'OPTIONS') {
      assert.equal(options.headers['Access-Control-Request-Method'], 'POST');
      assert.equal(options.headers['Access-Control-Request-Headers'], 'content-type');
      assert.equal(options.body, undefined);
      preflights.push(route);
      return overrides.preflight ? overrides.preflight(route) : preflight();
    }
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    calls.push({ route, body });
    if (route !== 'create') assert.deepEqual(body, { sessionId: 'session', secret: 'fixture-secret' });
    if (overrides[route]) return overrides[route](body);
    return reply(route === 'create'
      ? { ok: true, protocolVersion: 2, sessionId: 'session', secret: 'fixture-secret',
        uri: wallet + '/#connect=session&secret=fixture-secret' }
      : { ok: true, connected: false });
  };
  return { calls, preflights, fetchImpl };
}
function preflight(headers = {}, status = 204) {
  return new Response(null, { status, headers: {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', ...headers,
  } });
}
function reply(data, cors = origin, status = 200) {
  return new Response(JSON.stringify(data), { status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': cors } });
}

test('compatible wallet passes and revokes the unapproved probe session', async () => {
  const f = fixture(); await checkWalletTransport(f);
  assert.deepEqual(f.calls.map(c => c.route), ['create', 'status', 'disconnect']);
  assert.equal(f.calls[0].body.protocolVersion, 2);
  assert.deepEqual(f.preflights, ['create', 'status', 'request', 'request-status', 'disconnect']);
});

for (const [name, headers, status] of [
  ['missing preflight route', {}, 404],
  ['wrong preflight origin', { 'Access-Control-Allow-Origin': 'https://foreign.example' }],
  ['missing POST method', { 'Access-Control-Allow-Methods': 'GET, OPTIONS' }],
  ['missing JSON header', { 'Access-Control-Allow-Headers': 'Accept' }],
]) test(name + ' stops deployment before creating a session', async () => {
  const f = fixture({ preflight: () => preflight(headers, status) });
  await assert.rejects(checkWalletTransport(f), /browser CORS preflight/);
  assert.equal(f.calls.length, 0);
});

test('a preflight network failure is redacted and never creates a session', async () => {
  const f = fixture({ preflight: () => { throw new Error('sensitive upstream data'); } });
  await assert.rejects(checkWalletTransport(f), error => {
    assert.match(error.message, /preflight failed/);
    assert.doesNotMatch(error.message, /sensitive upstream data/); return true;
  });
  assert.equal(f.calls.length, 0);
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
