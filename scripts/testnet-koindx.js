// Harbinger-only continuation of the native-token rehearsal. This runner uses
// an isolated router and fresh pool from pinned official KoinDX sources.
// init creates only a pool key and local state; run/resume can submit testnet
// transactions. Neither native launch #3 nor its seven-day claim is modified.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Contract, Serializer, Signer, utils } from 'koilib';
import { root, digest } from './rehearsal-build.js';
import { directory, assertNativeOperations } from './testnet-native.js';
import { HARBINGER, HARBINGER_RPC, assertChain, checkNetwork, executeTransaction, providerFor,
  publicReport, RpcRejection, save } from './rehearsal-core.js';
import { toKoilibAbi } from './abi-utils.js';

const UNIT = 100000000n, LAUNCH = 4, PREFIX = 'koindx-';
const stateFile = path.join(directory, 'state.json'), keyFile = path.join(directory, 'keys.json');
const buildDir = path.join(directory, 'koindx-build');
const requiredChecks = [
  'deploy native-name resolver and sale fixture', 'deploy historical native-token contracts',
  'fund isolated buyers and bounded allowances', 'create native escrow and launch positions before upgrade',
  'upgrade native positions with exact public state preservation', 'native order refund rejects wrong owner and pays once',
  'native payment rolls back when sale token fails then trading succeeds', 'native launch refund and creator payouts settle once',
  'real seven-day reclaim rejects early and reserves exact escrow'
];
const sourcePins = {
  core: '2ac84216015dc54e007766787d57a06dbe3140b6',
  periphery: 'b4a73401bcf0aed293ec46ed6fba295b1830c507'
};
const limitations = [
  'Official pinned KoinDX pool and router sources run at isolated Harbinger accounts; these source-derived builds do not attest the live mainnet KoinDX deployment.',
  'Sale token remains a controlled fixture. Production KoinDX deployments, deployed keeper processes and browser wallet flows require separate evidence.',
  'LP claiming waits for real testnet block time. Native launch 3 remains reserved for its separate seven-day reclaim.',
  'No production contract upload or mainnet readiness approval is performed.'
];
const metadataCodec = new Serializer({ nested: { Metadata: { fields: {
  hash: { type: 'bytes', id: 1 }, system: { type: 'bool', id: 2 },
  authorizesCall: { type: 'bool', id: 3 }, authorizesTransaction: { type: 'bool', id: 4 }, authorizesUpload: { type: 'bool', id: 5 }
} } } });

export function requireNativeChecks(state, { reportOnly = false } = {}) {
  assertChain(state.chainId, HARBINGER);
  assert.equal(state.kind, 'native-koin-extension');
  assert.ok(state.nativeToken && state.nativeToken === state.addresses.quote, 'Native token must be resolved and pinned');
  for (const name of requiredChecks) assert.equal(state.checks[name]?.status, 'passed', `Native prerequisite incomplete: ${name}`);
  // A later native reclaim must not invalidate historical offline evidence.
  // Mutation-capable continuation commands still require launch 3 untouched.
  if (!reportOnly) assert.notEqual(state.checks['seven-day native reclaim']?.status, 'passed', 'Preserve the unclaimed native launch 3 during this extension');
}

export function loadKoindxBuild() {
  const bytes = fs.readFileSync(path.join(buildDir, 'manifest.json')), manifest = JSON.parse(bytes);
  for (const [name, commit] of Object.entries(sourcePins)) assert.equal(manifest.sources[name].commit, commit, `Unreviewed ${name} source`);
  for (const name of ['pool', 'router']) {
    const artifact = manifest.artifacts[name];
    const wasm = fs.readFileSync(path.join(buildDir, `${name}.wasm`));
    const abi = fs.readFileSync(path.join(buildDir, `${name}-abi.json`));
    assert.equal(wasm.length, artifact.bytes, `${name} byte length changed`);
    assert.equal(digest(wasm), artifact.sha256, `${name} WASM changed`);
    assert.equal(digest(abi), artifact.abi.sha256, `${name} ABI changed`);
    new WebAssembly.Module(wasm);
  }
  return { manifest, manifestSha256: digest(bytes) };
}

