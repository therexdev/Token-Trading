// TEST ONLY. Controlled token/router fixture; never a production asset or DEX.
import { System, Protobuf, authority, chain, system_calls, kcs4, Token, Base58, Arrays } from '@koinos/sdk-as';
import { launchpad } from './proto/launchpad';
const QUOTE = '__REHEARSAL_QUOTE__';
const self = System.getContractId();
const empty = new Uint8Array(0);
function space(id: u32): chain.object_space { return new chain.object_space(false, self, id); }
function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out;
}
function get(id: u32, key: Uint8Array): u64 {
  const r = System.getObject<Uint8Array, kcs4.balance_of_result>(space(id), key, kcs4.balance_of_result.decode);
  return r ? r.value : 0;
}
function put(id: u32, key: Uint8Array, value: u64): void {
  System.putObject(space(id), key, new kcs4.balance_of_result(value), kcs4.balance_of_result.encode);
}
function credit(account: Uint8Array, value: u64): void {
  const old = get(0, account); System.require(old + value >= old, 'fixture overflow'); put(0, account, old + value);
}
function admin(): void { System.requireAuthority(authority.authorization_type.contract_call, self); }
function callback(from: Uint8Array): void {
  const mode = get(2, empty);
  System.require(mode != 1, 'fixture: forced transfer failure');
  if (mode != 2) return;
  const raw = System.getBytes(space(3), empty);
  System.require(raw != null, 'fixture: missing callback');
  const args = Protobuf.decode<system_calls.call_arguments>(raw!, system_calls.call_arguments.decode);
  if (!Arrays.equal(from, args.contract_id!)) return;
  const response = System.call(args.contract_id!, args.entry_point, args.args!);
  if (response.code != 0) System.fail(response.res.error ? response.res.error!.message : 'fixture: callback rejected');
}
export function main(): i32 {
  const call = System.getArguments(); let output = new Uint8Array(0);
  switch (call.entry_point) {
    case 0xee80fd2f:
      output = Protobuf.encode(new kcs4.decimals_result(8), kcs4.decimals_result.encode); break;
    case 0x82a3537f:
      output = Protobuf.encode(new kcs4.name_result('REHEARSAL ONLY'), kcs4.name_result.encode); break;
    case 0xb76a7ca1:
      output = Protobuf.encode(new kcs4.symbol_result('TEST'), kcs4.symbol_result.encode); break;
    case 0x5c721497: {
      const args = Protobuf.decode<kcs4.balance_of_arguments>(call.args, kcs4.balance_of_arguments.decode);
      output = Protobuf.encode(new kcs4.balance_of_result(get(0, args.owner)), kcs4.balance_of_result.encode); break;
    }
    case 0xdc6f17bb: {
      admin(); const args = Protobuf.decode<kcs4.mint_arguments>(call.args, kcs4.mint_arguments.decode);
      credit(args.to, args.value); break;
    }
    case 0x74e21680: {
      const args = Protobuf.decode<kcs4.approve_arguments>(call.args, kcs4.approve_arguments.decode);
      System.requireAuthority(authority.authorization_type.contract_call, args.owner);
      put(1, join(args.owner, args.spender), args.value); break;
    }
    case 0x27f576ca: {
      const args = Protobuf.decode<kcs4.transfer_arguments>(call.args, kcs4.transfer_arguments.decode);
      const caller = System.getCaller().caller;
      if (caller && caller.length > 0 && !Arrays.equal(caller, args.from)) {
        const key = join(args.from, caller); const allowance = get(1, key);
        System.require(allowance >= args.value, 'fixture: insufficient allowance'); put(1, key, allowance - args.value);
      } else System.requireAuthority(authority.authorization_type.contract_call, args.from);
      const balance = get(0, args.from); System.require(balance >= args.value, 'fixture: insufficient balance');
      put(0, args.from, balance - args.value); credit(args.to, args.value);
      callback(args.from); break;
    }
    // These control methods are restricted to the disposable fixture account.
    case 0x10000001: {
      admin(); const args = Protobuf.decode<kcs4.decimals_result>(call.args, kcs4.decimals_result.decode);
      System.require(args.value <= 2, 'fixture: invalid mode'); put(2, empty, args.value); break;
    }
    case 0x10000002:
      admin(); System.putBytes(space(3), empty, call.args); break;
    // Public metadata readback through the normal contract reader, for RPCs
    // that do not expose chain.invoke_system_call.
    case 0x10000003: {
      const args = Protobuf.decode<kcs4.balance_of_arguments>(call.args, kcs4.balance_of_arguments.decode);
      const meta = System.getContractMetadata(args.owner);
      System.require(meta != null, 'fixture: contract metadata missing');
      output = Protobuf.encode(meta!, chain.contract_metadata_object.encode); break;
    }
    case 4024190401:
      output = Protobuf.encode(new launchpad.dex_address(self), launchpad.dex_address.encode); break;
    case 117856717: {
      const args = Protobuf.decode<launchpad.dex_add_liquidity_call>(call.args, launchpad.dex_add_liquidity_call.decode);
      System.require(args.token_a == 'koin' && args.from != null && args.receiver != null, 'fixture: invalid pool request');
      System.require(args.amount_a_desired >= args.amount_a_min && args.amount_b_desired >= args.amount_b_min, 'fixture: minimum');
      System.require(new Token(Base58.decode(QUOTE)).transfer(args.from!, self, args.amount_a_desired), 'fixture: quote pull');
      System.require(args.token_b != null, 'fixture: missing base');
      System.require(new Token(Base58.decode(args.token_b!)).transfer(args.from!, self, args.amount_b_desired), 'fixture: base pull');
      const minted: u64 = 100000000;
      credit(args.receiver!, minted);
      const res = new launchpad.dex_add_liquidity_answer(); res.liquidity = minted;
      output = Protobuf.encode(res, launchpad.dex_add_liquidity_answer.encode); break;
    }
    default: System.fail('fixture: unknown method');
  }
  System.exit(0, output); return 0;
}
main();
