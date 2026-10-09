import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Contract, Serializer, Signer, utils } from 'koilib';
import { liquidityAccounting, assertCandidateOperations, CASES, dependencyReads, verifiedReceipt, mayAttemptEarlyClaim, reconciledResourceArchive, assertNoOtherUnresolved, reconcilePending } from './testnet-liquidity-candidate.js';
import { HARBINGER, MAINNET, RpcRejection } from './rehearsal-core.js';
import { toKoilibAbi } from './abi-utils.js';

const launchAbi = toKoilibAbi(JSON.parse(fs.readFileSync(new URL('../frontend/src/lib/launchpad-abi.json', import.meta.url))));
function state() { return {
  chainId: HARBINGER, originalLaunchpad: '1E1FVxb7m8TaeNzZnKFB1HdtZwFUs2FFkR', nativeToken: '1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju',
  addresses: { payer: '14V1baBquUvN2jdRXaJdnAPXjDiFFjpWJL', owner: '1GrcJjkCXhTrFHjy8PqdDjgyNZFtweReXz', buyer: '1Ncphc51iWvXDeqHMXLRi7iV1M4JQXeMcS',
    base: '18ppTwTCM7F6uEzHZdPxVZ6TEviPFY4Gfv', launchpad: Signer.fromSeed('test-only-candidate-guard').getAddress(), router: '1BZwunANbBd57rYrDMPybNAscyDV7fw8rY' },
  schedules: { 1: { start: '1791520000000', end: '1791520090000' }, 2: { start: '1791520200000', end: '1791520290000' } }, journal: {},
}; }
async function operation(s, method, args, token) {
  const c = new Contract({ id: token || s.addresses.launchpad, abi: token ? utils.tokenAbi : launchAbi });
  return (await c.functions[method](args, { onlyOperation: true })).operation;
}
async function settlement(s, id = 1, override = {}) {
  const spec = CASES[id - 1];
  return [await operation(s, 'create_launch', { creator: s.addresses.owner, token: s.addresses.base, price: '100000000', forSaleAmount: '10000000',
    startTime: s.schedules[id].start, endTime: s.schedules[id].end, lpUnlockTime: s.schedules[id].end, liquidityBps: 5000, liquidityTokens: spec.liquidityTokens, ...override }),
  await operation(s, 'contribute', { launchId: id, buyer: s.addresses.buyer, amount: '10000000' }),
  await operation(s, 'finalize', { launchId: id }), await operation(s, 'process', { launchId: id, limit: 1 })];
}
const reserves = { reserveA: '50000000', reserveB: '100000000', kLast: '5000000000000000' };

test('real existing-pool remainder arithmetic covers each asset and exact LP denominator', () => {
  assert.deepEqual(liquidityAccounting(reserves, '70710678', '5000000', '10100000'),
    { usedNative: 5000000n, usedBase: 10000000n, refundNative: 0n, refundBase: 100000n, lp: 7071067n });
  assert.deepEqual(liquidityAccounting(reserves, '70710678', '5000000', '9900000'),
    { usedNative: 4950000n, usedBase: 9900000n, refundNative: 50000n, refundBase: 0n, lp: 7000357n });
});

test('accounting rejects absent pool, fee growth, wrong ratio and out-of-slippage deposit', () => {
  for (const changed of [{ ...reserves, reserveA: '0' }, { ...reserves, reserveB: '99999999' }, { ...reserves, kLast: '1' }]) {
    assert.throws(() => liquidityAccounting(changed, '70710678', '5000000', '10100000'));
  }
  assert.throws(() => liquidityAccounting(reserves, '70710678', '5000000', '9000000'));
});

test('accounting preserves integer precision above JavaScript safe integer range', () => {
  const supply = '9007199254740993';
  assert.equal(liquidityAccounting(reserves, supply, '5000000', '10100000').lp, 900719925474099n);
});

test('only the two bounded case settlements are allowed', async () => {
  const s = state();
  await assertCandidateOperations(await settlement(s), s, 'case-1-settlement');
  await assertCandidateOperations(await settlement(s, 2), s, 'case-2-settlement');
  for (const override of [{ price: '200000000' }, { forSaleAmount: '20000000' }, { liquidityBps: 10000 }, { liquidityTokens: '10200000' }, { lockedAmount: '1' }, { endTime: '1791520090001' }]) {
    await assert.rejects(assertCandidateOperations(await settlement(s, 1, override), s, 'case-1-settlement'));
  }
});

test('aggregate spend includes pending journal reservations and permits only the exact same-label resume', async () => {
  const s = state(), first = await settlement(s), second = await settlement(s, 2);
  s.journal['case-1-settlement'] = { status: 'pending', transaction: { operations: first } };
  await assertCandidateOperations(first, s, 'case-1-settlement');
  await assertCandidateOperations(second, s, 'case-2-settlement');
  s.journal.extra = { status: 'pending', transaction: { operations: first } };
  await assert.rejects(assertCandidateOperations(second, s, 'case-2-settlement'), /0.2 tKOIN/);
});