export function integerSqrt(value) {
  assert.ok(typeof value === 'bigint' && value >= 0n);
  if (value < 2n) return value;
  let x = value, next = (x + 1n) / 2n;
  while (next < x) { x = next; next = (x + value / x) / 2n; }
  return x;
}

export function koindxResourceCap(operations) {
  // The official pool artifact is about 65 KB: its upload needs more than the
  // native runner's 5-tKOIN call cap, while remaining below the core 20 cap.
  return (operations.some(operation => operation.upload_contract) ? 10n : 5n) * UNIT;
}

function assertKeys(state, keys) {
  for (const name of ['payer', 'owner', 'buyer', 'router', 'pool']) {
    assert.equal(Signer.fromWif(keys[name]).getAddress(), state.addresses[name], `Mismatched ${name} role key`);
  }
  assert.equal(new Set(Object.values(state.addresses)).size, Object.keys(state.addresses).length, 'Rehearsal role addresses must be distinct');
}

export async function main(command = process.argv[2]) {
  if (!['init', 'run', 'resume', 'report'].includes(command)) throw new Error('Usage: node scripts/testnet-koindx.js init|run|resume|report');
  const state = JSON.parse(fs.readFileSync(stateFile));
  requireNativeChecks(state, { reportOnly: command === 'report' });
  const { manifest, manifestSha256 } = loadKoindxBuild();
  const persist = () => save(stateFile, state);
  const report = () => save(path.join(directory, 'koindx-report.json'), {
    ...publicReport(state, { ...manifest, limitations }), nativeToken: state.nativeToken,
    koindx: state.koindx, finality: state.koindx?.finality,
    nextAction: state.checks['koindx LP claim reaches creator once']?.status === 'passed'
      ? state.checks['seven-day native reclaim']?.status === 'passed'
        ? 'Continue the remaining integration/review requirements'
        : 'Continue the separate seven-day reclaim and remaining integration/review requirements'
      : 'Resume at the recorded LP unlock date, or resolve the last incomplete check'
  });
  if (command === 'init') {
    assert.ok(!state.koindx, 'KoinDX extension already initialized; use run or resume');
    const keys = JSON.parse(fs.readFileSync(keyFile));
    // A crash after saving keys but before state is recoverable without losing
    // the already-created pool key. Existing roles are always preserved.
    if (!keys.pool) {
      const signer = Signer.fromSeed(randomBytes(32).toString('hex'));
      keys.pool = signer.getPrivateKey('wif');
    }
    const pool = Signer.fromWif(keys.pool).getAddress();
    assert.ok(!state.addresses.pool || state.addresses.pool === pool, 'Existing pool address differs from its key');
    state.addresses.pool = pool; assertKeys(state, keys);
    state.koindx = { initializedAt: new Date().toISOString(), launchId: LAUNCH, manifestSha256,
      poolSha256: manifest.artifacts.pool.sha256, routerSha256: manifest.artifacts.router.sha256,
      sources: sourcePins, snapshots: {} };
    save(keyFile, keys); persist(); report();
    console.log('Initialized KoinDX extension with a fresh pool role; no transaction sent.'); return;
  }
  assert.ok(state.koindx, 'Run init first');
  assert.equal(state.koindx.manifestSha256, manifestSha256, 'KoinDX manifest changed after initialization');
  assert.equal(state.koindx.poolSha256, manifest.artifacts.pool.sha256);
  assert.equal(state.koindx.routerSha256, manifest.artifacts.router.sha256);
  assert.equal(state.koindx.launchId, LAUNCH);
  if (command === 'report') { report(); return; }
  const keys = JSON.parse(fs.readFileSync(keyFile)); assertKeys(state, keys);
  const a = state.addresses, provider = providerFor(process.env.REHEARSAL_RPC || HARBINGER_RPC);
  await checkNetwork(provider, HARBINGER);
  const contracts = {};
  for (const name of ['base', 'native', 'pool']) contracts[name] = new Contract({ id: name === 'native' ? state.nativeToken : a[name], provider, abi: utils.tokenAbi });
  contracts.launchpad = new Contract({ id: a.launchpad, provider, abi: toKoilibAbi(JSON.parse(fs.readFileSync(path.join(root, 'frontend/src/lib/launchpad-abi.json')))) });
  const routerAbi = JSON.parse(fs.readFileSync(path.join(buildDir, 'router-abi.json')));
  contracts.router = new Contract({ id: a.router, provider, abi: routerAbi.koilib_types ? routerAbi : toKoilibAbi(routerAbi) });
  const read = async (c, method, args = {}) => (await contracts[c].functions[method](args)).result;
  const op = async (c, method, args = {}) => (await contracts[c].functions[method](args, { onlyOperation: true })).operation;
  const tx = async (label, operations, actors = [], expectedError) => {
    const journalLabel = PREFIX + label;
    await assertNativeOperations(operations, state, journalLabel);
    return executeTransaction({ provider, state, keys, persist, label: journalLabel, operations, actors, expectedError, rcLimitCap: koindxResourceCap(operations) });
  };
  const call = async (label, contract, method, args, actors = [], expectedError) => tx(label, [await op(contract, method, args)], actors, expectedError);
  const balance = async (token, owner) => BigInt((await read(token, 'balanceOf', { owner })).value || '0');
  const launch = async id => (await read('launchpad', 'get_launch', { launchId: id }))?.value;
  const metadata = async address => {
    const args = (await op('base', 'balanceOf', { owner: address })).call_contract.args;
    try {
      const result = await provider.readContract({ contract_id: a.base, entry_point: 0x10000003, args });
      return metadataCodec.deserialize(result.result, 'Metadata');
    } catch (error) {
      if (error instanceof RpcRejection && /fixture: contract metadata missing/.test(error.message)) return null;
      throw error;
    }
  };
  const verifyMetadata = (meta, sha256, authority) => {
    assert.ok(meta, 'Expected deployed contract metadata');
    assert.equal(Buffer.from(meta.hash, 'base64url').toString('hex'), '1220' + sha256);
    assert.ok(!meta.system);
    for (const key of ['authorizesCall', 'authorizesTransaction', 'authorizesUpload']) assert.equal(!!meta[key], authority);
  };
  const snapshot = async () => {
    const balances = {};
    for (const token of ['native', 'base', 'pool']) balances[token] = Object.fromEntries(await Promise.all(
      ['buyer', 'owner', 'launchpad', 'router', 'pool'].map(async role => [role, String(await balance(token, a[role]))])));
    return { balances, launch3: await launch(3), launch4: await launch(LAUNCH) };
  };
  const remember = async name => {
    if (!state.koindx.snapshots[name]) { state.koindx.snapshots[name] = await snapshot(); persist(); }
    return state.koindx.snapshots[name];
  };
  const preserveLaunch3 = async () => assert.deepEqual(await launch(3), state.koindx.launch3, 'Seven-day reclaim launch 3 changed');
  const check = async (name, fn) => {
    if (state.checks[name]?.status === 'passed') return;
    console.log('Testing: ' + name);
    try { await fn(); state.checks[name] = { status: 'passed', at: new Date().toISOString() }; persist(); report(); }
    catch (error) { state.checks[name] = { status: 'incomplete', detail: error.message }; persist(); report(); throw error; }
  };
  const delta = (after, before, token, role, amount) => assert.equal(BigInt(after.balances[token][role]), BigInt(before.balances[token][role]) + amount, `${token}/${role} delta`);
  try {
    if (!state.koindx.launch3) { state.koindx.launch3 = await launch(3); assert.ok(state.koindx.launch3); persist(); }
    await preserveLaunch3();
    await check('koindx official router and fresh atomic pool bootstrap', async () => {
      const routerBytes = fs.readFileSync(path.join(buildDir, 'router.wasm'));
      const previousRouter = await metadata(a.router);
      if (!state.journal[PREFIX + 'upload-router']) assert.equal(previousRouter, null, 'Router account already has code outside this journal');
      else if (previousRouter) verifyMetadata(previousRouter, state.koindx.routerSha256, false);
      await tx('upload-router', [{ upload_contract: { contract_id: a.router, bytecode: utils.encodeBase64url(routerBytes),
        authorizes_call_contract: false, authorizes_transaction_application: false, authorizes_upload_contract: false } }], ['router']);
      verifyMetadata(await metadata(a.router), state.koindx.routerSha256, false);
      const poolBytes = fs.readFileSync(path.join(buildDir, 'pool.wasm'));
      const previousPool = await metadata(a.pool);
      if (!state.journal[PREFIX + 'create-pair']) assert.equal(previousPool, null, 'Pool account must be fresh before its first upload');
      else if (previousPool) verifyMetadata(previousPool, state.koindx.poolSha256, true);
      await tx('create-pair', [{ upload_contract: { contract_id: a.pool, bytecode: utils.encodeBase64url(poolBytes),
        authorizes_call_contract: true, authorizes_transaction_application: true, authorizes_upload_contract: true } },
      await op('router', 'create_pair', { tokenA: 'koin', tokenB: a.base })], ['pool']);
      verifyMetadata(await metadata(a.pool), state.koindx.poolSha256, true);
      assert.equal((await read('router', 'get_pair', { tokenA: 'koin', tokenB: a.base })).value, a.pool);
      for (const token of ['native', 'base', 'pool']) assert.equal(await balance(token, a.pool), 0n);
    });
    verifyMetadata(await metadata(a.router), state.koindx.routerSha256, false);
    verifyMetadata(await metadata(a.pool), state.koindx.poolSha256, true);
    await check('koindx native launch funded and settled', async () => {
      const before = await remember('beforeLaunch');
      assert.ok(!before.launch4, 'Launch 4 already exists outside this continuation');
      assert.ok(BigInt(before.balances.native.buyer) >= UNIT, 'Buyer needs 1 tKOIN from the existing capped funding');
      assert.ok(BigInt(before.balances.base.owner) >= 2n * UNIT);
      if (!state.koindx.schedule) {
        const time = Number((await provider.getHeadInfo()).head_block_time);
        state.koindx.schedule = { start: time - 1000, end: time + 10 * 60000 };
        state.koindx.claimDue = new Date(state.koindx.schedule.end).toISOString(); persist();
      }
      const terms = { creator: a.owner, token: a.base, price: String(UNIT), forSaleAmount: String(UNIT),
        startTime: String(state.koindx.schedule.start), endTime: String(state.koindx.schedule.end),
        liquidityBps: 5000, liquidityTokens: String(UNIT), lpUnlockTime: String(state.koindx.schedule.end) };
      await tx('fund-and-settle-launch', [await op('launchpad', 'create_launch', terms),
        await op('launchpad', 'contribute', { launchId: LAUNCH, buyer: a.buyer, amount: String(UNIT) }),
        await op('launchpad', 'finalize', { launchId: LAUNCH }), await op('launchpad', 'process', { launchId: LAUNCH })], ['owner', 'buyer']);
      const after = await snapshot();
      for (const [token, role, amount] of [['native', 'buyer', -UNIT], ['native', 'owner', UNIT / 2n], ['native', 'launchpad', UNIT / 2n],
        ['base', 'owner', -2n * UNIT], ['base', 'buyer', UNIT], ['base', 'launchpad', UNIT]]) delta(after, before, token, role, amount);
      assert.equal(after.launch4.liquidityState, 1); assert.equal(after.launch4.liquidityKoin, String(UNIT / 2n));
      assert.equal(after.launch4.liquidityTokens, String(UNIT)); await preserveLaunch3();
      state.koindx.snapshots.afterSettlement = after;
    });
    await check('koindx real router deposits native KOIN and mints exact LP', async () => {
      const before = await remember('beforeLiquidity');
      await call('provide-liquidity', 'launchpad', 'provide_liquidity', { launchId: LAUNCH });
      const after = await snapshot(), expectedLP = integerSqrt((UNIT / 2n) * UNIT) - 10000n;
      for (const [token, amount] of [['native', UNIT / 2n], ['base', UNIT]]) {
        delta(after, before, token, 'launchpad', -amount); delta(after, before, token, 'pool', amount);
        for (const role of ['owner', 'buyer', 'router']) delta(after, before, token, role, 0n);
      }
      assert.equal(after.launch4.pair, a.pool); assert.equal(after.launch4.liquidityState, 2);
      assert.equal(after.launch4.lpAmount, String(expectedLP));
      delta(after, before, 'pool', 'launchpad', expectedLP);
      assert.equal(await balance('native', a.launchpad), UNIT / 2n); assert.equal(await balance('base', a.launchpad), UNIT);
      state.koindx.lpAmount = String(expectedLP); state.koindx.snapshots.afterLiquidity = after;
      await preserveLaunch3();
    });
    if (Number((await provider.getHeadInfo()).head_block_time) < state.koindx.schedule.end) {
      await check('koindx LP claim rejects before actual unlock', async () => {
        const before = await remember('beforeEarlyClaim');
        await call('early-lp-claim', 'launchpad', 'claim_liquidity', { launchId: LAUNCH }, ['buyer'], 'liquidity is still locked');
        assert.deepEqual(await snapshot(), before);
      });
    } else if (!state.checks['koindx LP claim rejects before actual unlock']) {
      state.checks['koindx LP claim rejects before actual unlock'] = { status: 'not-exercised', detail: 'Actual unlock time passed before this check; early-lock coverage was not observed.' }; persist();
    }
    if (Number((await provider.getHeadInfo()).head_block_time) >= state.koindx.schedule.end) {
      await check('koindx LP claim reaches creator once', async () => {
        const before = await remember('beforeClaim');
        await call('deliver-lp-claim', 'launchpad', 'claim_liquidity', { launchId: LAUNCH }, ['buyer']);
        const after = await snapshot();
        delta(after, before, 'pool', 'owner', BigInt(state.koindx.lpAmount));
        delta(after, before, 'pool', 'launchpad', -BigInt(state.koindx.lpAmount));
        delta(after, before, 'pool', 'buyer', 0n); assert.equal(after.launch4.lpClaimed, true);
        assert.deepEqual(after.balances.native, before.balances.native); assert.deepEqual(after.balances.base, before.balances.base);
        await call('duplicate-lp-claim', 'launchpad', 'claim_liquidity', { launchId: LAUNCH }, ['buyer'], 'no locked liquidity to claim');
        assert.deepEqual(await snapshot(), after); await preserveLaunch3();
        state.koindx.snapshots.afterClaim = after;
      });
    } else {
      state.checks['koindx LP claim reaches creator once'] = { status: 'waiting', due: state.koindx.claimDue }; persist();
      console.log('LP claim waits for actual testnet time: ' + state.koindx.claimDue);
    }
    const head = await provider.getHeadInfo(); let count = 0, last = 0, lastBlockId;
    for (const [label, entry] of Object.entries(state.journal)) {
      if (!label.startsWith(PREFIX) || entry.outcome !== 'included') continue;
      const [block] = await provider.getBlocks(entry.evidence.height, 1, head.head_topology.id, { returnBlock: true, returnReceipt: true });
      assert.equal(block.block_id, entry.evidence.blockId); assert.ok(block.block.transactions.some(transaction => transaction.id === entry.id));
      const receipt = block.receipt.transaction_receipts.find(item => item.id === entry.id); assert.ok(receipt && !receipt.reverted);
      count++;
      if (entry.evidence.height >= last) { last = entry.evidence.height; lastBlockId = entry.evidence.blockId; }
    }
    // Receipt reads can span many new blocks. Refresh finality after them,
    // and prove the last verified block is still on this fresh head's branch.
    const freshHead = await provider.getHeadInfo(); assertChain(await provider.getChainId(), state.chainId);
    if (lastBlockId) {
      const [anchor] = await provider.getBlocks(last, 1, freshHead.head_topology.id, { returnBlock: false, returnReceipt: true });
      assert.equal(anchor.block_id, lastBlockId, 'Verified receipt branch changed before finality assessment');
    }
    state.koindx.finality = { canonicalReceiptsVerified: count, lastTransactionHeight: last,
      lastIrreversibleBlock: freshHead.last_irreversible_block, reached: count > 0 && BigInt(freshHead.last_irreversible_block) >= BigInt(last), verifiedAt: new Date().toISOString() };
    await preserveLaunch3(); persist();
  } finally { report(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; });
}
