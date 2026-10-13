// Offline guard checks only. Deterministic public test keys, simulated
// transport, and no access to the funded rehearsal directory or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Serializer, Signer, utils } from 'koilib';
import { assertNativeOperation, assertNativeOperations } from './testnet-native.js';
import { assertOperation, executeTransaction, HARBINGER, MAINNET, publicReport, roles } from './rehearsal-core.js';

const UNIT = 100000000n;
const tokenCodec = new Serializer(utils.tokenAbi.koilib_types);
function accountState() {
  const keys = {}, addresses = {};
  for (const role of roles) {
    const signer = Signer.fromSeed('PUBLIC NATIVE GUARD TEST ' + role);
    keys[role] = signer.getPrivateKey('wif'); addresses[role] = signer.getAddress();
  }
  const nativeToken = Signer.fromSeed('PUBLIC NATIVE GUARD TEST SYSTEM TOKEN').getAddress();
  // The quote role identifies the native contract; its old disposable key
  // deliberately does not control that system contract.
  addresses.quote = nativeToken;
  return { keys, state: { chainId: HARBINGER, nativeToken, addresses, journal: {}, checks: {}, snapshots: {} } };
}
async function tokenOperation(state, method, args) {
  const entry = utils.tokenAbi.methods[method];
  return { call_contract: { contract_id: state.nativeToken, entry_point: entry.entry_point,
    args: utils.encodeBase64url(await tokenCodec.serialize(args, entry.argument)) } };
}
async function guard(operation, state) {
  await assertNativeOperation(operation, state);
  assertOperation(operation, state);
}
function fakeNode() {
  let height = 10;
  const blocks = new Map([[10, { block_id: 'block10', block_height: '10', block: { transactions: [] }, receipt: { transaction_receipts: [] } }]]);
  return {
    submits: 0, getChainId: async () => HARBINGER, getAccountRc: async () => '100000000000', getNextNonce: async () => 'KAE=',
    getHeadInfo: async () => ({ head_block_time: String(Date.now()), head_topology: { id: 'block' + height, height: String(height) }, last_irreversible_block: String(height) }),
    getBlocks: async (start, count = 1) => [...blocks.values()].filter(b => Number(b.block_height) >= start && Number(b.block_height) < start + count),
    sendTransaction: async function(transaction) {
      this.submits++; height++;
      blocks.set(height, { block_id: 'block' + height, block_height: String(height), block: { transactions: [transaction] },
        receipt: { transaction_receipts: [{ id: transaction.id, reverted: false }] } });
      return {};
    },
  };
}

test('native guard accepts exactly the six-tKOIN funding cap between owned test accounts', async () => {
  const { state } = accountState();
  await guard(await tokenOperation(state, 'transfer', { from: state.addresses.payer, to: state.addresses.buyer, value: String(6n * UNIT) }), state);
});

test('native transfers reject zero, amounts above the cap, and full uint64 excess without precision loss', async () => {
  const { state } = accountState();
  for (const value of ['0', String(6n * UNIT + 1n), '9007199254740993', '18446744073709551615']) {
    await assert.rejects(guard(await tokenOperation(state, 'transfer', { from: state.addresses.payer, to: state.addresses.buyer, value }), state));
  }
});

test('aggregate native funding rejects duplicate full-cap transfers and sums split funding exactly', async () => {
  const { state } = accountState();
  const transfer = async value => tokenOperation(state, 'transfer', { from: state.addresses.payer, to: state.addresses.buyer, value: String(value) });
  const six = await transfer(6n * UNIT), three = await transfer(3n * UNIT), one = await transfer(1n);
  await assert.rejects(assertNativeOperations([six, six], state, 'fund'), /total 6 tKOIN budget/);
  await assertNativeOperations([three, three], state, 'fund');
  await assert.rejects(assertNativeOperations([three, three, one], state, 'fund'), /total 6 tKOIN budget/);
});

