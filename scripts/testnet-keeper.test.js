import test from 'node:test';
import assert from 'node:assert/strict';
import { termsFor, verifyCompleted, verifyFinality } from './testnet-keeper.js';
import { HARBINGER } from './rehearsal-core.js';

const fixture = () => {
  const balances = Object.fromEntries(['native', 'base', 'pool'].map(token => [token,
    Object.fromEntries(['buyer', 'owner', 'launchpad', 'router', 'pool'].map(role => [role, '100000000']))]));
  balances.native.pool = '50000000'; balances.base.pool = '100000000';
  const state = { addresses: { pool: 'pool', owner: 'owner', base: 'sale-token' }, schedule: { start: 1000, end: 601000 },
    snapshots: { before: { balances, poolSupply: '70710678', launch3: { id: 3, liquidityState: 1 } } } };
  const after = structuredClone(state.snapshots.before);
  after.launch5 = { id: 5, status: 2, cursor: 1, buyerCount: 1, lockedClaimed: true, lpClaimed: true, liquidityState: 2, pair: 'pool', lpAmount: '7071067' };
  for (const [token, role, delta] of [['native', 'buyer', -10000000n], ['native', 'owner', 5000000n], ['native', 'pool', 5000000n],
    ['base', 'buyer', 10000000n], ['base', 'owner', -20000000n], ['base', 'pool', 10000000n], ['pool', 'owner', 7071067n]]) {
    after.balances[token][role] = String(BigInt(after.balances[token][role]) + delta);
  }
  after.poolSupply = '77781745';
  return { state, after };
};
test('keeper launch uses existing bounded funding and equal-ratio liquidity with both locks', () => {
  const { state } = fixture(), terms = termsFor(state);
  assert.equal(terms.forSaleAmount, '10000000'); assert.equal(terms.price, '100000000');
  assert.equal(terms.liquidityTokens, '10000000'); assert.equal(terms.liquidityBps, 5000);
  assert.equal(terms.lockedAmount, '10000000');
  assert.equal(terms.unlockTime, terms.endTime); assert.equal(terms.lpUnlockTime, terms.endTime);
});
test('completed keeper accounting includes exact creator LP and unchanged older escrow', () => {
  const { state, after } = fixture(); verifyCompleted(state, after);
});
test('keeper verification rejects a changed seven-day launch', () => {
  const { state, after } = fixture(); after.launch3.liquidityState = 2;
  assert.throws(() => verifyCompleted(state, after), /Seven-day launch changed/);
});
test('keeper verification rejects trapped liquidity remainder', () => {
  const { state, after } = fixture(); after.balances.base.launchpad = '100000001';
  assert.throws(() => verifyCompleted(state, after), /base\/launchpad delta/);
});
test('keeper verification rejects missing lock payout or incorrect LP mint', () => {
  for (const update of [a => { a.launch5.lockedClaimed = false; }, a => { a.launch5.lpAmount = '7071068'; },
    a => { a.balances.pool.buyer = '100000001'; }]) {
    const { state, after } = fixture(); update(after); assert.throws(() => verifyCompleted(state, after));
  }
});

function finalityFixture({ lib = '200', changedBranch = false, malformed = false } = {}) {
  const transactions = ['finalize', 'process', 'provide_liquidity', 'claim_locked', 'claim_liquidity']
    .map((action, i) => ({ action, txId: `tx-${i}`, blockId: `block-${i}`, blockNumber: 101 + i }));
  const state = { addresses: { launchpad: 'launchpad', payer: 'payer' }, journal: {
    'keeper-create-and-fund-launch-5': { id: 'setup', evidence: { blockId: 'block-setup', height: 100 } },
  } };
  const keeper = { binding: { chainId: HARBINGER, launchpad: 'launchpad', payer: 'payer', launchId: 5 }, transactions };
  let heads = 0;
  const provider = {
    getHeadInfo: async () => ({ head_topology: { id: ++heads === 1 ? 'first' : 'fresh', height: '210' }, last_irreversible_block: lib }),
    getBlocks: async (height, count, head) => {
      const tx = height === 100 ? { txId: 'setup', blockId: 'block-setup' } : transactions.find(t => t.blockNumber === height);
      const id = changedBranch && head === 'fresh' ? 'replacement-block' : tx.blockId;
      return [{ block_id: id, block_height: String(height), block: { id, header: { height: String(height) }, transactions: [{ id: tx.txId }] },
        receipt: { id, transaction_receipts: [{ id: tx.txId, reverted: malformed ? 'false' : false }] } }];
    },
  };
  return { state, keeper, provider };
}
test('finality verifies every action and rejects early, reorganized or malformed evidence', async () => {
  const good = finalityFixture();
  assert.equal((await verifyFinality(good.provider, good.state, good.keeper)).transactions.length, 6);
  for (const options of [{ lib: '104' }, { changedBranch: true }, { malformed: true }]) {
    const f = finalityFixture(options); await assert.rejects(verifyFinality(f.provider, f.state, f.keeper));
  }
});
test('finality rejects duplicate actions and a different launch binding', async () => {
  for (const update of [k => { k.transactions.push(k.transactions[0]); }, k => { k.binding.launchId = 3; }]) {
    const f = finalityFixture(); update(f.keeper); await assert.rejects(verifyFinality(f.provider, f.state, f.keeper));
  }
});
