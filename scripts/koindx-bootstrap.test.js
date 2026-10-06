// Offline policy/transaction tests. The tiny WASM below is only a hash fixture,
// not a KoinDX build. Deterministic public keys and a simulated provider ensure
// these tests cannot contact a node or use the funded rehearsal accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Serializer, Signer, utils } from 'koilib';
import { digest } from './rehearsal-build.js';
import { assertOperation, assertTransactionOperations, executeTransaction, reconcileResourceRejection,
  HARBINGER, MAINNET, TRANSACTION_RC_LIMIT, RpcRejection, roles } from './rehearsal-core.js';

const UNIT = 100000000n;
const pairCodec = new Serializer({ nested: { Pair: { fields: { tokenA: { type: 'string', id: 1 }, tokenB: { type: 'string', id: 2 } } } } });
async function fixture() {
  const keys = {}, addresses = {};
  for (const role of [...roles, 'pool']) {
    const signer = Signer.fromSeed('PUBLIC KOINDEX BOOTSTRAP TEST ' + role);
    keys[role] = signer.getPrivateKey('wif'); addresses[role] = signer.getAddress();
  }
  const code = Buffer.from('0061736d01000000', 'hex');
  const state = { kind: 'native-koin-extension', chainId: HARBINGER,
    nativeToken: Signer.fromSeed('PUBLIC KOINDEX BOOTSTRAP NATIVE').getAddress(), addresses,
    koindx: { poolSha256: digest(code) }, journal: {}, checks: {}, snapshots: {} };
  const operations = [{ upload_contract: { contract_id: addresses.pool, bytecode: utils.encodeBase64url(code),
    authorizes_call_contract: true, authorizes_transaction_application: true, authorizes_upload_contract: true } },
  { call_contract: { contract_id: addresses.router, entry_point: 0x286b1165,
    args: utils.encodeBase64url(await pairCodec.serialize({ tokenA: 'koin', tokenB: addresses.base }, 'Pair')) } }];
  return { keys, state, operations };
}
function fakeNode() {
  let height = 10;
  const blocks = new Map([[10, { block_id: 'block10', block_height: '10', block: { transactions: [] }, receipt: { transaction_receipts: [] } }]]);
  return {
    submits: 0, getChainId: async () => HARBINGER, getAccountRc: async () => '100000000000', getNextNonce: async () => 'KAE=',
    getTransactionsById: async () => ({}),
    getHeadInfo: async () => ({ head_block_time: String(Date.now()), head_topology: { id: 'block' + height, height: String(height) }, last_irreversible_block: String(height) }),
    getBlocks: async (start, count = 1) => [...blocks.values()].filter(b => Number(b.block_height) >= start && Number(b.block_height) < start + count),
    include(transaction) {
      height++;
      blocks.set(height, { block_id: 'block' + height, block_height: String(height), block: { transactions: [transaction] },
        receipt: { transaction_receipts: [{ id: transaction.id, reverted: false }] } });
    },
    sendTransaction: async function(transaction) { this.submits++; this.include(transaction); return {}; },
  };
}
async function execution() {
  return { ...await fixture(), provider: fakeNode(), label: 'bootstrap', actors: ['pool'], persist() {}, timeout: 0 };
}

test('only the pinned atomic pool upload and native-KOIN/fixture create-pair qualifies for the exception', async () => {
  const { state, operations } = await fixture();
  assert.throws(() => assertOperation(operations[0], state), /Authorization overrides/);
  await assertTransactionOperations(operations, state);
});

test('pool exception rejects an ordinary rehearsal or absent pool identity', async () => {
  for (const change of [state => { delete state.kind; }, state => { state.kind = 'fixture-rehearsal'; }, state => { delete state.addresses.pool; }]) {
    const { state, operations } = await fixture(); change(state);
    await assert.rejects(assertTransactionOperations(operations, state));
  }
});

