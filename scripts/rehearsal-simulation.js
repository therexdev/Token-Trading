// Offline validation of the runner and all cross-contract WASM fixtures.
// This is explicitly a simulated host, NOT a substitute for a Harbinger run.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Signer, utils } from 'koilib';
import { root, digest } from './rehearsal-build.js';
import { HARBINGER, RpcRejection } from './rehearsal-core.js';
const fromContract = createRequire(path.join(root, 'contract/package.json'));
const { MockVM } = fromContract('@koinos/mock-vm');
const { koinos } = fromContract('@koinos/proto-js');
const { chain } = koinos, sid = chain.system_call_id;
const decode = a => utils.decodeBase58(a), encode = a => utils.encodeBase58(a);
export class SimulatedNode {
  constructor(state) {
    this.state = state; this.db = new MockVM(true).db; this.modules = new Map(); this.hashes = new Map();
    this.now = Date.now(); this.height = 10; this.nonce = 0; this.signers = new Set(); this.submits = 0; this.logs = [];
    this.blocks = new Map([[10, { block_id: 'block10', block_height: '10', block: { transactions: [] }, receipt: {} }]]);
  }
  async getChainId() { return HARBINGER; }
  async getAccountRc() { return '10000000000000'; }
  async getNextNonce() { return Buffer.from(chain.value_type.encode({ uint64_value: ++this.nonce }).finish()).toString('base64url'); }
  async getHeadInfo() {
    if (this.state.checks['preserved token and LP locks reject early claims']?.status === 'passed') this.now = Math.max(this.now, this.state.schedule.end + 1);
    return { head_block_time: String(this.now), head_topology: { height: String(this.height), id: 'block' + this.height }, last_irreversible_block: String(this.height) };
  }
  async getBlocks(start, count = 1) { return [...this.blocks.values()].filter(b => Number(b.block_height) >= start && Number(b.block_height) < start + count); }
  async invokeGetContractMetadata(id) { return { value: { hash: Buffer.from('1220' + this.hashes.get(id), 'hex').toString('base64url') } }; }
  async readContract(operation) {
    const before = [...this.db.db];
    try { return { result: Buffer.from(this.invoke(operation)).toString('base64url'), logs: [] }; }
    finally { this.db.initDb(before); }
  }
  async sendTransaction(tx) {
    this.submits++; this.signers = new Set(await Signer.recoverAddresses(tx)); this.logs = [];
    const before = [...this.db.db], modules = new Map(this.modules), hashes = new Map(this.hashes);
    try {
      for (const operation of tx.operations) {
        if (operation.upload_contract) {
          const u = operation.upload_contract; assert.ok(this.signers.has(u.contract_id), 'upload authority');
          const bytes = Buffer.from(u.bytecode, 'base64url'); this.modules.set(u.contract_id, new WebAssembly.Module(bytes)); this.hashes.set(u.contract_id, digest(bytes));
        } else this.invoke(operation.call_contract);
      }
    } catch (error) {
      this.db.initDb(before); this.modules = modules; this.hashes = hashes;
      throw new RpcRejection(JSON.stringify({ message: error.message, logs: this.logs }));
    }
    this.height++; this.now += 1000;
    const receipt = { id: tx.id, reverted: false, logs: [], rc_used: '1' };
    this.blocks.set(this.height, { block_id: 'block' + this.height, block_height: String(this.height), block: { transactions: [tx] }, receipt: { transaction_receipts: [receipt] } });
    return { receipt, transaction: tx };
  }
  invoke(operation, caller = new Uint8Array(), depth = 0) {
    assert.ok(depth < 32, 'simulation call depth');
    const module = this.modules.get(operation.contract_id); assert.ok(module, 'missing contract ' + operation.contract_id);
    const id = decode(operation.contract_id), input = Buffer.from(operation.args, 'base64url');
    const vm = new MockVM(true); vm.db = this.db;
    const instance = new WebAssembly.Instance(module, { env: { invoke_system_call: (number, ret, size, arg, len, retBytes) => {
      const args = Buffer.from(new Uint8Array(vm.memory.buffer, arg, len));
      const reply = (type, value, code = 0) => {
        const data = type.encode(value).finish(); assert.ok(data.length <= size, `reply buffer ${data.length} > ${size}`);
        new Uint8Array(vm.memory.buffer, ret, data.length).set(data); new Uint32Array(vm.memory.buffer, retBytes, 1)[0] = data.length; return code;
      };
      if (number === sid.get_contract_id) return reply(chain.get_contract_id_result, { value: id });
      if (number === sid.get_caller) return reply(chain.get_caller_result, { value: { caller, caller_privilege: 0 } });
      if (number === sid.get_arguments) return reply(chain.get_arguments_result, { value: { entry_point: operation.entry_point, arguments: input } });
      if (number === sid.get_block_field) return reply(chain.get_block_field_result, { value: { uint64_value: String(this.now) } });
      if (number === sid.get_transaction_field) return reply(chain.get_transaction_field_result, { value: { bytes_value: decode(this.state.addresses.payer) } });
      if (number === sid.check_authority) {
        const request = chain.check_authority_arguments.decode(args);
        return reply(chain.check_authority_result, { value: this.signers.has(encode(request.account)) });
      }
      if (number === sid.get_contract_metadata) {
        const request = chain.get_contract_metadata_arguments.decode(args);
        const hash = this.hashes.get(encode(request.contract_id));
        return reply(chain.get_contract_metadata_result, { value: { system: false, hash: hash ? Buffer.from('1220' + hash, 'hex') : new Uint8Array() } });
      }
      if (number === sid.log) { this.logs.push(chain.log_arguments.decode(args).message); new Uint32Array(vm.memory.buffer, retBytes, 1)[0] = 0; return 0; }
      if (number === sid.event) { new Uint32Array(vm.memory.buffer, retBytes, 1)[0] = 0; return 0; }
      if (number === sid.exit) {
        const result = chain.exit_arguments.decode(args);
        throw Object.assign(new Error(result.res?.error?.message || ''), { contractExit: true, code: result.code, value: result.res?.object });
      }
      if (number === sid.call) {
        const request = chain.call_arguments.decode(args);
        try { return reply(chain.call_result, { value: this.invoke({ contract_id: encode(request.contract_id), entry_point: request.entry_point, args: Buffer.from(request.args).toString('base64url') }, id, depth + 1) }); }
        catch (error) { return reply(chain.error_data, { message: error.message }, error.code || 1); }
      }
      return vm.invokeSystemCall(number, ret, size, arg, len, retBytes);
    } } });
    vm.setInstance(instance);
    try { instance.exports._start(); throw new Error('Contract did not exit'); }
    catch (error) { if (error.contractExit && error.code === 0) return error.value || new Uint8Array(); throw error; }
  }
}
