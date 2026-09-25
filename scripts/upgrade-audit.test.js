import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Serializer } from 'koilib';
import { readOnlyProvider, collectSpace, obligations, decodeState, prepareOperation, inspectRelease, release, hash } from './upgrade-audit.js';
const fixture = JSON.parse(fs.readFileSync(new URL('../docs/release-evidence/mainnet-2026-09-25-node.json', import.meta.url)));
const clone = value => JSON.parse(JSON.stringify(value));

test('RPC wrapper rejects transaction submission and non-read system calls before any network request', async () => {
  let requests = 0;
  const p = readOnlyProvider('https://example.com', async () => { requests++; throw new Error('should not fetch'); });
  for (const [method, params] of [['chain.submit_transaction', {}], ['chain.submit_block', {}],
    ['chain.invoke_system_call', { name: 'put_object' }], ['chain.invoke_system_call', { id: 301 }]]) {
    await assert.rejects(p.call(method, params), /refused/);
  }
  assert.equal(requests, 0);
  assert.throws(() => readOnlyProvider('http://example.com'), /HTTPS/);
  assert.throws(() => readOnlyProvider('https://user:password@example.com'), /HTTPS/);
});

test('wrong network is rejected before reading contract state', async () => {
  await assert.rejects(inspectRelease({ getChainId: async () => 'AAAA' }), /chain id/);
});

test('concurrent inventory reads do not burst RPC requests and an HTTP failure does not stall the queue', async () => {
  let active = 0, peak = 0, count = 0;
  const p = readOnlyProvider('https://example.com', async () => {
    active++; peak = Math.max(peak, active); const index = count++;
    await new Promise(resolve => setImmediate(resolve)); active--;
    return { ok: index !== 0, status: 503, json: async () => ({ result: { index } }) };
  });
  const results = await Promise.allSettled([0, 1, 2].map(() => p.call('chain.get_head_info')));
  assert.equal(peak, 1); assert.equal(count, 3);
  assert.equal(results[0].status, 'rejected'); assert.match(results[0].reason.message, /503/);
  assert.deepEqual(results.slice(1).map(r => r.value.index), [1, 2]);
});

test('storage enumeration includes an empty key and rejects stalled or truncated pagination', async () => {
  let index = 0;
  const p = { invokeGetObjectGeneric: async () => ({ exists: true, value: 'AA==' }),
    invokeGetNextObject: async () => index++ === 0 ? { exists: true, key: 'AQ==', value: 'Ag==' } : { exists: false } };
  const space = await collectSpace(p, 'account', 0);
  assert.equal(space.records.length, 2); assert.equal(space.records[0].key, '');
  assert.equal(space.sha256, hash(JSON.stringify(space.records)));
  p.invokeGetNextObject = async () => ({ exists: true, key: '', value: 'AA==' });
  await assert.rejects(collectSpace(p, 'account', 0), /did not advance/);
  p.invokeGetNextObject = async () => ({ exists: true, key: 'AQ==', value: 'AA==' });
  await assert.rejects(collectSpace(p, 'account', 0, 1), /incomplete/);
});

test('numeric zero and false protobuf defaults survive koilib address conversion', async () => {
  const serializer = new Serializer({ nested: { Row: { fields: {
    side: { type: 'uint32', id: 1 }, claimed: { type: 'bool', id: 2 }, amount: { type: 'uint64', id: 3 },
  } } } });
  assert.deepEqual(await decodeState(serializer, '', 'Row'), { side: 0, claimed: false, amount: '0' });
});

test('order obligations are exact integers even above Number.MAX_SAFE_INTEGER', () => {
  const state = { markets: [{ marketId: 1, baseToken: 'base', quoteToken: 'quote' }], orders: [
    { marketId: 1, side: 0, remaining: '1', escrow: '15000000000000000000' },
    { marketId: 1, side: 1, remaining: '17', escrow: '17' },
  ] };
  assert.deepEqual(obligations('orderbook', state), [{ token: 'base', units: '17' }, { token: 'quote', units: '15000000000000000000' }]);
  state.orders[0].side = 7; assert.throws(() => obligations('orderbook', state), /invalid resting order/);
});

