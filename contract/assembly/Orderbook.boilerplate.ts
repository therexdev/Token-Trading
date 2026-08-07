import { System, Protobuf, authority } from "@koinos/sdk-as";
import { orderbook } from "./proto/orderbook";

export class Orderbook {
  create_market(
    args: orderbook.create_market_arguments
  ): orderbook.create_market_result {
    // const base_token = args.base_token;
    // const quote_token = args.quote_token;
    // const min_base_amount = args.min_base_amount;

    // YOUR CODE HERE

    const res = new orderbook.create_market_result();
    // res.market_id = ;

    return res;
  }

  place_order(
    args: orderbook.place_order_arguments
  ): orderbook.place_order_result {
    // const owner = args.owner;
    // const market_id = args.market_id;
    // const side = args.side;
    // const price = args.price;
    // const quantity = args.quantity;
    // const flags = args.flags;

    // YOUR CODE HERE

    const res = new orderbook.place_order_result();
    // res.order_id = ;
    // res.filled_quantity = ;
    // res.filled_quote = ;
    // res.remaining = ;

    return res;
  }

  cancel_order(
    args: orderbook.cancel_order_arguments
  ): orderbook.cancel_order_result {
    // const order_id = args.order_id;

    // YOUR CODE HERE

    const res = new orderbook.cancel_order_result();

    return res;
  }

  get_markets(
    args: orderbook.get_markets_arguments
  ): orderbook.get_markets_result {
    // YOUR CODE HERE

    const res = new orderbook.get_markets_result();
    // res.markets = ;

    return res;
  }

  get_orderbook(
    args: orderbook.get_orderbook_arguments
  ): orderbook.get_orderbook_result {
    // const market_id = args.market_id;
    // const limit = args.limit;

    // YOUR CODE HERE

    const res = new orderbook.get_orderbook_result();
    // res.bids = ;
    // res.asks = ;

    return res;
  }

  get_order(args: orderbook.get_order_arguments): orderbook.get_order_result {
    // const order_id = args.order_id;

    // YOUR CODE HERE

    const res = new orderbook.get_order_result();
    // res.value = ;

    return res;
  }

  get_user_orders(
    args: orderbook.get_user_orders_arguments
  ): orderbook.get_user_orders_result {
    // const owner = args.owner;
    // const start = args.start;
    // const limit = args.limit;

    // YOUR CODE HERE

    const res = new orderbook.get_user_orders_result();
    // res.orders = ;

    return res;
  }

  get_trades(
    args: orderbook.get_trades_arguments
  ): orderbook.get_trades_result {
    // const market_id = args.market_id;
    // const limit = args.limit;

    // YOUR CODE HERE

    const res = new orderbook.get_trades_result();
    // res.trades = ;

    return res;
  }
}
