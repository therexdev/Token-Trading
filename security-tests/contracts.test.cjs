// Execute the current AssemblyScript contracts as WASM, with hostile token and
// authority callbacks. This host models atomic rollback; a real-node upgrade
// rehearsal remains a release gate (see docs/security-requirements.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const fromContract = createRequire(path.join(__dirname, '../contract/package.json'));
const { MockVM } = fromContract('@koinos/mock-vm');
const { koinos } = fromContract('@koinos/proto-js');
const protobuf = fromContract('protobufjs');
const { chain, contracts: { token } } = koinos;
const sid = chain.system_call_id;
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'trade-contract-security-'));
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));

function compile(folder, namespace) {
  const cwd = path.join(root, folder), output = path.join(temp, folder + '.wasm');
  execFileSync(process.execPath, [path.join(cwd, 'node_modules/assemblyscript/bin/asc'),
    'assembly/index.ts', '--config', 'asconfig.json', '--target', 'release',
    '--outFile', output, '--textFile', path.join(temp, folder + '.wat'),
    '--sourceMap', path.join(temp, folder + '.map'), '--exportStart', '_start',
    '--use', 'abort=', '--use', 'BUILD_FOR_TESTING=0', '--disable', 'sign-extension,bulk-memory,nontrapping-f2i,multi-value'], { cwd, stdio: 'pipe' });
  execFileSync(path.join(cwd, 'node_modules/.bin/wasm-opt'), [output, '-all',
    '--llvm-memory-copy-fill-lowering', '--signext-lowering', '--llvm-nontrapping-fptoint-lowering',
    '-O1', '--mvp-features', '--strip-debug', '--strip-producers', '-o', output], { cwd, stdio: 'pipe' });
  const proto = protobuf.parse(fs.readFileSync(path.join(cwd, 'assembly/proto', namespace + '.proto'), 'utf8'), { keepCase: true }).root;
  const abi = JSON.parse(fs.readFileSync(path.join(root, 'frontend/src/lib', namespace + '-abi.json')));
  return { module: new WebAssembly.Module(fs.readFileSync(output)), proto, abi, namespace };
}
const contracts = { orderbook: compile('contract', 'orderbook'), launchpad: compile('launchpad', 'launchpad') };
const addr = n => Buffer.alloc(25, n);
const owner = addr(1), buyer = addr(2), base = addr(3), quote = addr(4);
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

