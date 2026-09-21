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
function setup(receipt = {}, txId = 'submitted-id') {
  let sends = 0, waits = 0, confirmed = false;
  const provider = {
    getAccountRc: async () => '1000000000',
    getBlocksById: async () => ({ block_items: [{ block_id: 'block-id', receipt: { transaction_receipts: [{ id: txId, reverted: false }] } }] }),
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
    c.provider.getBlocksById = async () => ({ block_items: [{ block_id: 'block-id', receipt: { transaction_receipts: reverted ? [{ id: 'submitted-id', reverted: true }] : [] } }] });
    const handle = await c.koinos.sendOperations('owner', []);
    await assert.rejects(handle.wait(), error => {
      const toast = status.transactionErrorToast(error, 'Order failed');
      assert.equal(toast.kind, reverted ? 'error' : 'info');
      assert.equal(toast.txId, 'submitted-id');
      return true;
    });
  }
});
