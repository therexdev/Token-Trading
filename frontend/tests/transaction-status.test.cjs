const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, requireModule = () => ({})) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, Error, URL, require: requireModule, localStorage: { getItem: () => null }, setTimeout() {} };
  vm.runInNewContext(code, context);
  return context.exports;
}
const status = load('lib/transactionStatus.ts');
function canonicalBlock(txId = 'submitted-id') {
  return {
    block_id: 'block-id', block_height: '42',
    block: { id: 'block-id', header: { height: '42' }, transactions: [{ id: txId }] },
    receipt: { id: 'block-id', transaction_receipts: [{ id: txId, reverted: false }] },
  };
}
function setup(receipt = {}, txId = 'submitted-id') {
  let sends = 0, waits = 0, confirmed = false;
  const provider = {
    getAccountRc: async () => '1000000000',
    getHeadInfo: async () => ({ head_topology: { id: 'fresh-head' } }),
    getBlocks: async (height, count, headId, options) => {
      assert.equal(height, 42); assert.equal(count, 1); assert.equal(headId, 'fresh-head');
      assert.equal(options.returnBlock, true); assert.equal(options.returnReceipt, true);
      return [canonicalBlock(txId)];
    },
    wait: async (id, mode) => {
      waits++; assert.equal(id, txId); assert.equal(mode, 'byTransactionId');
      if (!confirmed) throw new Error('RPC unavailable');
      return { blockNumber: 42, blockId: 'block-id' };
    },
  };
  const koinos = load('lib/koinos.ts', name => {
    if (name === './transactionStatus') return status;
    if (name === './rpcProvider') return { createProvider: () => provider };
    if (name === './sessionKey') return { getSessionSigner: () => ({ getAddress: () => 'owner' }) };
    if (name === './bioWallet') return { getBioSigner: () => null };
    if (name === 'koilib') return { Transaction: class {
      constructor() { this.transaction = { id: txId }; }
      async send() { sends++; return receipt; }
    } };
    return {};
  });
  return { koinos, provider, confirm: () => { confirmed = true; }, sends: () => sends, waits: () => waits };
}
test('a failed confirmation remains pending; checking later never broadcasts again', async () => {
  const c = setup(), handle = await c.koinos.sendOperations('owner', []);
  let pending;
  await assert.rejects(handle.wait(), error => { pending = error; return error instanceof status.ConfirmationPendingError; });
  const toast = status.transactionErrorToast(pending, 'Order failed');
  assert.equal(toast.kind, 'info'); assert.equal(toast.txId, handle.id); assert.match(toast.title, /pending/);
  c.confirm(); assert.equal((await toast.checkStatus()).blockNumber, 42);
  assert.equal(c.sends(), 1); assert.equal(c.waits(), 2);
});
test('explicitly reverted receipts and missing transaction IDs never become successful handles', async () => {
  const reverted = setup({ reverted: true, logs: ['orderbook: transfer failed'] });
  await assert.rejects(reverted.koinos.sendOperations('owner', []), /transfer failed/);
  assert.equal(reverted.waits(), 0);
  await assert.rejects(setup({}, '').koinos.sendOperations('owner', []), /no transaction ID/);
});
test('empty or malformed inclusion evidence is not success', async () => {
  for (const value of [{}, undefined, { blockNumber: 0 }, { blockNumber: NaN }, { blockNumber: '42' }]) {
    await assert.rejects(status.waitForInclusion({ wait: async () => value }, 'tx'), status.ConfirmationPendingError);
  }
});
test('the order, cancellation and listing store flows show pending without success or stale spinners', async () => {
  for (const action of ['submitOrder', 'submitCancel', 'submitCreateMarket']) {
    let broadcasts = 0;
    const submit = async () => { broadcasts++; return { id: 'tx', wait: () => status.waitForInclusion({ wait: async () => { throw new Error('timeout'); } }, 'tx') }; };
    const { useStore } = load('store/useStore.ts', name => {
      if (name === 'zustand') return require('zustand');
      if (name === '../lib/transactionStatus') return status;
      if (name === '../lib/koinos') return { placeOrder: submit, cancelOrder: submit, createMarket: submit };
      if (name === '../lib/bioWallet') return { loadBioSession: () => null };
      if (name === '../lib/sessionKey') return { sessionAddress: () => null };
      if (name === '../config/tokens') return { TOKENS: [] };
      return {};
    });
    useStore.setState({ account: 'owner', authMethod: 'kondor' });
    assert.equal(await useStore.getState()[action]({}, 'quote', 1n), false);
    const toasts = useStore.getState().toasts;
    assert.equal(toasts.length, 1); assert.equal(toasts[0].kind, 'info');
    assert.equal(toasts[0].txId, 'tx'); assert.equal(typeof toasts[0].checkStatus, 'function');
    assert.equal(broadcasts, 1);
  }
});
test('project links accept web URLs and reject executable, relative and credential-bearing URLs', () => {
  const { safeExternalUrl } = load('lib/safeUrl.ts');
  for (const value of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/relative', 'https://user:password@example.com', 'java\nscript:alert(1)', ' https://example.com']) {
    assert.equal(safeExternalUrl(value), undefined);
  }
  assert.equal(safeExternalUrl('https://example.com/project#info'), 'https://example.com/project#info');
});

