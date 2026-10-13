// Pure offline prerequisite, arithmetic, and resource-planning checks. Importing
// the runner does not read its rehearsal state, keys, or build files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HARBINGER, MAINNET, TRANSACTION_RC_LIMIT } from './rehearsal-core.js';
import { requireNativeChecks, integerSqrt, koindxResourceCap } from './testnet-koindx.js';

const UNIT = 100000000n;
const nativeChecks = [
  'deploy native-name resolver and sale fixture', 'deploy historical native-token contracts',
  'fund isolated buyers and bounded allowances', 'create native escrow and launch positions before upgrade',
  'upgrade native positions with exact public state preservation', 'native order refund rejects wrong owner and pays once',
  'native payment rolls back when sale token fails then trading succeeds', 'native launch refund and creator payouts settle once',
  'real seven-day reclaim rejects early and reserves exact escrow'
];
function state() {
  return { chainId: HARBINGER, kind: 'native-koin-extension', nativeToken: 'test-native-contract', addresses: { quote: 'test-native-contract' },
    checks: Object.fromEntries([...nativeChecks.map(name => [name, { status: 'passed' }]), ['seven-day native reclaim', { status: 'waiting' }]]) };
}

test('KoinDX continuation requires a completed native preflight and pending separate seven-day claim', () => {
  assert.doesNotThrow(() => requireNativeChecks(state()));
  const claimed = state(); claimed.checks['seven-day native reclaim'].status = 'passed';
  assert.throws(() => requireNativeChecks(claimed), /Preserve the unclaimed/);
});

test('offline KoinDX reporting remains available after the separate native reclaim completes', () => {
  const claimed = state(); claimed.checks['seven-day native reclaim'].status = 'passed';
  const before = structuredClone(claimed);
  assert.doesNotThrow(() => requireNativeChecks(claimed, { reportOnly: true }));
  assert.deepEqual(claimed, before, 'Report validation must not change the saved checkpoint');
  assert.throws(() => requireNativeChecks(claimed), /Preserve the unclaimed/);
  claimed.chainId = MAINNET;
  assert.throws(() => requireNativeChecks(claimed, { reportOnly: true }), /MAINNET/);
  claimed.chainId = HARBINGER;
  claimed.checks[nativeChecks[0]].status = 'incomplete';
  assert.throws(() => requireNativeChecks(claimed, { reportOnly: true }), /Native prerequisite incomplete/);
});

test('every native prerequisite must be passed, never pending, missing, or failed', () => {
  for (const name of nativeChecks) {
    for (const status of [undefined, 'pending', 'waiting', 'incomplete', 'failed']) {
      const s = state();
      if (status === undefined) delete s.checks[name];
      else s.checks[name].status = status;
      assert.throws(() => requireNativeChecks(s), /Native prerequisite incomplete/);
    }
  }
});

test('KoinDX preflight rejects mainnet, unknown chains, fixture-only states, and changed native-token identity', () => {
  for (const change of [
    s => { s.chainId = MAINNET; }, s => { s.chainId = 'bad-chain'; },
    s => { s.kind = 'fixture-rehearsal'; }, s => { delete s.nativeToken; },
    s => { s.addresses.quote = 'a-different-native-contract'; }
  ]) {
    const s = state(); change(s); assert.throws(() => requireNativeChecks(s));
  }
});

test('official router/pool uploads receive a ten-tKOIN cap and ordinary liquidity calls keep five', () => {
  const upload = { upload_contract: { contract_id: 'test-pool', bytecode: Buffer.alloc(65000).toString('base64url') } };
  const call = { call_contract: { contract_id: 'test-router', entry_point: 0x286b1165, args: '' } };
  assert.equal(koindxResourceCap([upload]), 10n * UNIT);
  assert.equal(koindxResourceCap([upload, call]), 10n * UNIT);
  assert.equal(koindxResourceCap([call]), 5n * UNIT);
  assert.ok(koindxResourceCap([upload, call]) <= TRANSACTION_RC_LIMIT);
});

test('initial LP calculation uses the exact integer square root and permanent minimum liquidity', () => {
  const reserveProduct = (UNIT / 2n) * UNIT;
  assert.equal(integerSqrt(reserveProduct), 70710678n);
  assert.equal(integerSqrt(reserveProduct) - 10000n, 70700678n);
});

test('integer square root stays exact around perfect squares and beyond JavaScript number precision', () => {
  for (const root of [1n, 2n, 3n, 10000n, 70710678n, 9007199254740993n, (1n << 64n) - 1n]) {
    assert.equal(integerSqrt(root * root), root);
    assert.equal(integerSqrt(root * root - 1n), root - 1n);
    assert.equal(integerSqrt(root * root + 2n * root), root);
  }
  assert.equal(integerSqrt(0n), 0n);
  for (const value of [-1n, 1, '1', null]) assert.throws(() => integerSqrt(value));
});
