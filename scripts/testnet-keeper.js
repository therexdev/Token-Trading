// Prepare one bounded launch for the real gateway keeper; never run the
// keeper here or modify the original seven-day rehearsal journal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, Signer, utils } from 'koilib';
import { root, digest } from './rehearsal-build.js';
import { HARBINGER, HARBINGER_RPC, checkNetwork, providerFor, executeTransaction, save, publicReport, assertChain } from './rehearsal-core.js';
import { toKoilibAbi } from './abi-utils.js';

export const LAUNCH = 5, AMOUNT = 10000000n;
export const directory = path.join(root, '.testnet-keeper');
const sourceDir = path.join(root, '.testnet-native');
const limitations = ['Locally executed gateway keeper against isolated Harbinger contracts; hosted deployment and browser wallet approval remain separate.',
  'One buyer and existing official-source pool; multi-batch and pool-creation failure coverage remains offline.',
  'Native launch 3 and its original seven-day deadline are preserved. No mainnet transaction or readiness approval.'];

export function termsFor(state) {
  return { creator: state.addresses.owner, token: state.addresses.base, price: '100000000',
    forSaleAmount: String(AMOUNT), lockedAmount: String(AMOUNT), unlockTime: String(state.schedule.end),
    startTime: String(state.schedule.start), endTime: String(state.schedule.end),
    liquidityBps: 5000, liquidityTokens: String(AMOUNT), lpUnlockTime: String(state.schedule.end) };
}
export function verifyCompleted(state, after) {
  const before = state.snapshots.before, a = after.launch5;
  assert.ok(a && a.id === LAUNCH, 'Missing keeper launch');
  assert.equal(a.status, 2); assert.equal(a.cursor, 1); assert.equal(a.buyerCount, 1);
  assert.equal(a.lockedClaimed, true); assert.equal(a.lpClaimed, true); assert.equal(a.liquidityState, 2);
  assert.equal(a.pair, state.addresses.pool);
  assert.deepEqual(after.launch3, before.launch3, 'Seven-day launch changed');
  const delta = (token, role, amount) => assert.equal(BigInt(after.balances[token][role]), BigInt(before.balances[token][role]) + amount, `${token}/${role} delta`);
  for (const [token, role, amount] of [['native', 'buyer', -AMOUNT], ['native', 'owner', AMOUNT / 2n],
    ['native', 'pool', AMOUNT / 2n], ['native', 'launchpad', 0n], ['native', 'router', 0n],
    ['base', 'buyer', AMOUNT], ['base', 'owner', -2n * AMOUNT], ['base', 'pool', AMOUNT],
    ['base', 'launchpad', 0n], ['base', 'router', 0n], ['pool', 'launchpad', 0n], ['pool', 'buyer', 0n]]) delta(token, role, amount);
  const reserve = BigInt(before.balances.native.pool), supply = BigInt(before.poolSupply);
  assert.equal(BigInt(before.balances.base.pool), 2n * reserve, 'Expected the pinned pool ratio');
  const expectedLP = (AMOUNT / 2n) * supply / reserve;
  assert.equal(BigInt(a.lpAmount), expectedLP, 'LP mint differs from proportional reserve accounting');
  delta('pool', 'owner', expectedLP);
  assert.equal(BigInt(after.poolSupply), supply + expectedLP);
}

