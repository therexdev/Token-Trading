import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Signer } from 'koilib';
import { MAINNET, HARBINGER, roles, assertChain, assertOperation, createState, providerFor, checkNetwork,
  executeTransaction, publicReport, RpcRejection } from './rehearsal-core.js';
import { buildRehearsal, work } from './rehearsal-build.js';
import { scenarios } from './rehearsal-scenarios.js';
import { SimulatedNode } from './rehearsal-simulation.js';

function accountState() {
  const keys = {}, addresses = {};
  for (const role of roles) { const signer = Signer.fromSeed('PUBLIC UNIT TEST ' + role); keys[role] = signer.getPrivateKey('wif'); addresses[role] = signer.getAddress(); }
  return { keys, state: { chainId: HARBINGER, addresses, journal: {}, checks: {}, snapshots: {} } };
}
function node() {
  const blocks = new Map(); let height = 10;
  blocks.set(10, { block_id: 'block10', block_height: '10', block: { transactions: [] }, receipt: { transaction_receipts: [] } });
  return {
    submits: 0, getChainId: async () => HARBINGER, getAccountRc: async () => '100000000000', getNextNonce: async () => 'KAE=',
    getHeadInfo: async () => ({ head_block_time: String(Date.now()), head_topology: { id: 'block' + height, height: String(height) }, last_irreversible_block: String(height) }),
    getBlocks: async (start, count = 1) => [...blocks.values()].filter(b => Number(b.block_height) >= start && Number(b.block_height) < start + count),
    sendTransaction: async function(tx) { this.submits++; this.include(tx); return { transaction: tx, receipt: { id: tx.id } }; },
    include(tx, reverted = false, logs = []) { height++; blocks.set(height, { block_id: 'block' + height, block_height: String(height),
      block: { transactions: [tx] }, receipt: { transaction_receipts: [{ id: tx.id, reverted, logs }] } }); },
  };
}
function execution(provider = node()) {
  const { keys, state } = accountState(); let writes = 0;
  return { provider, state, keys, persist: () => { writes++; }, label: 'test', actors: ['owner'], timeout: 0,
    operations: [{ call_contract: { contract_id: state.addresses.orderbook, entry_point: 1, args: '' } }], writes: () => writes };
}
test('mainnet and a mismatching network are rejected before reading head or signing', async () => {
  assert.throws(() => assertChain(MAINNET, MAINNET), /MAINNET/);
  assert.throws(() => assertChain(HARBINGER, MAINNET), /match/);
  assert.throws(() => assertChain('bad', HARBINGER), /Invalid/);
  const e = execution(); e.provider.getChainId = async () => MAINNET;
  await assert.rejects(executeTransaction(e), /MAINNET/); assert.equal(e.provider.submits, 0); assert.deepEqual(e.state.journal, {});
});
test('stale nodes and endpoints without block receipts cannot pass preflight', async () => {
  const p = node(); p.getHeadInfo = async () => ({ head_block_time: '1' });
  await assert.rejects(checkNetwork(p), /stale/);
  p.getHeadInfo = node().getHeadInfo; p.getBlocks = async () => [{ block: {} }];
  await assert.rejects(checkNetwork(p), /receipts/);
});
test('only generated account calls and uploads without authorization overrides are allowed', () => {
  const { state } = accountState();
  for (const operation of [
    { set_system_call: {} }, { call_contract: { contract_id: '1Bke72aGbpq4brDY3m1UQxRCGBB9GPTJQz' } },
    { call_contract: { contract_id: Signer.fromSeed('unrelated').getAddress() } },
    { upload_contract: { contract_id: state.addresses.orderbook, authorizes_upload_contract: true } },
    { call_contract: { contract_id: state.addresses.orderbook }, upload_contract: {} },
  ]) assert.throws(() => assertOperation(operation, state));
});
test('RPC wrapper refuses unencrypted remote endpoints and non-rehearsal system calls', async () => {
  assert.throws(() => providerFor('http://example.com'), /HTTPS/);
  let sent = 0; const p = providerFor('https://example.com', async () => { sent++; return { ok: false, status: 503 }; });
  await assert.rejects(p.call('chain.submit_block', {}), /Unsupported/);
  await assert.rejects(p.call('chain.invoke_system_call', { name: 'put_object' }), /Unsupported/);
  assert.equal(sent, 0); await assert.rejects(p.getChainId(), /503/);
});
test('generated keys are private, separate, never overwritten, and absent from public reports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trade-rehearsal-'));
  try {
    const state = createState(dir), keys = JSON.parse(fs.readFileSync(path.join(dir, 'keys.json')));
    assert.equal(new Set(Object.values(state.addresses)).size, roles.length);
    for (const role of roles) assert.equal(Signer.fromWif(keys[role]).getAddress(), state.addresses[role]);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'keys.json')).mode & 0o777, 0o600);
    assert.throws(() => createState(dir), /already exists/);
    const report = JSON.stringify(publicReport(state));
    for (const key of Object.values(keys)) assert.ok(!report.includes(key));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('RPC requests use distinct IDs and reject unrelated responses', async () => {
  const ids = [];
  const p = providerFor('https://example.com', async (_url, request) => {
    const body = JSON.parse(request.body); ids.push(body.id);
    assert.equal(request.headers['Cache-Control'], 'no-store');
    return { ok: true, json: async () => ({ id: body.id, result: { chain_id: HARBINGER } }) };
  });
  assert.equal(await p.getChainId(), HARBINGER); assert.equal(await p.getChainId(), HARBINGER);
  assert.notEqual(ids[0], ids[1]);
  const mismatch = providerFor('https://example.com', async () => ({ ok: true,
    json: async () => ({ id: 'unrelated', result: { chain_id: HARBINGER } }) }));
  await assert.rejects(mismatch.getChainId(), /response ID mismatch/);
});
test('success requires a matching included receipt; rerunning does not resubmit', async () => {
  const e = execution(), result = await executeTransaction(e);
  assert.equal(result.status, 'passed'); assert.equal(result.outcome, 'included'); assert.ok(e.writes() >= 2);
  const addresses = await Signer.recoverAddresses(result.transaction);
  assert.deepEqual(new Set(addresses), new Set([e.state.addresses.payer, e.state.addresses.owner]));
  await executeTransaction(e); assert.equal(e.provider.submits, 1);
  e.operations[0].call_contract.entry_point = 2;
  await assert.rejects(executeTransaction(e), /differs/); assert.equal(e.provider.submits, 1);
});
test('broadcast timeout preserves the original transaction; resume only checks its inclusion', async () => {
  const e = execution(); e.provider.sendTransaction = async function() { this.submits++; throw new Error('network timeout'); };
  await assert.rejects(executeTransaction(e), /unresolved/);
  const saved = e.state.journal.test.transaction;
  await assert.rejects(executeTransaction(e), /still pending/); assert.equal(e.provider.submits, 1);
  e.provider.include(saved); await executeTransaction(e); assert.equal(e.provider.submits, 1);
});
test('a reverted receipt cannot be reported as success', async () => {
  const e = execution(); e.provider.sendTransaction = async function(tx) { this.submits++; this.include(tx, true, ['failure']); return {}; };
  await assert.rejects(executeTransaction(e), /unexpected receipt/); assert.equal(e.state.journal.test.status, 'failed');
});
test('expected failures must be explicit node rejections or matching reverted receipts, never HTTP errors', async () => {
  const e = execution(); e.expectedError = 'reentrant mutation';
  e.provider.sendTransaction = async () => { throw new Error('HTTP 503'); };
  await assert.rejects(executeTransaction(e), /unresolved/); assert.equal(e.state.journal.test.status, 'pending');
  const f = execution(); f.expectedError = 'reentrant mutation';
  f.provider.sendTransaction = async () => { throw new RpcRejection('orderbook: reentrant mutation'); };
  const result = await executeTransaction(f); assert.equal(result.outcome, 'node-rejected');
});
test('network changes immediately before submission are stopped', async () => {
  const e = execution(); let reads = 0;
  e.provider.getChainId = async () => ++reads === 1 ? HARBINGER : MAINNET;
  await assert.rejects(executeTransaction(e), /MAINNET/); assert.equal(e.provider.submits, 0);
});
test('public report excludes signed transactions and keeps inclusion separate from finality', async () => {
  const e = execution(); await executeTransaction(e);
  const r = publicReport(e.state); assert.equal(r.mainnetReady, false); assert.equal(r.transactions[0].transaction, undefined);
  assert.equal(r.finality, undefined); assert.equal(r.transactions[0].outcome, 'included');
});
test('both orderbook test binaries reproduce the pinned mainnet binaries; launchpad changes only address constants', () => {
  const { state } = accountState();
  const manifest = buildRehearsal(state, path.join(work, 'ci-build'));
  assert.equal(manifest.testOnly, true); assert.equal(Object.keys(manifest.artifacts).length, 5);
  for (const [name, hashes] of Object.entries(manifest.sources)) {
    if (name.endsWith('Launchpad.ts')) assert.notEqual(hashes.original, hashes.test);
    else assert.equal(hashes.original, hashes.test);
  }
});
test('complete rehearsal scenarios and interrupted-step recovery execute compiled WASM with simulated node transport', async () => {
  const { state, keys } = accountState(); const provider = new SimulatedNode(state);
  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'ci-build/manifest.json')));
  const realNow = Date.now; Date.now = () => provider.now;
  try {
    const send = provider.sendTransaction.bind(provider); let interrupted = false;
    provider.sendTransaction = async transaction => {
      const result = await send(transaction);
      if (!interrupted && state.journal['valid-refund']?.id === transaction.id) {
        interrupted = true; throw new Error('simulated connection lost after inclusion');
      }
      return result;
    };
    await assert.rejects(scenarios(provider, state, keys, () => {}, manifest, path.join(work, 'ci-build')), /unresolved/);
    assert.equal(interrupted, true);
    await scenarios(provider, state, keys, () => {}, manifest, path.join(work, 'ci-build'));
    assert.equal(Object.values(state.checks).filter(c => c.status === 'passed').length, 15);
    const sent = provider.submits;
    await scenarios(provider, state, keys, () => {}, manifest, path.join(work, 'ci-build'));
    assert.equal(provider.submits, sent, 'completed run does not resend any transaction');
  } finally { Date.now = realNow; }
});