class Host {
  constructor(name) {
    this.contract = contracts[name]; this.id = addr(9);
    this.db = new MockVM(true).db; this.balances = new Map();
    this.now = 1000; this.onCall = null; this.onAuthority = null; this.authorized = true;
  }
  balance(tokenId, account) { return this.balances.get(Buffer.from(tokenId).toString('hex') + ':' + Buffer.from(account).toString('hex')) || 0n; }
  mint(tokenId, account, value) { this.balances.set(Buffer.from(tokenId).toString('hex') + ':' + Buffer.from(account).toString('hex'), BigInt(value)); }
  encode(name, value) { const t = this.contract.proto.lookupType(this.contract.namespace + '.' + name); return t.encode(t.fromObject(value)).finish(); }
  decode(name, bytes) { const t = this.contract.proto.lookupType(this.contract.namespace + '.' + name); return t.toObject(t.decode(bytes), { longs: String, defaults: true }); }
  lockSpace() { return { system: false, zone: this.id, id: this.contract.namespace === 'orderbook' ? 6 : 4 }; }
  invoke(name, args = {}) {
    const snapshot = [...this.db.db], balances = new Map(this.balances);
    const vm = new MockVM(true); vm.db = this.db;
    const input = this.encode(name + '_arguments', args);
    const entry = this.contract.abi.methods[name].entryPoint ?? this.contract.abi.methods[name].entry_point;
    const imports = { env: { invoke_system_call: (id, ret, size, arg, len, retBytes) => {
      const bytes = Buffer.from(new Uint8Array(vm.memory.buffer, arg, len));
      const reply = (type, value) => {
        const data = type.encode(value).finish();
        assert.ok(data.length <= size);
        new Uint8Array(vm.memory.buffer, ret, data.length).set(data);
        new Uint32Array(vm.memory.buffer, retBytes, 1)[0] = data.length;
        return 0;
      };
      if (id === sid.get_contract_id) return reply(chain.get_contract_id_result, { value: this.id });
      if (id === sid.get_caller) return reply(chain.get_caller_result, { value: { caller: new Uint8Array(), caller_privilege: 0 } });
      if (id === sid.get_arguments) return reply(chain.get_arguments_result, { value: { entry_point: entry, arguments: input } });
      if (id === sid.get_block_field) return reply(chain.get_block_field_result, { value: { uint64_value: String(this.now) } });
      if (id === sid.get_transaction_field) return reply(chain.get_transaction_field_result, { value: { bytes_value: owner } });
      if (id === sid.check_authority) {
        this.onAuthority?.();
        return reply(chain.check_authority_result, { value: this.authorized });
      }
      if (id === sid.event || id === sid.log) { new Uint32Array(vm.memory.buffer, retBytes, 1)[0] = 0; return 0; }
      if (id === sid.exit) {
        const exit = chain.exit_arguments.decode(bytes);
        throw Object.assign(new Error(exit.res?.error?.message || ''), { contractExit: true, code: exit.code, value: exit.res?.object });
      }
      if (id === sid.call) {
        const call = chain.call_arguments.decode(bytes);
        if (call.entry_point === 0xee80fd2f) {
          this.onCall?.({ kind: 'decimals', token: call.contract_id });
          return reply(chain.call_result, { value: token.decimals_result.encode({ value: 8 }).finish() });
        }
        assert.equal(call.entry_point, 0x27f576ca, 'Unexpected external entry point');
        const transfer = token.transfer_arguments.decode(call.args);
        const amount = BigInt(transfer.value.toString());
        assert.ok(this.balance(call.contract_id, transfer.from) >= amount, 'External token overdraft');
        this.mint(call.contract_id, transfer.from, this.balance(call.contract_id, transfer.from) - amount);
        this.mint(call.contract_id, transfer.to, this.balance(call.contract_id, transfer.to) + amount);
        this.onCall?.({ kind: 'transfer', token: call.contract_id, ...transfer });
        return reply(chain.call_result, { value: token.transfer_result.encode({ value: true }).finish() });
      }
      return vm.invokeSystemCall(id, ret, size, arg, len, retBytes);
    } } };
    const instance = new WebAssembly.Instance(this.contract.module, imports); vm.setInstance(instance);
    try { instance.exports._start(); throw new Error('Contract did not exit'); }
    catch (error) {
      if (error.contractExit && error.code === 0) return this.decode(name + '_result', error.value || new Uint8Array());
      this.db.initDb(snapshot); this.balances = balances;
      throw error;
    }
  }
}

for (const name of Object.keys(contracts)) test(name + ': every mutating ABI entry point rejects nested calls before validation or authorization', () => {
  const h = new Host(name);
  h.db.putObject(h.lockSpace(), Buffer.alloc(0), Buffer.from([0]));
  let authority = 0, calls = 0;
  h.onAuthority = () => authority++; h.onCall = () => calls++;
  for (const [method, entry] of Object.entries(h.contract.abi.methods)) {
    if (!(entry.readOnly ?? entry.read_only)) assert.throws(() => h.invoke(method), /reentrant mutation/, method);
  }
  assert.equal(authority, 0); assert.equal(calls, 0);
});

function market() {
  const h = new Host('orderbook');
  h.mint(base, owner, 100); h.mint(quote, buyer, 100);
  h.invoke('create_market', { base_token: base, quote_token: quote, min_base_amount: '1' });
  h.invoke('place_order', { owner, market_id: 1, side: 1, price: '100000000', quantity: '100' });
  return h;
}
test('orderbook: token and authority callbacks cannot fill or cancel the same maker twice', () => {
  const h = market(); let nested = 0;
  const attempt = () => {
    nested++;
    assert.throws(() => h.invoke('cancel_order', { order_id: '1' }), /reentrant mutation/);
    assert.throws(() => h.invoke('place_order', { owner: buyer, market_id: 1, price: '100000000', quantity: '100' }), /reentrant mutation/);
  };
  h.onAuthority = attempt;
  h.onCall = call => { if (call.kind === 'transfer' && same(call.from, h.id)) attempt(); };
  const result = h.invoke('place_order', { owner: buyer, market_id: 1, price: '100000000', quantity: '100' });
  assert.ok(nested >= 3); assert.equal(result.filled_quantity, '100');
  assert.equal(h.balance(base, buyer), 100n); assert.equal(h.balance(quote, owner), 100n);
  assert.equal(h.balance(base, h.id), 0n); assert.equal(h.balance(quote, h.id), 0n);
  assert.equal(h.invoke('get_order', { order_id: '1' }).value, null);
  assert.equal(h.db.getObject(h.lockSpace(), Buffer.alloc(0)), null);
});

