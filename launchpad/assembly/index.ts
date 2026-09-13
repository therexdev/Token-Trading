import { System, Protobuf, authority } from "@koinos/sdk-as";
import { Launchpad as ContractClass } from "./Launchpad";
import { launchpad as ProtoNamespace } from "./proto/launchpad";

export function main(): i32 {
  const contractArgs = System.getArguments();
  let retbuf = new Uint8Array(1024);

  const c = new ContractClass();

  switch (contractArgs.entry_point) {
    case 0xc6613e29: {
      const args = Protobuf.decode<ProtoNamespace.create_launch_arguments>(
        contractArgs.args,
        ProtoNamespace.create_launch_arguments.decode
      );
      const res = c.create_launch(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.create_launch_result.encode);
      break;
    }

    case 0x8aa73cb6: {
      const args = Protobuf.decode<ProtoNamespace.contribute_arguments>(
        contractArgs.args,
        ProtoNamespace.contribute_arguments.decode
      );
      const res = c.contribute(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.contribute_result.encode);
      break;
    }

    case 0xc298bcd3: {
      const args = Protobuf.decode<ProtoNamespace.finalize_arguments>(
        contractArgs.args,
        ProtoNamespace.finalize_arguments.decode
      );
      const res = c.finalize(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.finalize_result.encode);
      break;
    }

    case 0x19ed40bf: {
      const args = Protobuf.decode<ProtoNamespace.process_arguments>(
        contractArgs.args,
        ProtoNamespace.process_arguments.decode
      );
      const res = c.process(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.process_result.encode);
      break;
    }

    case 0xd6595230: {
      const args = Protobuf.decode<ProtoNamespace.claim_locked_arguments>(
        contractArgs.args,
        ProtoNamespace.claim_locked_arguments.decode
      );
      const res = c.claim_locked(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.claim_locked_result.encode);
      break;
    }

    case 0xfcf5e0ce: {
      const args = Protobuf.decode<ProtoNamespace.cancel_launch_arguments>(
        contractArgs.args,
        ProtoNamespace.cancel_launch_arguments.decode
      );
      const res = c.cancel_launch(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.cancel_launch_result.encode);
      break;
    }

    case 0x27a28ddf: {
      const args = Protobuf.decode<ProtoNamespace.provide_liquidity_arguments>(
        contractArgs.args,
        ProtoNamespace.provide_liquidity_arguments.decode
      );
      const res = c.provide_liquidity(args);
      retbuf = Protobuf.encode(
        res,
        ProtoNamespace.provide_liquidity_result.encode
      );
      break;
    }

    case 0x7dbff552: {
      const args = Protobuf.decode<ProtoNamespace.claim_liquidity_arguments>(
        contractArgs.args,
        ProtoNamespace.claim_liquidity_arguments.decode
      );
      const res = c.claim_liquidity(args);
      retbuf = Protobuf.encode(
        res,
        ProtoNamespace.claim_liquidity_result.encode
      );
      break;
    }

    case 0x115ceef0: {
      const args = Protobuf.decode<ProtoNamespace.reclaim_liquidity_arguments>(
        contractArgs.args,
        ProtoNamespace.reclaim_liquidity_arguments.decode
      );
      const res = c.reclaim_liquidity(args);
      retbuf = Protobuf.encode(
        res,
        ProtoNamespace.reclaim_liquidity_result.encode
      );
      break;
    }

    case 0xd3c1d94e: {
      const args = Protobuf.decode<ProtoNamespace.get_launches_arguments>(
        contractArgs.args,
        ProtoNamespace.get_launches_arguments.decode
      );
      const res = c.get_launches(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.get_launches_result.encode);
      break;
    }

    case 0xdac82e4f: {
      const args = Protobuf.decode<ProtoNamespace.get_launch_arguments>(
        contractArgs.args,
        ProtoNamespace.get_launch_arguments.decode
      );
      const res = c.get_launch(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.get_launch_result.encode);
      break;
    }

    case 0x22680fa9: {
      const args = Protobuf.decode<ProtoNamespace.get_contribution_arguments>(
        contractArgs.args,
        ProtoNamespace.get_contribution_arguments.decode
      );
      const res = c.get_contribution(args);
      retbuf = Protobuf.encode(
        res,
        ProtoNamespace.get_contribution_result.encode
      );
      break;
    }

    case 0x753886bd: {
      const args = Protobuf.decode<ProtoNamespace.get_buyers_arguments>(
        contractArgs.args,
        ProtoNamespace.get_buyers_arguments.decode
      );
      const res = c.get_buyers(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.get_buyers_result.encode);
      break;
    }

    default:
      System.exit(1);
      break;
  }

  System.exit(0, retbuf);
  return 0;
}

main();