test('pending, failed, and confirmed journal entries reserve payer funding against new labels', async () => {
  for (const status of ['pending', 'failed', 'passed']) {
    const { state } = accountState();
    const operation = await tokenOperation(state, 'transfer', { from: state.addresses.payer, to: state.addresses.buyer, value: String(6n * UNIT) });
    state.journal.original = { status, transaction: { operations: [operation] } };
    await assert.rejects(assertNativeOperations([operation], state, 'another-label'), /total 6 tKOIN budget/);
    const extra = await tokenOperation(state, 'transfer', { from: state.addresses.payer, to: state.addresses.owner, value: '1' });
    await assert.rejects(assertNativeOperations([extra], state, 'another-label'), /total 6 tKOIN budget/);
    await assertNativeOperations([operation], state, 'original');
    const changed = await tokenOperation(state, 'transfer', { from: state.addresses.payer, to: state.addresses.owner, value: String(6n * UNIT) });
    await assert.rejects(assertNativeOperations([changed], state, 'original'), /total 6 tKOIN budget/);
  }
});

test('funding split across journal entries respects the same total budget and exact resume reservation', async () => {
  const { state } = accountState();
  const transfer = async value => tokenOperation(state, 'transfer', { from: state.addresses.payer, to: state.addresses.buyer, value: String(value) });
  const three = await transfer(3n * UNIT), one = await transfer(1n);
  state.journal.first = { status: 'passed', transaction: { operations: [three] } };
  await assertNativeOperations([three], state, 'second');
  state.journal.second = { status: 'pending', transaction: { operations: [three] } };
  await assertNativeOperations([three], state, 'second');
  await assert.rejects(assertNativeOperations([one], state, 'third'), /total 6 tKOIN budget/);
  await assert.rejects(assertNativeOperations([three, one], state, 'second'), /total 6 tKOIN budget/);
});

test('spent funding budget still permits bounded approvals and return transfers from disposable users', async () => {
  const { state } = accountState();
  const funding = await tokenOperation(state, 'transfer', { from: state.addresses.payer, to: state.addresses.buyer, value: String(6n * UNIT) });
  state.journal.funding = { status: 'passed', transaction: { operations: [funding] } };
  const returned = await tokenOperation(state, 'transfer', { from: state.addresses.buyer, to: state.addresses.payer, value: String(6n * UNIT) });
  const approval = await tokenOperation(state, 'approve', { owner: state.addresses.buyer, spender: state.addresses.orderbook, value: String(6n * UNIT) });
  await assertNativeOperations([returned, approval], state, 'cleanup');
});

test('native transfers reject external, mainnet, and native-contract sources or destinations', async () => {
  const { state } = accountState();
  const outside = Signer.fromSeed('PUBLIC NATIVE GUARD TEST EXTERNAL').getAddress();
  for (const address of [outside, '19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK', state.nativeToken]) {
    await assert.rejects(guard(await tokenOperation(state, 'transfer', { from: state.addresses.payer, to: address, value: '1' }), state), /budget\/accounts/);
    await assert.rejects(guard(await tokenOperation(state, 'transfer', { from: address, to: state.addresses.buyer, value: '1' }), state), /budget\/accounts/);
  }
});

test('native approvals are bounded to the two disposable contracts', async () => {
  const { state } = accountState();
  for (const spender of [state.addresses.orderbook, state.addresses.launchpad]) {
    await guard(await tokenOperation(state, 'approve', { owner: state.addresses.buyer, spender, value: String(6n * UNIT) }), state);
    await assert.rejects(guard(await tokenOperation(state, 'approve', { owner: state.addresses.buyer, spender, value: String(6n * UNIT + 1n) }), state), /budget\/contracts/);
  }
  for (const spender of [state.addresses.payer, state.addresses.base, state.addresses.router, state.nativeToken, '17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s']) {
    await assert.rejects(guard(await tokenOperation(state, 'approve', { owner: state.addresses.buyer, spender, value: '1' }), state), /budget\/contracts/);
  }
});

test('zero native approval can revoke an allowance without protobuf defaults causing a false rejection', async () => {
  const { state } = accountState();
  await guard(await tokenOperation(state, 'approve', { owner: state.addresses.buyer, spender: state.addresses.launchpad, value: '0' }), state);
});

test('native approvals reject owners outside the test accounts', async () => {
  const { state } = accountState();
  for (const owner of [state.nativeToken, Signer.fromSeed('PUBLIC NATIVE GUARD TEST OTHER OWNER').getAddress()]) {
    await assert.rejects(guard(await tokenOperation(state, 'approve', { owner, spender: state.addresses.launchpad, value: '1' }), state), /budget\/contracts/);
  }
});