test('only explicitly reconciled resource archives release their contribution reservation', async () => {
  const s = state(), first = await settlement(s), second = await settlement(s, 2);
  const rejected = { id: 'rejected-id', status: 'rejected', outcome: 'node-rejected-resource-budget', expectedError: null, startHeight: 100,
    transaction: { header: { nonce: 'AAE=' }, operations: first },
    submissionError: JSON.stringify({ message: 'insufficient pending account resources', data: JSON.stringify({ code: 104 }) }),
    reconciliation: { included: false, transactionStoreFound: false, lastIrreversibleBlock: '100', nextNonce: 'AAE=' } };
  s.journal.archive = rejected;
  s.journal['case-1-settlement'] = { replaces: rejected.id, status: 'pending', transaction: { header: { nonce: 'AAE=' }, operations: first } };
  assert.equal(reconciledResourceArchive(rejected, s.journal), true);
  await assertCandidateOperations(second, s, 'case-2-settlement');
  for (const modify of [r => delete r.reconciliation, r => r.reconciliation.transactionStoreFound = true,
    r => r.reconciliation.lastIrreversibleBlock = '99', r => r.submissionError = '{}', r => r.status = 'pending']) {
    const bad = structuredClone(rejected); modify(bad); s.journal.archive = bad;
    assert.equal(reconciledResourceArchive(bad, s.journal), false);
    await assert.rejects(assertCandidateOperations(second, s, 'case-2-settlement'), /0.2 tKOIN/);
  }
});

test('native mutation guard forbids payer funding, arbitrary token calls and approvals outside exact budgets', async () => {
  const s = state();
  for (const [token, owner, value] of [[s.nativeToken, s.addresses.buyer, '20000000'], [s.addresses.base, s.addresses.owner, '100000000']]) {
    const approve = await operation(s, 'approve', { owner, spender: s.addresses.launchpad, value }, token);
    await assertCandidateOperations([approve], s, 'bounded-allowances');
    const tooMuch = await operation(s, 'approve', { owner, spender: s.addresses.launchpad, value: String(BigInt(value) + 1n) }, token);
    await assert.rejects(assertCandidateOperations([tooMuch], s, 'bounded-allowances'));
  }
  const transfer = await operation(s, 'transfer', { from: s.addresses.payer, to: s.addresses.buyer, value: '1' }, s.nativeToken);
  await assert.rejects(assertCandidateOperations([transfer], s, 'bounded-allowances'), /No transfers/);
  const wrongSpender = await operation(s, 'approve', { owner: s.addresses.buyer, spender: s.originalLaunchpad, value: '20000000' }, s.nativeToken);
  await assert.rejects(assertCandidateOperations([wrongSpender], s, 'bounded-allowances'));
});

test('original launchpad, router and pool calls are forbidden even when addresses are known', async () => {
  const s = state(), op = await operation(s, 'provide_liquidity', { launchId: 1 });
  for (const address of [s.originalLaunchpad, s.addresses.router, s.addresses.base]) {
    const altered = structuredClone(op); altered.call_contract.contract_id = address;
    await assert.rejects(assertCandidateOperations([altered], s, 'case-1-liquidity'));
  }
});

test('mainnet and reuse of the original launchpad are rejected before operation handling', async () => {
  const s = state(); s.chainId = MAINNET;
  await assert.rejects(assertCandidateOperations([], s, 'anything'), /MAINNET IS FORBIDDEN/);
  s.chainId = HARBINGER; s.addresses.launchpad = s.originalLaunchpad;
  await assert.rejects(assertCandidateOperations([], s, 'anything'), /Never target/);
});

test('claim and provision operations must belong to their exact case and journal label', async () => {
  const s = state();
  await assertCandidateOperations([await operation(s, 'provide_liquidity', { launchId: 1 })], s, 'case-1-liquidity');
  await assertCandidateOperations([await operation(s, 'claim_liquidity', { launchId: 1 })], s, 'case-1-claim');
  await assert.rejects(assertCandidateOperations([await operation(s, 'claim_liquidity', { launchId: 2 })], s, 'case-1-claim'));
  await assert.rejects(assertCandidateOperations([await operation(s, 'reclaim_liquidity', { launchId: 1 })], s, 'case-1-claim'), /forbidden/);
});

test('Foundation-compatible dependency reads use only the existing fixture read entries', async () => {
  const s = state(), calls = [];
  const codec = new Serializer({ nested: { Address: { fields: { value: { type: 'bytes', id: 1 } } }, Metadata: { fields: { hash: { type: 'bytes', id: 1 }, system: { type: 'bool', id: 2 } } } } });
  const p = { readContract: async query => {
    calls.push(query); assert.equal(query.contract_id, s.addresses.base);
    if (query.entry_point === 0x10000004) return { result: utils.encodeBase64url(await codec.serialize({ value: utils.encodeBase64url(utils.decodeBase58(s.nativeToken)) }, 'Address')) };
    assert.equal(query.entry_point, 0x10000003);
    const args = await new Serializer(utils.tokenAbi.koilib_types).deserialize(query.args, utils.tokenAbi.methods.balanceOf.argument);
    assert.equal(args.owner, s.addresses.router);
    return { result: utils.encodeBase64url(await codec.serialize({ hash: 'EiAB', system: true }, 'Metadata')) };
  } };
  const reader = dependencyReads(p, s.addresses.base);
  assert.equal(await reader.nativeAddress(), s.nativeToken);
  assert.equal((await reader.metadata(s.addresses.router)).system, true);
  assert.equal(calls.length, 2);
});