export async function verifyFinality(provider, state, keeper) {
  assert.equal(keeper.binding?.chainId, HARBINGER);
  assert.equal(keeper.binding?.launchpad, state.addresses.launchpad);
  assert.equal(keeper.binding?.launchId, LAUNCH);
  assert.equal(keeper.binding?.payer, state.addresses.payer);
  const actions = ['finalize', 'process', 'provide_liquidity', 'claim_locked', 'claim_liquidity'];
  assert.equal(keeper.transactions.length, actions.length, 'Expected each keeper action exactly once');
  for (const action of actions) assert.equal(keeper.transactions.filter(t => t.action === action).length, 1);
  const setup = state.journal['keeper-create-and-fund-launch-5'];
  const transactions = [{ txId: setup.id, action: 'setup', blockId: setup.evidence.blockId, blockNumber: setup.evidence.height }, ...keeper.transactions];
  const head = await provider.getHeadInfo();
  const lib = BigInt(head.last_irreversible_block);
  const evidence = [];
  for (const tx of transactions) {
    assert.ok(Number.isSafeInteger(tx.blockNumber) && tx.blockNumber > 0, 'Missing confirmed height');
    assert.ok(lib >= BigInt(tx.blockNumber), 'Wait for all keeper transactions to become irreversible');
    const [item] = await provider.getBlocks(tx.blockNumber, 1, head.head_topology.id, { returnBlock: true, returnReceipt: true });
    assert.equal(item?.block_id, tx.blockId); assert.equal(item?.block?.id, tx.blockId);
    assert.equal(item?.receipt?.id, tx.blockId);
    assert.equal(Number(item.block?.header?.height), tx.blockNumber);
    assert.equal(item.block?.transactions?.filter(t => t.id === tx.txId).length, 1);
    const receipts = item.receipt?.transaction_receipts?.filter(t => t.id === tx.txId);
    assert.equal(receipts?.length, 1);
    const receipt = receipts[0];
    assert.ok(receipt.reverted === false || receipt.reverted === undefined, 'Keeper transaction failed or receipt malformed');
    evidence.push({ ...tx, receipt });
  }
  const fresh = await provider.getHeadInfo();
  const last = transactions.reduce((a, b) => a.blockNumber > b.blockNumber ? a : b);
  const [stillCanonical] = await provider.getBlocks(last.blockNumber, 1, fresh.head_topology.id, { returnBlock: false, returnReceipt: false });
  assert.equal(stillCanonical?.block_id, last.blockId, 'Chain changed during finality capture');
  assert.ok(BigInt(fresh.last_irreversible_block) >= BigInt(last.blockNumber));
  return { at: new Date().toISOString(), head: fresh.head_topology, lastIrreversibleBlock: fresh.last_irreversible_block,
    transactions: evidence, allCanonicalNonrevertedIrreversible: true };
}