test('orderbook: a failed callback rolls back balances, maker state, and lock; a later transaction succeeds', () => {
  const h = market();
  h.onCall = call => { if (call.kind === 'transfer' && same(call.from, h.id)) throw new Error('token failed'); };
  const buy = { owner: buyer, market_id: 1, price: '100000000', quantity: '100' };
  assert.throws(() => h.invoke('place_order', buy), /token failed/);
  assert.equal(h.balance(quote, buyer), 100n); assert.equal(h.balance(base, h.id), 100n);
  assert.equal(h.invoke('get_order', { order_id: '1' }).value.remaining, '100');
  assert.equal(h.db.getObject(h.lockSpace(), Buffer.alloc(0)), null);
  h.onCall = null;
  assert.equal(h.invoke('place_order', buy).filled_quantity, '100');
});

test('orderbook: existing owner authorization remains mandatory and failure does not strand the lock', () => {
  const h = market(); h.authorized = false;
  assert.throws(() => h.invoke('cancel_order', { order_id: '1' }));
  assert.equal(h.invoke('get_order', { order_id: '1' }).value.remaining, '100');
  h.authorized = true;
  h.invoke('cancel_order', { order_id: '1' });
  assert.equal(h.balance(base, owner), 100n);
});

const koin = Buffer.from(fromContract('@koinos/mock-vm/src/util').decodeBase58('19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK'));
function launch() {
  const h = new Host('launchpad');
  h.mint(base, owner, 200); h.mint(koin, buyer, 100);
  h.invoke('create_launch', { creator: owner, token: base, price: '100000000', for_sale_amount: '200', start_time: '1', end_time: '2000' });
  h.invoke('contribute', { launch_id: 1, buyer, amount: '100' });
  h.now = 2001;
  // Other launches' KOIN is pooled here; repeated payout must not reach it.
  h.mint(koin, h.id, 1000);
  return h;
}
test('launchpad: unsold-token callback cannot finalize again or process payouts inside settlement', () => {
  const h = launch(); let nested = 0;
  h.onCall = call => {
    if (call.kind === 'transfer' && same(call.token, base) && same(call.from, h.id)) {
      nested++;
      for (const method of ['finalize', 'process', 'cancel_launch']) {
        assert.throws(() => h.invoke(method, { launch_id: 1 }), /reentrant mutation/);
      }
    }
  };
  assert.equal(h.invoke('finalize', { launch_id: 1 }).status, 1);
  assert.equal(nested, 1); assert.equal(h.balance(koin, owner), 100n);
  assert.equal(h.balance(koin, h.id), 900n); assert.equal(h.balance(base, owner), 100n);
  assert.throws(() => h.invoke('finalize', { launch_id: 1 }), /already finalized/);
  h.onCall = null;
  h.invoke('process', { launch_id: 1 });
  assert.equal(h.balance(base, buyer), 100n);
  assert.equal(h.invoke('get_launch', { launch_id: 1 }).value.status, 2);
});

test('launchpad: failed token return restores ACTIVE state and creator payout, then allows a retry', () => {
  const h = launch();
  h.onCall = call => { if (call.kind === 'transfer' && same(call.token, base)) throw new Error('token failed'); };
  assert.throws(() => h.invoke('finalize', { launch_id: 1 }), /token failed/);
  assert.equal(h.invoke('get_launch', { launch_id: 1 }).value.status, 0);
  assert.equal(h.balance(koin, owner), 0n); assert.equal(h.balance(koin, h.id), 1000n);
  assert.equal(h.db.getObject(h.lockSpace(), Buffer.alloc(0)), null);
  h.onCall = null; h.invoke('finalize', { launch_id: 1 });
  assert.equal(h.balance(koin, owner), 100n);
});