test('missing candidate metadata requires the explicit fixture rejection; infrastructure errors fail closed', async () => {
  const s = state();
  for (const error of [new RpcRejection('fixture: contract metadata missing'), new Error('fixture: contract metadata missing'),
    new RpcRejection('HTTP 502'), new RpcRejection('Unable to translate unknown method')]) {
    const reader = dependencyReads({ readContract: async () => { throw error; } }, s.addresses.base);
    if (error instanceof RpcRejection && error.message === 'fixture: contract metadata missing') assert.equal(await reader.metadata(s.addresses.launchpad), null);
    else await assert.rejects(reader.metadata(s.addresses.launchpad));
  }
});

test('finality requires one matching transaction and receipt, consistent block IDs/heights and strict reverted flags', () => {
  const entry = { id: 'transaction-id', evidence: { blockId: 'block-id', height: 123 } };
  const block = { block_id: 'block-id', block_height: '123', block: { id: 'block-id', header: { height: '123' }, transactions: [{ id: entry.id }] },
    receipt: { id: 'block-id', transaction_receipts: [{ id: entry.id }] } };
  verifiedReceipt(block, entry);
  const explicit = structuredClone(block); explicit.receipt.transaction_receipts[0].reverted = false; verifiedReceipt(explicit, entry);
  for (const value of [true, null, 'false', 0, 1]) {
    const bad = structuredClone(block); bad.receipt.transaction_receipts[0].reverted = value;
    assert.throws(() => verifiedReceipt(bad, entry), /malformed/);
  }
  for (const mutate of [b => b.block.id = 'wrong', b => b.receipt.id = 'wrong', b => b.block_height = '124',
    b => b.block.header.height = '124', b => b.block.transactions.push({ id: entry.id }),
    b => b.receipt.transaction_receipts.push({ id: entry.id }), b => b.block.transactions = [], b => b.receipt.transaction_receipts = []]) {
    const bad = structuredClone(block); mutate(bad); assert.throws(() => verifiedReceipt(bad, entry));
  }
});

test('early rejection needs at least a fresh 60-second margin; shrinking snapshots never become false passes', () => {
  const due = 1791520090000;
  assert.equal(mayAttemptEarlyClaim(due - 60000, due), true);
  assert.equal(mayAttemptEarlyClaim(due - 90000, due), true);
  for (const now of [due - 59999, due - 1, due, due + 1, NaN]) assert.equal(mayAttemptEarlyClaim(now, due), false);
  // The second check after a slow snapshot invalidates a formerly safe read.
  assert.equal(mayAttemptEarlyClaim(due - 70000, due), true);
  assert.equal(mayAttemptEarlyClaim(due - 40000, due), false);
});

test('an unresolved early-claim ID blocks a newly eligible claim after unlock and only reconciles the saved ID', async () => {
  const s = state(); s.journal['case-1-early-claim'] = { id: 'saved-early-id', status: 'pending', expectedError: 'liquidity is still locked' };
  assert.throws(() => assertNoOtherUnresolved(s, 'case-1-claim'), /unresolved payer nonce/);
  let reads = 0, persisted = 0;
  await assert.rejects(reconcilePending(s, () => persisted++, async entry => { reads++; assert.equal(entry.id, 'saved-early-id'); return null; }), /only receipt checks/);
  assert.equal(reads, 1); assert.equal(persisted, 0); assert.equal(s.journal['case-1-early-claim'].status, 'pending');
  await reconcilePending(s, () => persisted++, async entry => ({ blockId: 'block', height: 1,
    receipt: { id: entry.id, reverted: true, logs: ['launchpad: liquidity is still locked'] } }));
  assert.equal(s.journal['case-1-early-claim'].status, 'passed'); assert.equal(persisted, 1);
  assertNoOtherUnresolved(s, 'case-1-claim');
});

test('unexpected success or malformed pending receipts cannot unlock a new payer transaction', async () => {
  for (const receipt of [{ id: 'saved', reverted: false }, { id: 'saved', reverted: null }, { id: 'wrong', reverted: true, logs: ['locked'] }]) {
    const s = state(); s.journal.early = { id: 'saved', status: 'pending', expectedError: 'locked' };
    await assert.rejects(reconcilePending(s, () => {}, async () => ({ receipt, blockId: 'block', height: 1 })), /unexpected or malformed/);
    assert.equal(s.journal.early.status, 'failed'); assert.throws(() => assertNoOtherUnresolved(s, 'next'), /Resolve saved/);
  }
});
