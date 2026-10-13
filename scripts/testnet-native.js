// Harbinger-only extension. Separate accounts/journal preserve the completed
// fixture rehearsal. The native token is resolved by a contract system call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, Serializer, Signer, utils } from 'koilib';
import { root, work, compile, sourceAt, baseCommit, patchedCommit, digest } from './rehearsal-build.js';
import { HARBINGER, HARBINGER_RPC, createState, save, checkNetwork, providerFor, executeTransaction, publicReport, sameChain, reconcileResourceRejection } from './rehearsal-core.js';
import { toKoilibAbi } from './abi-utils.js';
export const directory = path.join(root, '.testnet-native');
const UNIT = 100000000n, GRACE = 604800000;
const limits = ['Native Harbinger KOIN integration; sale token is a controlled fixture.',
  'KoinDX/router, deployed keeper, and browser wallet integrations remain separate requirements.',
  'Seven-day reclaim remains pending until actual testnet time reaches the recorded due date.',
  'Synthetic positions do not replace an atomic production-state replay or independent review.'];
const codec = new Serializer({ nested: {
  Address: { fields: { value: { type: 'bytes', id: 1 } } },
  Metadata: { fields: { hash: { type: 'bytes', id: 1 }, system: { type: 'bool', id: 2 }, authorizesCall: { type: 'bool', id: 3 }, authorizesTransaction: { type: 'bool', id: 4 }, authorizesUpload: { type: 'bool', id: 5 } } },
  Mode: { fields: { value: { type: 'uint32', id: 1 } } },
} });
export function assertNativeOperation(operation, state) {
  const u = operation.upload_contract, c = operation.call_contract;
  if (u && state.nativeToken && u.contract_id === state.nativeToken) throw new Error('Cannot upload to the native token');
  if (!c || c.contract_id !== state.nativeToken) return;
  // Only capped transfers between our own accounts and bounded approvals to
  // our two contracts. No mint, burn, arbitrary destinations, or token upload.
  const raw = utils.tokenAbi.koilib_types;
  const s = new Serializer(raw);
  return (async () => {
    const known = Object.values(state.addresses).filter(a => a !== state.nativeToken);
    if (c.entry_point === 0x27f576ca) {
      const args = await s.deserialize(c.args, utils.tokenAbi.methods.transfer.argument);
      if (!known.includes(args.from) || !known.includes(args.to) || BigInt(args.value) > 6n * UNIT || BigInt(args.value) <= 0n) throw new Error('Native transfer outside the test budget/accounts');
    } else if (c.entry_point === 0x74e21680) {
      const args = await s.deserialize(c.args, utils.tokenAbi.methods.approve.argument);
      if (!known.includes(args.owner) || ![state.addresses.orderbook, state.addresses.launchpad].includes(args.spender) || BigInt(args.value || '0') > 6n * UNIT) throw new Error('Native approval outside the test budget/contracts');
    } else throw new Error('Native token method forbidden');
  })();
}
export async function assertNativeOperations(operations, state, label) {
  let payerOutflow = 0n;
  const count = async operation => {
    const c = operation.call_contract;
    if (c?.contract_id !== state.nativeToken || c.entry_point !== 0x27f576ca) return;
    const args = await new Serializer(utils.tokenAbi.koilib_types).deserialize(c.args, utils.tokenAbi.methods.transfer.argument);
    if (args.from === state.addresses.payer) payerOutflow += BigInt(args.value || '0');
  };
  // Pending/failed funding attempts still reserve budget. Only an exact resume
  // of the same journal entry may reuse that reservation; core also checks its
  // actors/fingerprint and never rebroadcasts a pending signed transaction.
  for (const [savedLabel, entry] of Object.entries(state.journal || {})) {
    if (label === savedLabel && JSON.stringify(entry.transaction?.operations) === JSON.stringify(operations)) continue;
    for (const operation of entry.transaction?.operations || []) await count(operation);
  }
  for (const operation of operations) { await assertNativeOperation(operation, state); await count(operation); }
  if (payerOutflow > 6n * UNIT) throw new Error('Native payer funding exceeds the total 6 tKOIN budget');
}
function buildFixture(state) {
  const dir = path.join(directory, 'build/fixture'); fs.mkdirSync(path.join(dir, 'proto'), { recursive: true });
  const source = fs.readFileSync(path.join(root, 'security-tests/testnet/Fixture.ts'), 'utf8')
    .replace('__REHEARSAL_QUOTE__', state.addresses.quote)
    .replace('switch (call.entry_point) {', `switch (call.entry_point) {
    case 0x10000004:
      output = Protobuf.encode(new launchpad.dex_address(System.getContractAddress('koin')), launchpad.dex_address.encode); break;`);
  fs.writeFileSync(path.join(dir, 'index.ts'), source);
  fs.writeFileSync(path.join(dir, 'proto/launchpad.ts'), sourceAt(patchedCommit, 'launchpad/assembly/proto/launchpad.ts'));
  return compile(path.join(dir, 'index.ts'), path.join(directory, 'build/fixture.wasm'));
}
function buildContracts(state, manifest) {
  for (const [name, folder, cls] of [['orderbook', 'contract', 'Orderbook'], ['launchpad', 'launchpad', 'Launchpad']]) {
    for (const [version, commit] of [['before', baseCommit], ['after', patchedCommit]]) {
      const artifact = `${name}-${version}`, dir = path.join(directory, 'build', artifact);
      fs.mkdirSync(path.join(dir, 'proto'), { recursive: true });
      for (const file of ['index.ts', `${cls}.ts`, `proto/${name}.ts`]) {
        const original = sourceAt(commit, `${folder}/assembly/${file}`); let source = original.toString();
        if (name === 'launchpad' && file === 'Launchpad.ts') {
          for (const [from, to] of [['19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK', state.nativeToken], ['17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s', state.addresses.router]]) {
            assert.equal(source.split(`"${from}"`).length, 2); source = source.replace(`"${from}"`, `"${to}"`);
          }
        }
        fs.writeFileSync(path.join(dir, file), source);
        manifest.sources[`${artifact}/${file}`] = { original: digest(original), test: digest(source) };
      }
      manifest.artifacts[artifact] = compile(path.join(dir, 'index.ts'), path.join(directory, 'build', artifact + '.wasm'));
    }
  }
  const release = JSON.parse(fs.readFileSync(path.join(root, 'scripts/security-release.json')));
  assert.equal(manifest.artifacts['orderbook-before'].sha256, release.contracts.orderbook.previousSha256);
  assert.equal(manifest.artifacts['orderbook-after'].sha256, release.contracts.orderbook.sha256);
}
export async function main(command = process.argv[2]) {
  const file = path.join(directory, 'state.json'), mf = path.join(directory, 'build/manifest.json');
  if (command === 'init') {
    const original = JSON.parse(fs.readFileSync(path.join(work, 'state.json')));
    assert.ok(sameChain(original.chainId, HARBINGER), 'Original backup must belong to Harbinger');
    const oldKeys = JSON.parse(fs.readFileSync(path.join(work, 'keys.json')));
    assert.equal(Signer.fromWif(oldKeys.payer).getAddress(), original.addresses.payer);
    const state = createState(directory), keys = JSON.parse(fs.readFileSync(path.join(directory, 'keys.json')));
    keys.payer = oldKeys.payer; state.addresses.payer = original.addresses.payer;
    state.chainId = HARBINGER; state.kind = 'native-koin-extension';
    save(file, state); save(path.join(directory, 'keys.json'), keys);
    const manifest = { testOnly: true, baseCommit, patchedCommit, artifacts: { fixture: buildFixture(state) }, sources: {}, limitations: limits };
    save(mf, manifest); console.log('Initialized isolated native-token extension; no transaction sent.'); return;
  }
  if (!['run', 'resume', 'report', 'reconcile-resource'].includes(command)) throw new Error('Usage: node scripts/testnet-native.js init|run|resume|report|reconcile-resource LABEL');
  const state = JSON.parse(fs.readFileSync(file)), manifest = JSON.parse(fs.readFileSync(mf));
  const persist = () => save(file, state);
  const report = () => save(path.join(directory, 'report.json'), { ...publicReport(state, manifest), nativeToken: state.nativeToken,
    nativeMetadata: state.nativeMetadata, reclaimDue: state.reclaimDue, nextAction: state.checks['seven-day native reclaim']?.status === 'passed' ? 'Review separate integration gates' : 'Resume at the recorded seven-day due date' });
  if (command === 'report') { report(); return; }
  const provider = providerFor(process.env.REHEARSAL_RPC || HARBINGER_RPC);
  await checkNetwork(provider, HARBINGER);
  assert.ok(sameChain(state.chainId, HARBINGER));
  if (command === 'reconcile-resource') {
    await reconcileResourceRejection({ provider, state, persist, label: process.argv[3] });
    report(); console.log('Explicit resource rejection reconciled. Resume retains the nonce and archived attempt.'); return;
  }
  const keys = JSON.parse(fs.readFileSync(path.join(directory, 'keys.json'))), a = state.addresses;
  const tx = async (label, operations, actors = [], expectedError) => {
    await assertNativeOperations(operations, state, label);
    return executeTransaction({ provider, state, keys, persist, label, operations, actors, expectedError, rcLimitCap: 5n * UNIT });
  };
  const contracts = {};
  for (const name of ['orderbook', 'launchpad']) contracts[name] = new Contract({ id: a[name], provider, abi: toKoilibAbi(JSON.parse(fs.readFileSync(path.join(root, `frontend/src/lib/${name}-abi.json`)))) });
  contracts.base = new Contract({ id: a.base, provider, abi: utils.tokenAbi });
  const read = async (c, m, args = {}) => (await contracts[c].functions[m](args)).result;
  const op = async (c, m, args = {}) => (await contracts[c].functions[m](args, { onlyOperation: true })).operation;
  const call = async (label, c, m, args = {}, actors = [], error) => tx(label, [await op(c, m, args)], actors, error);
  const balance = async (c, owner) => BigInt((await read(c, 'balanceOf', { owner })).value || '0');
  const meta = async account => {
    const args = (await op('base', 'balanceOf', { owner: account })).call_contract.args;
    const res = await provider.readContract({ contract_id: a.base, entry_point: 0x10000003, args });
    return codec.deserialize(res.result, 'Metadata');
  };
  const upload = async (role, artifact) => {
    const code = fs.readFileSync(path.join(directory, 'build', artifact + '.wasm'));
    assert.equal(digest(code), manifest.artifacts[artifact].sha256);
    await tx('upload-' + artifact, [{ upload_contract: { contract_id: a[role], bytecode: utils.encodeBase64url(code),
      authorizes_call_contract: false, authorizes_transaction_application: false, authorizes_upload_contract: false } }], [role]);
    const m = await meta(a[role]); assert.equal(Buffer.from(m.hash, 'base64url').toString('hex'), '1220' + digest(code));
    assert.ok(!m.system && !m.authorizesCall && !m.authorizesTransaction && !m.authorizesUpload);
  };
  const check = async (name, fn) => {
    if (state.checks[name]?.status === 'passed') return;
    console.log('Testing: ' + name);
    try { await fn(); state.checks[name] = { status: 'passed', at: new Date().toISOString() }; persist(); report(); }
    catch (error) { state.checks[name] = { status: 'incomplete', detail: error.message }; persist(); report(); throw error; }
  };
  const snapshot = async () => {
    const balances = {};
    for (const token of ['base', 'native']) balances[token] = Object.fromEntries(await Promise.all(['owner', 'buyer', 'orderbook', 'launchpad'].map(async role => [role, String(await balance(token, a[role]))])));
    return { balances, markets: await read('orderbook', 'get_markets'), book: await read('orderbook', 'get_orderbook', { marketId: 1, limit: 200 }),
      launches: await read('launchpad', 'get_launches', { start: 0, limit: 100 }),
      buyers: await Promise.all([1, 2, 3].map(launchId => read('launchpad', 'get_buyers', { launchId, start: 0, limit: 100 }))) };
  };
  const remember = async name => { if (!state.snapshots[name]) { state.snapshots[name] = await snapshot(); persist(); } return state.snapshots[name]; };
  const unchanged = async (name, before) => {
    state.verifications ||= {};
    if (state.verifications[name]) return;
    assert.deepEqual(await snapshot(), before);
    state.verifications[name] = { passedAt: new Date().toISOString() }; persist();
  };
  try {
    await check('deploy native-name resolver and sale fixture', () => upload('base', 'fixture'));
    const resolved = await provider.readContract({ contract_id: a.base, entry_point: 0x10000004, args: '' });
    const native = utils.encodeBase58(Buffer.from((await codec.deserialize(resolved.result, 'Address')).value, 'base64url'));
    if (state.nativeToken) assert.equal(native, state.nativeToken, 'Native system contract changed');
    assert.notEqual(native, '19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK');
    state.nativeToken = native; a.quote = native; state.nativeMetadata = await meta(native);
    assert.equal(state.nativeMetadata.system, true, 'Resolved KOIN must be a system contract'); persist();
    contracts.native = new Contract({ id: native, provider, abi: utils.tokenAbi });
    console.log('Verified native Harbinger KOIN: ' + native);
    if (!manifest.artifacts['launchpad-after']) { buildContracts(state, manifest); save(mf, manifest); }
    await check('deploy historical native-token contracts', async () => { await upload('orderbook', 'orderbook-before'); await upload('launchpad', 'launchpad-before'); });
    await check('fund isolated buyers and bounded allowances', async () => {
      await tx('fund-accounts', [await op('base', 'mint', { to: a.owner, value: String(20n * UNIT) }),
        await op('native', 'transfer', { from: a.payer, to: a.buyer, value: String(6n * UNIT) })], ['base']);
      const operations = [];
      for (const spender of [a.orderbook, a.launchpad]) {
        operations.push(await op('base', 'approve', { owner: a.owner, spender, value: String(20n * UNIT) }));
        operations.push(await op('native', 'approve', { owner: a.buyer, spender, value: String(6n * UNIT) }));
      }
      await tx('bounded-allowances', operations, ['owner', 'buyer']);
    });
    await check('create native escrow and launch positions before upgrade', async () => {
      await call('create-market', 'orderbook', 'create_market', { baseToken: a.base, quoteToken: native, minBaseAmount: '1' });
      await tx('old-native-orders', [await op('orderbook', 'place_order', { owner: a.owner, marketId: 1, side: 1, price: String(2n * UNIT), quantity: String(UNIT), flags: 2 }),
        await op('orderbook', 'place_order', { owner: a.buyer, marketId: 1, side: 0, price: String(UNIT), quantity: String(UNIT), flags: 2 })], ['owner', 'buyer']);
      if (!state.schedule) { const h = await provider.getHeadInfo(); state.schedule = { start: Number(h.head_block_time) - 1000, end: Number(h.head_block_time) + 30 * 60000 }; state.reclaimDue = new Date(state.schedule.end + GRACE).toISOString(); persist(); }
      const common = { creator: a.owner, token: a.base, price: String(UNIT), startTime: String(state.schedule.start), endTime: String(state.schedule.end), forSaleAmount: String(UNIT) };
      await tx('old-native-launches', [await op('launchpad', 'create_launch', { ...common, forSaleAmount: String(2n * UNIT) }),
        await op('launchpad', 'create_launch', common), await op('launchpad', 'create_launch', { ...common, liquidityBps: 5000, liquidityTokens: String(UNIT), lpUnlockTime: String(state.schedule.end) })], ['owner']);
      await tx('native-contributions', await Promise.all([1, 2, 3].map(launchId => op('launchpad', 'contribute', { launchId, buyer: a.buyer, amount: String(UNIT) }))), ['buyer']);
      await call('cancel-native-launch', 'launchpad', 'cancel_launch', { launchId: 1 }, ['owner']);
    });
    await check('upgrade native positions with exact public state preservation', async () => {
      const before = await remember('beforeUpgrade'); await upload('orderbook', 'orderbook-after'); await upload('launchpad', 'launchpad-after');
      const after = await snapshot(); assert.deepEqual(after, before); state.snapshots.afterUpgrade = after;
    });
    await check('native order refund rejects wrong owner and pays once', async () => {
      const before = await remember('beforeOrderRefund');
      await call('unauthorized-native-cancel', 'orderbook', 'cancel_order', { orderId: '2' }, ['owner'], 'authorization|authority|not authorized');
      await unchanged('unauthorized-native-cancel', before);
      await call('native-order-refund', 'orderbook', 'cancel_order', { orderId: '2' }, ['buyer']);
      assert.equal(await balance('native', a.buyer), BigInt(before.balances.native.buyer) + UNIT);
      await call('duplicate-native-cancel', 'orderbook', 'cancel_order', { orderId: '2' }, ['buyer'], 'unknown|not found');
    });
    await check('native payment rolls back when sale token fails then trading succeeds', async () => {
      const before = await remember('beforeTrading');
      const mode = async value => ({ call_contract: { contract_id: a.base, entry_point: 0x10000001, args: utils.encodeBase64url(await codec.serialize({ value }, 'Mode')) } });
      await tx('fail-sale-token', [await mode(1)], ['base']);
      const args = { owner: a.buyer, marketId: 1, side: 0, price: String(2n * UNIT), quantity: String(UNIT), flags: 1 };
      await call('failed-native-fill', 'orderbook', 'place_order', args, ['buyer'], 'fixture: forced transfer failure');
      await unchanged('failed-native-fill', before);
      await tx('restore-sale-token', [await mode(0)], ['base']); await call('native-fill', 'orderbook', 'place_order', args, ['buyer']);
      assert.equal(await balance('native', a.owner), BigInt(before.balances.native.owner) + 2n * UNIT);
      assert.equal(await balance('base', a.buyer), BigInt(before.balances.base.buyer) + UNIT);
      assert.equal(await balance('native', a.orderbook), 0n); assert.equal(await balance('base', a.orderbook), 0n);
    });
    await check('native launch refund and creator payouts settle once', async () => {
      const before = await remember('beforeSettlement');
      await call('native-launch-refund', 'launchpad', 'process', { launchId: 1, limit: 1 });
      assert.equal(await balance('native', a.buyer), BigInt(before.balances.native.buyer) + UNIT);
      await call('duplicate-native-launch-refund', 'launchpad', 'process', { launchId: 1 }, [], 'not.*(distributing|refunding)|nothing|settle|not in');
      await tx('native-launch-settlement', await Promise.all([op('launchpad', 'finalize', { launchId: 2 }), op('launchpad', 'process', { launchId: 2 }), op('launchpad', 'finalize', { launchId: 3 }), op('launchpad', 'process', { launchId: 3 })]));
      assert.equal(await balance('native', a.owner), BigInt(before.balances.native.owner) + UNIT + UNIT / 2n);
      assert.equal(await balance('base', a.buyer), BigInt(before.balances.base.buyer) + 2n * UNIT);
      await call('duplicate-native-finalize', 'launchpad', 'finalize', { launchId: 2 }, [], 'already finalized');
    });
    await check('real seven-day reclaim rejects early and reserves exact escrow', async () => {
      assert.ok(Number((await provider.getHeadInfo()).head_block_time) < state.schedule.end + GRACE, 'Early-claim window missed');
      const before = await remember('beforeEarlyReclaim');
      await call('early-native-reclaim', 'launchpad', 'reclaim_liquidity', { launchId: 3 }, ['owner'], '7-day grace period');
      await unchanged('early-native-reclaim', before);
      assert.equal(await balance('native', a.launchpad), UNIT / 2n); assert.equal(await balance('base', a.launchpad), UNIT);
    });
    if (Number((await provider.getHeadInfo()).head_block_time) >= state.schedule.end + GRACE) {
      await check('seven-day native reclaim', async () => {
        const before = await remember('beforeReclaim');
        await call('unauthorized-native-reclaim', 'launchpad', 'reclaim_liquidity', { launchId: 3 }, ['buyer'], 'authorization|authority|not authorized');
        await unchanged('unauthorized-native-reclaim', before);
        await call('native-reclaim', 'launchpad', 'reclaim_liquidity', { launchId: 3 }, ['owner']);
        await call('duplicate-native-reclaim', 'launchpad', 'reclaim_liquidity', { launchId: 3 }, ['owner'], 'not stuck');
        assert.equal(await balance('native', a.owner), BigInt(before.balances.native.owner) + UNIT / 2n);
        assert.equal(await balance('base', a.owner), BigInt(before.balances.base.owner) + UNIT);
        assert.equal(await balance('native', a.launchpad), 0n); assert.equal(await balance('base', a.launchpad), 0n);
        state.snapshots.afterReclaim = await snapshot();
      });
    } else { state.checks['seven-day native reclaim'] = { status: 'waiting', due: state.reclaimDue }; persist(); console.log('Seven-day reclaim is waiting until ' + state.reclaimDue); }
    // Re-read each included receipt against the current canonical chain.
    const head = await provider.getHeadInfo(); let verified = 0, last = 0, lastBlockId;
    for (const entry of Object.values(state.journal).filter(e => e.outcome === 'included')) {
      const [b] = await provider.getBlocks(entry.evidence.height, 1, head.head_topology.id, { returnBlock: true, returnReceipt: true });
      assert.equal(b.block_id, entry.evidence.blockId); assert.ok(b.block.transactions.some(t => t.id === entry.id));
      const receipt = b.receipt.transaction_receipts.find(r => r.id === entry.id); assert.ok(receipt && !receipt.reverted); verified++;
      if (entry.evidence.height >= last) { last = entry.evidence.height; lastBlockId = entry.evidence.blockId; }
    }
    const finalHead = await provider.getHeadInfo();
    assert.ok(sameChain(await provider.getChainId(), state.chainId));
    if (lastBlockId) {
      const [anchor] = await provider.getBlocks(last, 1, finalHead.head_topology.id, { returnBlock: false, returnReceipt: true });
      assert.equal(anchor.block_id, lastBlockId, 'Verified receipt branch changed before finality assessment');
    }
    state.finality = { canonicalReceiptsVerified: verified, lastTransactionHeight: last, lastIrreversibleBlock: finalHead.last_irreversible_block,
      reached: verified > 0 && BigInt(finalHead.last_irreversible_block) >= BigInt(last), verifiedAt: new Date().toISOString() }; persist();
  } finally { report(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.stderr?.toString() || e.message); process.exitCode = 1; });
