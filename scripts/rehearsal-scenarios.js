import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Contract, Serializer, utils } from 'koilib';
import { toKoilibAbi } from './abi-utils.js';
import { root, work, digest } from './rehearsal-build.js';
import { executeTransaction, delay } from './rehearsal-core.js';

const UNIT = 100000000n;
export async function scenarios(provider, state, keys, persist, manifest, buildDirectory = path.join(work, 'build')) {
  const a = state.addresses, contracts = {};
  for (const name of ['orderbook', 'launchpad']) contracts[name] = new Contract({ id: a[name], provider,
    abi: toKoilibAbi(JSON.parse(fs.readFileSync(path.join(root, `frontend/src/lib/${name}-abi.json`)))) });
  for (const name of ['base', 'quote', 'router']) contracts[name] = new Contract({ id: a[name], provider, abi: utils.tokenAbi });
  const configCodec = new Serializer({ nested: { Mode: { fields: { value: { type: 'uint32', id: 1 } } },
    Metadata: { fields: { hash: { type: 'bytes', id: 1 }, system: { type: 'bool', id: 2 },
      authorizesCall: { type: 'bool', id: 3 }, authorizesTransaction: { type: 'bool', id: 4 }, authorizesUpload: { type: 'bool', id: 5 } } },
    Callback: { fields: { contractId: { type: 'bytes', id: 1 }, entryPoint: { type: 'uint32', id: 2 }, args: { type: 'bytes', id: 3 } } } } });
  const read = async (c, m, args = {}) => (await contracts[c].functions[m](args)).result;
  const op = async (c, m, args = {}) => (await contracts[c].functions[m](args, { onlyOperation: true })).operation;
  const balance = async (c, owner) => BigInt((await read(c, 'balanceOf', { owner })).value || '0');
  const tx = (label, operations, actors = [], expectedError) => executeTransaction({ provider, state, keys, persist, label, operations, actors, expectedError });
  const call = async (label, c, m, args = {}, actors = [], expectedError) => tx(label, [await op(c, m, args)], actors, expectedError);
  const control = async (label, c, mode, callback) => {
    const operations = [];
    if (callback) operations.push({ call_contract: { contract_id: a[c], entry_point: 0x10000002,
      args: utils.encodeBase64url(await configCodec.serialize({ contractId: utils.encodeBase64url(utils.decodeBase58(callback.contract_id)),
        entryPoint: callback.entry_point, args: callback.args }, 'Callback')) } });
    operations.push({ call_contract: { contract_id: a[c], entry_point: 0x10000001, args: utils.encodeBase64url(await configCodec.serialize({ value: mode }, 'Mode')) } });
    await tx(label, operations, [c]);
  };
  const snapshot = async () => {
    const balances = {};
    for (const token of ['base', 'quote', 'router']) {
      balances[token] = Object.fromEntries(await Promise.all(['owner', 'buyer', 'orderbook', 'launchpad', 'router']
        .map(async account => [account, (await balance(token, a[account])).toString()])));
    }
    const launches = await read('launchpad', 'get_launches', { start: 0, limit: 100 });
    const buyers = await Promise.all((launches.launches || []).map(launch => read('launchpad', 'get_buyers', { launchId: launch.id, start: 0, limit: 100 })));
    const [markets, book, ownerOrders, buyerOrders] = await Promise.all([
      read('orderbook', 'get_markets'), read('orderbook', 'get_orderbook', { marketId: 1, limit: 200 }),
      read('orderbook', 'get_user_orders', { owner: a.owner }), read('orderbook', 'get_user_orders', { owner: a.buyer }),
    ]);
    return { markets, book, ownerOrders, buyerOrders,
      launches, buyers, balances };
  };
  const remember = async (name, make) => {
    if (!(name in state.snapshots)) { state.snapshots[name] = await make(); persist(); }
    return state.snapshots[name];
  };
  const unchanged = async (label, before) => {
    state.verifications ||= {};
    if (state.verifications[label]) return;
    assert.deepEqual(await snapshot(), before);
    state.verifications[label] = { passedAt: new Date().toISOString() }; persist();
  };
  const check = async (name, action) => {
    if (state.checks[name]?.status === 'passed') return;
    console.log(`Testing: ${name}`);
    try { await action(); state.checks[name] = { status: 'passed', at: new Date().toISOString() }; persist(); }
    catch (error) { state.checks[name] = { status: 'incomplete', detail: error.message }; persist(); throw error; }
  };
  const upload = async (role, artifact) => {
    const binary = fs.readFileSync(path.join(buildDirectory, artifact + '.wasm'));
    if (digest(binary) !== manifest.artifacts[artifact].sha256) throw new Error('Test artifact changed after build');
    const entry = await tx(`upload-${role}-${artifact}`, [{ upload_contract: { contract_id: a[role], bytecode: utils.encodeBase64url(binary),
      authorizes_call_contract: false, authorizes_transaction_application: false, authorizes_upload_contract: false } }], [role]);
    const request = (await op('base', 'balanceOf', { owner: a[role] })).call_contract;
    request.entry_point = 0x10000003;
    const response = await provider.readContract(request);
    const metadata = await configCodec.deserialize(response.result, 'Metadata');
    if (!metadata.hash || Buffer.from(metadata.hash, 'base64url').toString('hex') !== '1220' + manifest.artifacts[artifact].sha256) throw new Error('Uploaded bytecode hash does not match');
    if (metadata.system || metadata.authorizesCall || metadata.authorizesTransaction || metadata.authorizesUpload) throw new Error('Unexpected contract authorization metadata');
    return entry;
  };
  await check('deploy historical contracts and controlled fixtures', async () => {
    for (const c of ['base', 'quote', 'router']) await upload(c, 'fixture');
    await upload('orderbook', 'orderbook-before'); await upload('launchpad', 'launchpad-before');
  });
  await check('fund test tokens and grant bounded allowances', async () => {
    const operations = [];
    for (const token of ['base', 'quote']) for (const user of ['owner', 'buyer']) {
      operations.push(await op(token, 'mint', { to: a[user], value: String(1000n * UNIT) }));
      for (const target of ['orderbook', 'launchpad']) operations.push(await op(token, 'approve', { owner: a[user], spender: a[target], value: String(1000n * UNIT) }));
    }
    await tx('mint-and-approve', operations, ['base', 'quote', 'owner', 'buyer']);
  });
  await check('create old-version resting orders', async () => {
    await call('market', 'orderbook', 'create_market', { baseToken: a.base, quoteToken: a.quote, minBaseAmount: '1' });
    await tx('old-orders', [
      await op('orderbook', 'place_order', { owner: a.owner, marketId: 1, side: 1, price: String(3n * UNIT), quantity: String(UNIT), flags: 2 }),
      await op('orderbook', 'place_order', { owner: a.buyer, marketId: 1, side: 0, price: String(UNIT), quantity: String(2n * UNIT), flags: 2 }),
      await op('orderbook', 'place_order', { owner: a.owner, marketId: 1, side: 1, price: String(2n * UNIT), quantity: String(2n * UNIT), flags: 2 }),
    ], ['owner', 'buyer']);
  });
  await check('create old-version launches, refunds, and locked liquidity', async () => {
    if (!state.schedule) { const head = await provider.getHeadInfo(); state.schedule = { start: Number(head.head_block_time) - 1000, end: Number(head.head_block_time) + 30 * 60 * 1000 }; persist(); }
    const common = { creator: a.owner, token: a.base, mode: 0, price: String(UNIT), forSaleAmount: String(2n * UNIT), startTime: String(state.schedule.start), endTime: String(state.schedule.end) };
    await tx('old-launches', [
      await op('launchpad', 'create_launch', { ...common, lockedAmount: String(UNIT), unlockTime: String(state.schedule.end), liquidityBps: 5000, liquidityTokens: String(UNIT), lpUnlockTime: String(state.schedule.end) }),
      await op('launchpad', 'create_launch', { ...common }),
      await op('launchpad', 'create_launch', { ...common }),
      await op('launchpad', 'create_launch', { ...common, mode: 1, price: '0', forSaleAmount: String(3n * UNIT) }),
    ], ['owner']);
    await tx('old-contributions', [
      await op('launchpad', 'contribute', { launchId: 1, buyer: a.buyer, amount: String(2n * UNIT) }),
      await op('launchpad', 'contribute', { launchId: 2, buyer: a.buyer, amount: String(UNIT) }),
      await op('launchpad', 'contribute', { launchId: 3, buyer: a.buyer, amount: String(2n * UNIT) }),
      await op('launchpad', 'contribute', { launchId: 4, buyer: a.buyer, amount: String(UNIT) }),
      await op('launchpad', 'contribute', { launchId: 4, buyer: a.owner, amount: String(2n * UNIT) }),
    ], ['buyer', 'owner']);
    await tx('old-settlements', [await op('launchpad', 'finalize', { launchId: 1 }), await op('launchpad', 'process', { launchId: 1 }),
      await op('launchpad', 'provide_liquidity', { launchId: 1 }), await op('launchpad', 'cancel_launch', { launchId: 2 })], ['owner']);
  });
  await check('upgrade both existing accounts without changing state', async () => {
    const before = await remember('beforeUpgrade', snapshot);
    await upload('orderbook', 'orderbook-after'); await upload('launchpad', 'launchpad-after');
    const after = await snapshot(); assert.deepEqual(after, before); state.snapshots.afterUpgrade = after;
  });
  await check('preserved token and LP locks reject early claims', async () => {
    const now = Number((await provider.getHeadInfo()).head_block_time);
    if (now >= state.schedule.end) throw new Error('Early-claim window elapsed before this check; a fresh rehearsal is needed to cover it');
    const before = await remember('beforeEarlyClaims', snapshot);
    await call('early-token-claim', 'launchpad', 'claim_locked', { launchId: 1 }, [], 'still locked');
    await call('early-lp-claim', 'launchpad', 'claim_liquidity', { launchId: 1 }, [], 'still locked');
    await unchanged('early-claims-state', before);
  });
  await check('reject unauthorized order cancellation and administration', async () => {
    const before = await remember('beforeUnauthorized', snapshot);
    await call('wrong-owner', 'orderbook', 'cancel_order', { orderId: '1' }, ['buyer'], 'authorization|authority|not authorized');
    await call('wrong-admin', 'orderbook', 'set_min_base_amount', { marketId: 1, minBaseAmount: '2' }, ['buyer'], 'authorization|authority|not authorized');
    await unchanged('unauthorized-state', before);
    await call('valid-admin', 'orderbook', 'set_min_base_amount', { marketId: 1, minBaseAmount: '1' }, ['orderbook']);
  });
  await check('failed order refund and callback leave escrow intact', async () => {
    const before = await remember('beforeRefundFailure', snapshot);
    await control('base-fails', 'base', 1);
    await call('failed-refund', 'orderbook', 'cancel_order', { orderId: '1' }, ['owner'], 'fixture: forced transfer failure');
    await unchanged('failed-order-refund-state', before);
    const callback = (await op('orderbook', 'create_market', { baseToken: a.quote, quoteToken: a.base, minBaseAmount: '1' })).call_contract;
    await control('base-callback', 'base', 2, callback);
    await call('callback-refund', 'orderbook', 'cancel_order', { orderId: '1' }, ['owner'], 'reentrant mutation');
    await unchanged('callback-order-refund-state', before);
    await control('base-restored', 'base', 0);
    await call('valid-refund', 'orderbook', 'cancel_order', { orderId: '1' }, ['owner']);
    assert.equal(await balance('base', a.owner), BigInt(before.balances.base.owner) + UNIT);
    await call('duplicate-refund', 'orderbook', 'cancel_order', { orderId: '1' }, ['owner'], 'unknown|not found');
  });
  await check('existing orders fill and sequential operations release the lock', async () => {
    const before = await remember('beforeFills', snapshot);
    await tx('fill-old-orders', [
      await op('orderbook', 'place_order', { owner: a.buyer, marketId: 1, side: 0, price: String(2n * UNIT), quantity: String(UNIT), flags: 1 }),
      await op('orderbook', 'place_order', { owner: a.owner, marketId: 1, side: 1, price: String(UNIT), quantity: String(2n * UNIT), flags: 1 }),
    ], ['buyer', 'owner']);
    assert.equal(await balance('base', a.buyer), BigInt(before.balances.base.buyer) + 3n * UNIT);
    assert.equal(await balance('quote', a.owner), BigInt(before.balances.quote.owner) + 4n * UNIT);
    const order = (await read('orderbook', 'get_order', { orderId: '3' })).value;
    assert.equal(order.remaining, String(UNIT));
    const postBefore = await remember('beforePostOnly', snapshot);
    await call('post-only-cross', 'orderbook', 'place_order', { owner: a.buyer, marketId: 1, side: 0, price: String(2n * UNIT), quantity: String(UNIT), flags: 2 }, ['buyer'], 'post.only|POST_ONLY|cross');
    await unchanged('post-only-state', postBefore);
  });
  await check('pending launch refunds settle exactly once', async () => {
    const before = await remember('beforeLaunchRefund', snapshot);
    await call('process-refund', 'launchpad', 'process', { launchId: 2, limit: 1 });
    assert.equal(await balance('quote', a.buyer), BigInt(before.balances.quote.buyer) + UNIT);
    await call('duplicate-process-refund', 'launchpad', 'process', { launchId: 2 }, [], 'not.*(distributing|refunding)|nothing|settle|not in');
  });
  await check('launch finalization rollback and callback rejection allow a retry', async () => {
    const before = await remember('beforeLaunchFailure', snapshot);
    await control('quote-fails', 'quote', 1);
    await call('failed-finalize', 'launchpad', 'finalize', { launchId: 3 }, [], 'fixture: forced transfer failure');
    await unchanged('failed-finalize-state', before);
    await control('quote-callback', 'quote', 2, (await op('launchpad', 'finalize', { launchId: 3 })).call_contract);
    await call('callback-finalize', 'launchpad', 'finalize', { launchId: 3 }, [], 'reentrant mutation');
    await unchanged('callback-finalize-state', before);
    await control('quote-restored', 'quote', 0);
    await tx('settle-fixed', [await op('launchpad', 'finalize', { launchId: 3 }), await op('launchpad', 'process', { launchId: 3, limit: 1 })]);
    assert.equal(await balance('quote', a.owner), BigInt(before.balances.quote.owner) + 2n * UNIT);
    assert.equal(await balance('base', a.buyer), BigInt(before.balances.base.buyer) + 2n * UNIT);
    await call('duplicate-finalize', 'launchpad', 'finalize', { launchId: 3 }, [], 'already finalized');
  });
  await check('wait for real testnet block time to reach the unlock date', async () => {
    const deadline = Math.max(Date.now(), state.schedule.end) + 12 * 60 * 1000; let logAt = 0;
    for (;;) {
      const now = Number((await provider.getHeadInfo()).head_block_time);
      if (now >= state.schedule.end) break;
      if (Date.now() > deadline) throw new Error('Testnet did not reach the unlock time; resume after the node catches up');
      if (Date.now() - logAt > 20000) { console.log(`Waiting for testnet unlock: ${Math.ceil((state.schedule.end - now) / 1000)} seconds`); logAt = Date.now(); }
      await delay(5000);
    }
  });
  await check('locked claims preserve beneficiary, rollback, and single payout', async () => {
    const before = await remember('beforeFinalClaims', snapshot);
    await control('lp-fails', 'router', 1);
    await call('failed-lp-claim', 'launchpad', 'claim_liquidity', { launchId: 1 }, [], 'fixture: forced transfer failure');
    await unchanged('failed-lp-claim-state', before);
    await control('lp-callback', 'router', 2, (await op('launchpad', 'claim_liquidity', { launchId: 1 })).call_contract);
    await call('callback-lp-claim', 'launchpad', 'claim_liquidity', { launchId: 1 }, [], 'reentrant mutation');
    await unchanged('callback-lp-claim-state', before);
    await control('lp-restored', 'router', 0);
    await tx('deliver-claims', [await op('launchpad', 'claim_locked', { launchId: 1 }), await op('launchpad', 'claim_liquidity', { launchId: 1 })]);
    assert.equal(await balance('base', a.owner), BigInt(before.balances.base.owner) + UNIT);
    assert.equal(await balance('router', a.owner), BigInt(before.balances.router.owner) + UNIT);
    await call('duplicate-token-claim', 'launchpad', 'claim_locked', { launchId: 1 }, [], 'nothing locked|no locked|already claimed');
    await call('duplicate-lp-claim', 'launchpad', 'claim_liquidity', { launchId: 1 }, [], 'no locked liquidity');
  });
  await check('pool settlement preserves proportional payouts after upgrade', async () => {
    const before = await remember('beforePool', snapshot);
    await call('pool-finalize', 'launchpad', 'finalize', { launchId: 4 });
    await tx('pool-batches', [await op('launchpad', 'process', { launchId: 4, limit: 1 }), await op('launchpad', 'process', { launchId: 4, limit: 1 })]);
    assert.equal(await balance('base', a.buyer), BigInt(before.balances.base.buyer) + UNIT);
    assert.equal(await balance('base', a.owner), BigInt(before.balances.base.owner) + 2n * UNIT);
    assert.equal(await balance('quote', a.owner), BigInt(before.balances.quote.owner) + 3n * UNIT);
    const result = await read('launchpad', 'get_launch', { launchId: 4 }); assert.equal(result.value.status, 2);
  });
  await check('all launch obligations paid and remaining order escrow reconciles', async () => {
    const result = await snapshot(); state.snapshots.final = result;
    assert.equal(result.balances.base.launchpad, '0'); assert.equal(result.balances.quote.launchpad, '0'); assert.equal(result.balances.router.launchpad, '0');
    assert.equal(result.balances.base.orderbook, String(UNIT)); assert.equal(result.balances.quote.orderbook, '0');
  });
  // Finality is reported separately. Do not turn inclusion into a finality claim.
  const last = Math.max(...Object.values(state.journal).map(x => x.evidence?.height || 0));
  const head = await provider.getHeadInfo();
  state.finality = { lastTransactionHeight: last, lastIrreversibleBlock: head.last_irreversible_block,
    reached: BigInt(head.last_irreversible_block) >= BigInt(last) }; persist();
}