test('native mint, burn, and unrecognized calls are forbidden even when the token appears as quote', async () => {
  const { state } = accountState();
  const operations = [
    await tokenOperation(state, 'mint', { to: state.addresses.buyer, value: '1' }),
    await tokenOperation(state, 'burn', { from: state.addresses.buyer, value: '1' }),
    { call_contract: { contract_id: state.nativeToken, entry_point: 0x10000001, args: '' } },
  ];
  for (const operation of operations) await assert.rejects(guard(operation, state), /method forbidden/);
});

test('native uploads, authorization overrides, mixed operations, and system mutations are rejected', async () => {
  const { state } = accountState();
  const upload = { upload_contract: { contract_id: state.nativeToken, bytecode: 'AGFzbQEAAAA=' } };
  await assert.rejects(guard(upload, state), /Cannot upload/);
  await assert.rejects(guard({ upload_contract: { contract_id: state.addresses.base, authorizes_upload_contract: true } }, state), /overrides/);
  await assert.rejects(guard({ call_contract: { contract_id: state.addresses.base }, set_system_call: {} }, state), /single/);
  await assert.rejects(guard({ set_system_contract: {} }, state), /System operations/);
});

test('fixture mint and contract upload remain scoped to disposable accounts', async () => {
  const { state } = accountState();
  await guard({ call_contract: { contract_id: state.addresses.base, entry_point: utils.tokenAbi.methods.mint.entry_point, args: '' } }, state);
  await guard({ upload_contract: { contract_id: state.addresses.orderbook, bytecode: 'AGFzbQEAAAA=', authorizes_call_contract: false,
    authorizes_transaction_application: false, authorizes_upload_contract: false } }, state);
  for (const contract_id of ['1Bke72aGbpq4brDY3m1UQxRCGBB9GPTJQz', '13akLV3xQZdRjdQ2ANYo7cvSsD8qfBZReV', Signer.fromSeed('PUBLIC NATIVE GUARD TEST OUTSIDE CONTRACT').getAddress()]) {
    await assert.rejects(guard({ call_contract: { contract_id, entry_point: 1, args: '' } }, state), /outside this rehearsal/);
  }
});

test('funding signs only with the payer, journals before submission, and resume does not fund twice', async () => {
  const { state, keys } = accountState(), provider = fakeNode();
  const operation = await tokenOperation(state, 'transfer', { from: state.addresses.payer, to: state.addresses.buyer, value: String(6n * UNIT) });
  await guard(operation, state);
  const e = { state, keys, provider, label: 'native-funding-test', operations: [operation], timeout: 0,
    persist() { if (state.journal['native-funding-test']?.status === 'pending') assert.equal(provider.submits, 0); } };
  const result = await executeTransaction(e);
  assert.deepEqual(await Signer.recoverAddresses(result.transaction), [state.addresses.payer]);
  await executeTransaction(e);
  assert.equal(provider.submits, 1);
  const report = JSON.stringify(publicReport(state));
  for (const key of Object.values(keys)) assert.ok(!report.includes(key));
  assert.equal(publicReport(state).transactions[0].transaction, undefined);
});

test('an obsolete quote key or mismatched actor key cannot sign native-token work', async () => {
  for (const actor of ['quote', 'buyer']) {
    const { state, keys } = accountState(), provider = fakeNode();
    if (actor === 'buyer') keys.buyer = keys.owner;
    const operation = await tokenOperation(state, 'transfer', { from: state.addresses.payer, to: state.addresses.buyer, value: '1' });
    await guard(operation, state);
    await assert.rejects(executeTransaction({ state, keys, provider, label: 'wrong-key', operations: [operation], actors: [actor], persist() {}, timeout: 0 }), /key does not match/);
    assert.equal(provider.submits, 0); assert.deepEqual(state.journal, {});
  }
});

test('otherwise-valid native work still rejects mainnet before signing or submission', async () => {
  const { state, keys } = accountState(), provider = fakeNode();
  provider.getChainId = async () => MAINNET;
  const operation = await tokenOperation(state, 'transfer', { from: state.addresses.payer, to: state.addresses.buyer, value: '1' });
  await guard(operation, state);
  await assert.rejects(executeTransaction({ state, keys, provider, label: 'wrong-chain', operations: [operation], persist() {}, timeout: 0 }), /MAINNET/);
  assert.equal(provider.submits, 0); assert.deepEqual(state.journal, {});
});