test('pool exception rejects native, production, or aliased owned-account upload targets', async () => {
  for (const role of ['payer', 'owner', 'buyer', 'orderbook', 'launchpad', 'base', 'router', 'native', 'production']) {
    const { state, operations } = await fixture();
    const target = role === 'native' ? state.nativeToken : role === 'production' ? '1Bke72aGbpq4brDY3m1UQxRCGBB9GPTJQz' : state.addresses[role];
    state.addresses.pool = target; operations[0].upload_contract.contract_id = target;
    await assert.rejects(assertTransactionOperations(operations, state), /Invalid pinned/);
  }
  const { state, operations } = await fixture();
  operations[0].upload_contract.contract_id = Signer.fromSeed('PUBLIC BOOTSTRAP EXTERNAL TARGET').getAddress();
  await assert.rejects(assertTransactionOperations(operations, state), /outside this rehearsal/);
});

test('pool exception rejects changed bytes, absent hash, malformed hash, and a different pinned hash', async () => {
  for (const change of [
    (state, ops) => { ops[0].upload_contract.bytecode = 'AGFzbQEAAAAB'; },
    state => { delete state.koindx; },
    state => { state.koindx.poolSha256 = 'invalid'; },
    state => { state.koindx.poolSha256 = '0'.repeat(64); },
  ]) {
    const { state, operations } = await fixture(); change(state, operations);
    await assert.rejects(assertTransactionOperations(operations, state), /Invalid pinned/);
  }
});

test('all three pool authorization flags must be literal true and other uploads retain the default denial', async () => {
  for (const flag of ['authorizes_call_contract', 'authorizes_transaction_application', 'authorizes_upload_contract']) {
    for (const value of [false, undefined, 1, 'true']) {
      const { state, operations } = await fixture(); operations[0].upload_contract[flag] = value;
      await assert.rejects(assertTransactionOperations(operations, state), /Invalid pinned/);
    }
  }
  const { state, operations } = await fixture();
  operations[0].upload_contract.contract_id = state.addresses.base;
  await assert.rejects(assertTransactionOperations(operations, state), /Authorization overrides/);
});

test('bootstrap rejects reversed, missing, extra, mixed, and system operations', async () => {
  for (const change of [
    ops => ops.reverse(), ops => ops.pop(), ops => ops.push(ops[1]),
    ops => { ops[0].set_system_contract = {}; }, ops => { ops[1].upload_contract = {}; },
    ops => { ops[1] = { set_system_call: {} }; },
  ]) {
    const { state, operations } = await fixture(); change(operations);
    await assert.rejects(assertTransactionOperations(operations, state), /Invalid pinned/);
  }
});

test('bootstrap call must target the isolated router and exact create_pair entry point', async () => {
  for (const change of [
    (call, state) => { call.contract_id = state.addresses.base; },
    call => { call.contract_id = '17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s'; },
    call => { call.entry_point = 0x286b1166; },
    call => { call.entry_point = '0x286b1165'; },
  ]) {
    const { state, operations } = await fixture(); change(operations[1].call_contract, state);
    await assert.rejects(assertTransactionOperations(operations, state), /Invalid pinned/);
  }
});

test('bootstrap pair rejects native address aliases, swapped tokens, wrong sale token, and malformed arguments', async () => {
  for (const pair of [(s) => ({ tokenA: s.nativeToken, tokenB: s.addresses.base }),
    (s) => ({ tokenA: s.addresses.base, tokenB: 'koin' }), (s) => ({ tokenA: 'koin', tokenB: s.addresses.buyer }),
    () => ({ tokenA: 'koin' }), () => ({})]) {
    const { state, operations } = await fixture();
    operations[1].call_contract.args = utils.encodeBase64url(await pairCodec.serialize(pair(state), 'Pair'));
    await assert.rejects(assertTransactionOperations(operations, state), /pair differs/);
  }
  const { state, operations } = await fixture(); operations[1].call_contract.args = '_w';
  await assert.rejects(assertTransactionOperations(operations, state));
});

test('valid bootstrap signs only payer and pool, journals before submission, and never repeats on resume', async () => {
  const e = await execution();
  e.persist = () => { if (e.state.journal.bootstrap?.status === 'pending') assert.equal(e.provider.submits, 0); };
  const result = await executeTransaction(e);
  assert.deepEqual(new Set(await Signer.recoverAddresses(result.transaction)), new Set([e.state.addresses.payer, e.state.addresses.pool]));
  await executeTransaction(e); assert.equal(e.provider.submits, 1);
});