test('launch liabilities distinguish active deposits, payouts, refunds, completed locks, and LP tokens', () => {
  const base = { mode: 0, status: 0, liquidityState: 0, token: 'sale', raised: '100', refunded: '20',
    forSaleAmount: '200', sold: '100', distributed: '25', lockedAmount: '50', liquidityTokens: '10',
    liquidityKoin: '10', pair: 'pair', lpAmount: '9', lockedClaimed: false, lpClaimed: false };
  const owes = patch => Object.fromEntries(obligations('launchpad', { launches: [{ ...base, ...patch }] }).map(o => [o.token, o.units]));
  assert.deepEqual(owes({}), { [release.koin]: '100', sale: '260' });
  assert.deepEqual(owes({ status: 1, liquidityState: 1 }), { [release.koin]: '10', sale: '135' });
  assert.deepEqual(owes({ status: 1, mode: 1, liquidityState: 1 }), { [release.koin]: '10', sale: '235' });
  assert.deepEqual(owes({ status: 3, lockedClaimed: true }), { [release.koin]: '80' });
  assert.deepEqual(owes({ status: 2, liquidityState: 2 }), { sale: '50', pair: '9' });
  assert.deepEqual(owes({ status: 2, liquidityState: 2, lockedClaimed: true, lpClaimed: true }), {});
  assert.deepEqual(owes({ status: 4, lockedClaimed: true }), {});
  assert.throws(() => owes({ status: 3, refunded: '101' }), /negative/);
});

test('captured live obligations reconcile with every recorded required-token balance', () => {
  for (const c of fixture.contracts) {
    for (const owed of obligations(c.name, c.state)) {
      const balance = c.balances.find(b => b.token === owed.token);
      assert.ok(balance); assert.equal(balance.owed, owed.units);
      assert.ok(BigInt(balance.held) >= BigInt(owed.units));
    }
    assert.equal(c.spaces.find(s => s.id === release.contracts[c.name].lockSpace).records.length, 0);
  }
});

test('preparation produces only pinned-address uploads with preserved authorization flags', () => {
  for (const [name, spec] of Object.entries(release.contracts)) {
    const binary = fs.readFileSync(new URL('../' + spec.wasm, import.meta.url));
    const operation = prepareOperation(name, fixture, binary, Date.parse(fixture.capturedAt));
    assert.deepEqual(Object.keys(operation), ['upload_contract']);
    const upload = operation.upload_contract;
    assert.equal(upload.contract_id, spec.address);
    assert.equal(hash(Buffer.from(upload.bytecode, 'base64url')), spec.sha256);
    assert.equal(upload.authorizes_call_contract, false);
    assert.equal(upload.authorizes_transaction_application, false);
    assert.equal(upload.authorizes_upload_contract, false);
    const abi = JSON.parse(upload.abi); assert.ok(abi.methods); assert.ok(abi.koilib_types); assert.ok(abi.types);
    assert.equal(operation.signatures, undefined); assert.equal(operation.header, undefined);
  }
});

test('preparation refuses stale state, incomplete checks, changed targets, metadata, funds, and artifacts', () => {
  const name = 'orderbook', spec = release.contracts[name];
  const binary = fs.readFileSync(new URL('../' + spec.wasm, import.meta.url)), time = Date.parse(fixture.capturedAt);
  for (const alter of [
    r => { r.chainId = 'AAAA'; }, r => { r.capturedAt = 'bad'; },
    r => { r.contracts[0].address = 'wrong'; }, r => { r.contracts[0].bytecodeSha256 = spec.sha256; },
    r => { r.contracts[0].blockers.push('failure'); }, r => { r.contracts[0].rawStorageVerified = false; },
    r => { r.contracts[0].metadata.authorizesUpload = true; }, r => { r.contracts[0].balances[0].covered = false; },
    r => { r.contracts[0].spaces.find(s => s.id === spec.lockSpace).records.push({ key: '', value: 'AA==' }); },
  ]) { const report = clone(fixture); alter(report); assert.throws(() => prepareOperation(name, report, binary, time)); }
  assert.throws(() => prepareOperation(name, fixture, binary, time + 300001), /stale/);
  assert.throws(() => prepareOperation(name, fixture, Buffer.from('wrong'), time), /artifact/);
});