test('block inclusion with a reverted receipt is failure; an unavailable receipt remains pending', async () => {
  for (const reverted of [true, false]) {
    const c = setup(); c.confirm();
    const block = canonicalBlock();
    block.receipt.transaction_receipts = reverted ? [{ id: 'submitted-id', reverted: true }] : [];
    c.provider.getBlocks = async () => [block];
    const handle = await c.koinos.sendOperations('owner', []);
    await assert.rejects(handle.wait(), error => {
      const toast = status.transactionErrorToast(error, 'Order failed');
      assert.equal(toast.kind, reverted ? 'error' : 'info');
      assert.equal(toast.txId, 'submitted-id');
      return true;
    });
  }
});

for (const [name, mutate] of [
  ['orphaned candidate after wait', block => { block.block_id = 'new-canonical-block'; }],
  ['mismatched block body', block => { block.block.id = 'other-block'; }],
  ['mismatched block height', block => { block.block_height = '43'; }],
  ['mismatched header height', block => { block.block.header.height = '43'; }],
  ['mismatched block receipt', block => { block.receipt.id = 'other-block'; }],
  ['receipt without transaction', block => { block.block.transactions = []; }],
  ['duplicate transactions', block => { block.block.transactions.push({ id: 'submitted-id' }); }],
  ['another transaction receipt', block => { block.receipt.transaction_receipts[0].id = 'other-tx'; }],
  ['duplicate receipts', block => { block.receipt.transaction_receipts.push({ id: 'submitted-id', reverted: true }); }],
  ...[null, 0, 1, '', 'false', 'true', {}].map(value => [
    `malformed reverted flag ${JSON.stringify(value)}`,
    block => { block.receipt.transaction_receipts[0].reverted = value; },
  ]),
]) test(name + ' retains the transaction ID and never broadcasts again', async () => {
  const c = setup(); c.confirm();
  const block = canonicalBlock(); mutate(block);
  c.provider.getBlocks = async () => [block];
  const handle = await c.koinos.sendOperations('owner', []);
  let pending;
  await assert.rejects(handle.wait(), error => {
    pending = error;
    return error instanceof status.ConfirmationPendingError && error.txId === 'submitted-id';
  });
  c.provider.getBlocks = async () => [canonicalBlock()];
  assert.equal((await pending.checkStatus()).blockNumber, 42);
  assert.equal(c.sends(), 1);
});

test('protobuf omitted false succeeds only with a matching canonical transaction and receipt', async () => {
  const c = setup(); c.confirm();
  const block = canonicalBlock(); delete block.receipt.transaction_receipts[0].reverted;
  c.provider.getBlocks = async () => [block];
  const handle = await c.koinos.sendOperations('owner', []);
  assert.equal((await handle.wait()).blockNumber, 42);
});

test('unavailable head and canonical RPC failures stay pending without falling back to block ID lookup', async () => {
  for (const failure of ['head', 'rpc']) {
    const c = setup(); c.confirm();
    if (failure === 'head') c.provider.getHeadInfo = async () => ({ head_topology: {} });
    else c.provider.getBlocks = async () => { throw new Error('RPC unavailable'); };
    c.provider.getBlocksById = async () => { assert.fail('must not accept retained orphan receipt'); };
    const handle = await c.koinos.sendOperations('owner', []);
    await assert.rejects(handle.wait(), error => error instanceof status.ConfirmationPendingError && error.txId === handle.id);
    assert.equal(c.sends(), 1);
  }
});