export async function main(command = process.argv[2]) {
  assert.ok(['setup', 'inspect', 'verify'].includes(command), 'Usage: node scripts/testnet-keeper.js setup|inspect|verify');
  const originalBytes = fs.readFileSync(path.join(sourceDir, 'state.json'));
  const original = JSON.parse(originalBytes);
  assertChain(original.chainId, HARBINGER);
  assert.equal(original.checks['koindx LP claim reaches creator once']?.status, 'passed');
  assert.notEqual(original.checks['seven-day native reclaim']?.status, 'passed');
  const file = path.join(directory, 'state.json');
  const provider = providerFor(process.env.REHEARSAL_RPC || HARBINGER_RPC);
  const network = await checkNetwork(provider, HARBINGER);
  const existing = fs.existsSync(file);
  assert.ok(existing || command === 'setup', 'Run setup first');
  const state = existing ? JSON.parse(fs.readFileSync(file)) : {
    version: 1, testOnly: true, kind: 'native-koin-extension', createdAt: new Date().toISOString(),
    chainId: HARBINGER, addresses: original.addresses, nativeToken: original.nativeToken,
    originalStateSha256: digest(originalBytes), koindx: original.koindx,
    schedule: { start: Number(network.head.head_block_time) - 1000, end: Number(network.head.head_block_time) + 600000 },
    journal: {}, checks: {}, snapshots: {}, mainnetReady: false,
  };
  assertChain(state.chainId, HARBINGER);
  assert.equal(state.originalStateSha256, digest(originalBytes), 'Original native checkpoint changed; review before continuing');
  assert.deepEqual(state.addresses, original.addresses);
  const a = state.addresses;
  const contracts = {};
  for (const name of ['native', 'base', 'pool']) contracts[name] = new Contract({ id: name === 'native' ? state.nativeToken : a[name], provider, abi: utils.tokenAbi });
  contracts.launchpad = new Contract({ id: a.launchpad, provider, abi: toKoilibAbi(JSON.parse(fs.readFileSync(path.join(root, 'frontend/src/lib/launchpad-abi.json')))) });
  const read = async (c, method, args = {}) => (await contracts[c].functions[method](args)).result;
  const snapshot = async () => {
    const balances = {};
    for (const token of ['native', 'base', 'pool']) {
      balances[token] = {};
      for (const role of ['buyer', 'owner', 'launchpad', 'router', 'pool']) balances[token][role] = (await read(token, 'balanceOf', { owner: a[role] })).value || '0';
    }
    return { balances, poolSupply: (await read('pool', 'totalSupply')).value || '0',
      launch3: (await read('launchpad', 'get_launch', { launchId: 3 }))?.value,
      launch5: (await read('launchpad', 'get_launch', { launchId: LAUNCH }))?.value };
  };
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const persist = () => save(file, state);
  const report = () => save(path.join(directory, 'report.json'), { ...publicReport(state, { limitations }), schedule: state.schedule, originalStateSha256: state.originalStateSha256 });
  if (command === 'setup') {
    if (state.checks['create sold-out keeper launch using existing buyer funds']?.status === 'passed') {
      console.log('Keeper launch is already prepared; use inspect or verify.');
      return;
    }
    if (!state.snapshots.before) {
      const before = await snapshot();
      assert.ok(!before.launch5, 'Launch 5 already exists outside this journal');
      assert.deepEqual(before.launch3, original.koindx.launch3, 'Reserved launch 3 changed');
      assert.ok(BigInt(before.balances.native.buyer) >= AMOUNT, 'Insufficient existing buyer funding');
      assert.ok(BigInt(before.balances.base.owner) >= 3n * AMOUNT, 'Insufficient sale fixture tokens');
      state.snapshots.before = before; persist();
    }
    const keys = JSON.parse(fs.readFileSync(path.join(sourceDir, 'keys.json')));
    for (const role of ['payer', 'owner', 'buyer']) assert.equal(Signer.fromWif(keys[role]).getAddress(), a[role]);
    const op = async (method, args) => (await contracts.launchpad.functions[method](args, { onlyOperation: true })).operation;
    await executeTransaction({ provider, state, keys, persist, label: 'keeper-create-and-fund-launch-5',
      operations: [await op('create_launch', termsFor(state)), await op('contribute', { launchId: LAUNCH, buyer: a.buyer, amount: String(AMOUNT) })],
      actors: ['owner', 'buyer'], rcLimitCap: 500000000n });
    const after = await snapshot();
    assert.deepEqual(after.launch3, state.snapshots.before.launch3);
    assert.equal(after.launch5.sold, String(AMOUNT));
    state.snapshots.afterSetup = after;
    state.checks['create sold-out keeper launch using existing buyer funds'] = { status: 'passed', at: new Date().toISOString() };
    persist(); report();
    console.log(JSON.stringify({ launchId: LAUNCH, endTime: new Date(state.schedule.end).toISOString(), contribution: '0.1 tKOIN', setupComplete: true }));
    return;
  }
  const after = await snapshot();
  assert.deepEqual(after.launch3, state.snapshots.before.launch3, 'Seven-day launch changed');
  if (command === 'verify') {
    verifyCompleted(state, after);
    const keeper = JSON.parse(fs.readFileSync(path.join(directory, 'keeper-report.json')));
    const pending = JSON.parse(fs.readFileSync(path.join(directory, 'keeper-pending.json')));
    assert.deepEqual(pending.launches, {}, 'Keeper still has pending transactions');
    state.finality = await verifyFinality(provider, state, keeper);
    state.snapshots.afterKeeper = after;
    state.checks['actual keeper settles, provides liquidity, and pays both locks once'] = { status: 'passed', at: new Date().toISOString() };
    persist(); report();
  }
  console.log(JSON.stringify({ launch5: after.launch5, balances: after.balances, originalCheckpointUnchanged: true, verified: command === 'verify' }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
