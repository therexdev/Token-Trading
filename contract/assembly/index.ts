import { System, Protobuf, authority } from "@koinos/sdk-as";
import { Orderbook as ContractClass } from "./Orderbook";
import { orderbook as ProtoNamespace } from "./proto/orderbook";

export function main(): i32 {
  const contractArgs = System.getArguments();
  let retbuf = new Uint8Array(1024);

  const c = new ContractClass();

  switch (contractArgs.entry_point) {
    case 0x30231247: {
      const args = Protobuf.decode<ProtoNamespace.create_market_arguments>(
        contractArgs.args,
        ProtoNamespace.create_market_arguments.decode
      );
      const res = c.create_market(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.create_market_result.encode);
      break;
    }

    case 0x163b60a5: {
      const args = Protobuf.decode<ProtoNamespace.place_order_arguments>(
        contractArgs.args,
        ProtoNamespace.place_order_arguments.decode
      );
      const res = c.place_order(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.place_order_result.encode);
      break;
    }

    case 0x8442359c: {
      const args = Protobuf.decode<ProtoNamespace.cancel_order_arguments>(
        contractArgs.args,
        ProtoNamespace.cancel_order_arguments.decode
      );
      const res = c.cancel_order(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.cancel_order_result.encode);
      break;
    }

    case 0xaf7aee93: {
      const args = Protobuf.decode<ProtoNamespace.get_markets_arguments>(
        contractArgs.args,
        ProtoNamespace.get_markets_arguments.decode
      );
      const res = c.get_markets(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.get_markets_result.encode);
      break;
    }

    case 0x453f3fab: {
      const args = Protobuf.decode<ProtoNamespace.get_orderbook_arguments>(
        contractArgs.args,
        ProtoNamespace.get_orderbook_arguments.decode
      );
      const res = c.get_orderbook(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.get_orderbook_result.encode);
      break;
    }

    case 0x45915cb9: {
      const args = Protobuf.decode<ProtoNamespace.get_order_arguments>(
        contractArgs.args,
        ProtoNamespace.get_order_arguments.decode
      );
      const res = c.get_order(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.get_order_result.encode);
      break;
    }

    case 0x4b436b62: {
      const args = Protobuf.decode<ProtoNamespace.get_user_orders_arguments>(
        contractArgs.args,
        ProtoNamespace.get_user_orders_arguments.decode
      );
      const res = c.get_user_orders(args);
      retbuf = Protobuf.encode(
        res,
        ProtoNamespace.get_user_orders_result.encode
      );
      break;
    }

    case 0xb43d6baf: {
      const args = Protobuf.decode<ProtoNamespace.get_trades_arguments>(
        contractArgs.args,
        ProtoNamespace.get_trades_arguments.decode
      );
      const res = c.get_trades(args);
      retbuf = Protobuf.encode(res, ProtoNamespace.get_trades_result.encode);
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