test('bootstrap refuses the wrong pool key before journaling or submitting', async () => {
  const e = await execution(); e.keys.pool = e.keys.owner;
  await assert.rejects(executeTransaction(e), /key does not match/);
  assert.equal(e.provider.submits, 0); assert.deepEqual(e.state.journal, {});
});

test('bootstrap requires its pool signing role before any network read or submission', async () => {
  for (const actors of [[], ['owner'], ['payer', 'router']]) {
    const e = await execution(); let reads = 0;
    e.provider.getChainId = async () => { reads++; return HARBINGER; };
    await assert.rejects(executeTransaction({ ...e, actors }), /pool/i);
    assert.equal(reads, 0); assert.equal(e.provider.submits, 0); assert.deepEqual(e.state.journal, {});
  }
});

test('bootstrap refuses mainnet and an unrecognized network before signing or submitting', async () => {
  for (const chainId of [MAINNET, 'EiB' + 'A'.repeat(42) + '=']) {
    const e = await execution(); e.provider.getChainId = async () => chainId;
    await assert.rejects(executeTransaction(e), /MAINNET|match|Invalid chain/);
    assert.equal(e.provider.submits, 0); assert.deepEqual(e.state.journal, {});
  }
});

test('resource caps must be positive bigint values no greater than twenty tKOIN', async () => {
  for (const rcLimitCap of [0n, -1n, TRANSACTION_RC_LIMIT + 1n, 500000000, '500000000', null]) {
    const e = await execution(); let reads = 0;
    e.provider.getChainId = async () => { reads++; return HARBINGER; };
    await assert.rejects(executeTransaction({ ...e, rcLimitCap }), /Invalid rehearsal resource cap/);
    assert.equal(reads, 0); assert.equal(e.provider.submits, 0); assert.deepEqual(e.state.journal, {});
  }
});

test('new transactions honor the smaller of the requested resource cap and available Mana', async () => {
  for (const [rcLimitCap, available, expected] of [[5n * UNIT, 100n * UNIT, 5n * UNIT],
    [20n * UNIT, 100n * UNIT, 20n * UNIT], [5n * UNIT, 3n * UNIT, 3n * UNIT]]) {
    const e = await execution(); e.provider.getAccountRc = async () => String(available);
    const result = await executeTransaction({ ...e, rcLimitCap });
    assert.equal(result.transaction.header.rc_limit, String(expected));
  }
});

test('changing the cap alone cannot rewrite or rebroadcast an unresolved signed bootstrap', async () => {
  const e = await execution();
  e.provider.sendTransaction = async function() { this.submits++; throw new Error('network timeout'); };
  await assert.rejects(executeTransaction(e), /unresolved/);
  const saved = structuredClone(e.state.journal.bootstrap.transaction);
  await assert.rejects(executeTransaction({ ...e, rcLimitCap: 5n * UNIT }), /still pending/);
  assert.deepEqual(e.state.journal.bootstrap.transaction, saved);
  assert.equal(e.provider.submits, 1);
});

test('a reconciled resource-104 bootstrap may lower the cap at the same nonce while preserving the rejected attempt', async () => {
  const e = await execution(), send = e.provider.sendTransaction;
  e.provider.sendTransaction = async () => { throw new RpcRejection(JSON.stringify({ message: 'insufficient pending account resources', data: { code: 104 } })); };
  await assert.rejects(executeTransaction(e), /unresolved/);
  const rejected = structuredClone(e.state.journal.bootstrap);
  await reconcileResourceRejection(e);
  assert.equal(e.state.journal.bootstrap.status, 'retry-ready');
  e.provider.sendTransaction = send;
  const replacement = await executeTransaction({ ...e, rcLimitCap: 5n * UNIT });
  assert.equal(replacement.transaction.header.rc_limit, String(5n * UNIT));
  assert.equal(replacement.transaction.header.nonce, rejected.transaction.header.nonce);
  assert.equal(replacement.replaces, rejected.id); assert.notEqual(replacement.id, rejected.id);
  assert.deepEqual(replacement.transaction.operations, rejected.transaction.operations);
  assert.equal(e.state.journal[`bootstrap:rejected:${rejected.id}`].status, 'rejected');
  assert.deepEqual(e.state.journal[`bootstrap:rejected:${rejected.id}`].transaction, rejected.transaction);
  assert.equal(e.provider.submits, 1);
});
