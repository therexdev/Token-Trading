import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pins, verifyBuild, verifyMetadata, verifyBytecode, verifyPair, attestRouter } from './router-attestation.js';
import { hash, release } from './upgrade-audit.js';

const build = JSON.parse(fs.readFileSync(new URL('../docs/release-evidence/koindx-source-build-2026-10-06.json', import.meta.url)));
const clone = value => structuredClone(value);
const metadata = (sha256, overrides) => ({ hash: Buffer.from('1220' + sha256, 'hex').toString('base64url'),
  system: false, authorizesCall: overrides, authorizesTransaction: overrides, authorizesUpload: overrides });
const pairFixture = () => ({
  launch: { id: pins.launchId, token: pins.token, pair: pins.pair, liquidityState: 2, lpClaimed: false,
    creator: pins.creator, lpAmount: pins.lpAmount, lpUnlockTime: pins.lpUnlockTime },
  pair: { value: pins.pair }, reversePair: { value: pins.pair },
  tokens: { tokenA: release.koin, tokenB: pins.token }, balance: { value: '99990000' },
});

test('source evidence must keep exact official commits, artifacts, original pool pin and no substitutions', () => {
  verifyBuild(build);
  for (const alter of [b => b.sources.core.commit = 'changed', b => b.sources.periphery.commit = 'changed',
    b => b.artifacts.router.sha256 = 'changed', b => b.artifacts.pool.bytes++,
    b => b.poolHashPin.upstream = 'changed', b => b.poolHashPin.matchesUpstream = false,
    b => b.substitutions.push('changed')]) {
    const changed = clone(build); alter(changed);
    assert.throws(() => verifyBuild(changed), /does not match/);
  }
});

test('metadata requires the exact multihash and distinct router/pool authority flags', () => {
  verifyMetadata(metadata(pins.routerSha256, false), pins.routerSha256, false);
  verifyMetadata(metadata(pins.poolSha256, true), pins.poolSha256, true);
  assert.throws(() => verifyMetadata(metadata(pins.routerSha256, true), pins.routerSha256, false), /authorization/);
  assert.throws(() => verifyMetadata(metadata(pins.poolSha256, false), pins.poolSha256, true), /authorization/);
  assert.throws(() => verifyMetadata(metadata(pins.routerSha256, false), pins.poolSha256, false), /hash/);
  const missing = metadata(pins.routerSha256, false); delete missing.authorizesUpload;
  assert.throws(() => verifyMetadata(missing, pins.routerSha256, false), /authorization/);
  const system = { ...metadata(pins.routerSha256, false), system: true };
  assert.throws(() => verifyMetadata(system, pins.routerSha256, false), /authorization/);
});

test('bytecode validation requires size, digest and WASM magic, not metadata alone', () => {
  const wasm = Buffer.from('0061736d01000000', 'hex');
  assert.deepEqual(verifyBytecode(wasm.toString('base64url'), hash(wasm), wasm.length), { bytes: 8, sha256: hash(wasm) });
  assert.throws(() => verifyBytecode(wasm.toString('base64url'), hash(wasm), 9), /bytecode/);
  assert.throws(() => verifyBytecode(wasm.toString('base64url'), pins.routerSha256, 8), /bytecode/);
  const other = Buffer.from('not wasm');
  assert.throws(() => verifyBytecode(other.toString('base64url'), hash(other), other.length), /bytecode/);
});

test('both router argument orders must identify the preserved pool', () => {
  verifyPair(pairFixture());
  for (const field of ['pair', 'reversePair']) {
    const changed = pairFixture(); changed[field].value = pins.router;
    assert.throws(() => verifyPair(changed), /mapping/);
  }
});

test('pool token identities and ordering cannot be guessed or reversed', () => {
  const changed = pairFixture();
  changed.tokens = { tokenA: pins.token, tokenB: release.koin };
  assert.throws(() => verifyPair(changed), /ordering/);
});

test('changed launch lifecycle is rejected for fresh review', () => {
  for (const change of [{ lpClaimed: true }, { liquidityState: 3 }, { id: 5 },
    { pair: pins.router }, { token: release.koin }, { lpAmount: '0' }, { creator: pins.router }, { lpUnlockTime: '1' }]) {
    const changed = pairFixture(); Object.assign(changed.launch, change);
    assert.throws(() => verifyPair(changed), /claim changed/);
  }
});

test('LP coverage uses exact uint64 arithmetic and rejects malformed balances', () => {
  const changed = pairFixture(); changed.balance.value = '99989999';
  assert.throws(() => verifyPair(changed), /underfunded/);
  changed.balance.value = '9007199254740993';
  verifyPair(changed);
  for (const value of ['-1', '1.2', '1e8', '18446744073709551616', undefined]) {
    changed.balance.value = value;
    assert.throws(() => verifyPair(changed), /Invalid token amount/);
  }
});

test('wrong network is rejected before any contract read', async () => {
  await assert.rejects(attestRouter({ getChainId: async () => 'AAAA' }, 'https://example.com'), /Wrong chain/);
});
