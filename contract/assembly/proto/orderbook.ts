import { Writer, Reader } from "as-proto";

export namespace orderbook {
  export class market_config {
    static encode(message: market_config, writer: Writer): void {
      if (message.market_id != 0) {
        writer.uint32(8);
        writer.uint32(message.market_id);
      }

      const unique_name_base_token = message.base_token;
      if (unique_name_base_token !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_base_token);
      }

      const unique_name_quote_token = message.quote_token;
      if (unique_name_quote_token !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_quote_token);
      }

      if (message.min_base_amount != 0) {
        writer.uint32(32);
        writer.uint64(message.min_base_amount);
      }

      if (message.last_price != 0) {
        writer.uint32(40);
        writer.uint64(message.last_price);
      }

      if (message.trade_head != 0) {
        writer.uint32(48);
        writer.uint32(message.trade_head);
      }

      if (message.trade_count != 0) {
        writer.uint32(56);
        writer.uint64(message.trade_count);
      }

      if (message.base_volume != 0) {
        writer.uint32(64);
        writer.uint64(message.base_volume);
      }

      if (message.quote_volume != 0) {
        writer.uint32(72);
        writer.uint64(message.quote_volume);
      }
    }

    static decode(reader: Reader, length: i32): market_config {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new market_config();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.market_id = reader.uint32();
            break;

          case 2:
            message.base_token = reader.bytes();
            break;

          case 3:
            message.quote_token = reader.bytes();
            break;

          case 4:
            message.min_base_amount = reader.uint64();
            break;

          case 5:
            message.last_price = reader.uint64();
            break;

          case 6:
            message.trade_head = reader.uint32();
            break;

          case 7:
            message.trade_count = reader.uint64();
            break;

          case 8:
            message.base_volume = reader.uint64();
            break;

          case 9:
            message.quote_volume = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    market_id: u32;
    base_token: Uint8Array | null;
    quote_token: Uint8Array | null;
    min_base_amount: u64;
    last_price: u64;
    trade_head: u32;
    trade_count: u64;
    base_volume: u64;
    quote_volume: u64;

    constructor(
      market_id: u32 = 0,
      base_token: Uint8Array | null = null,
      quote_token: Uint8Array | null = null,
      min_base_amount: u64 = 0,
      last_price: u64 = 0,
      trade_head: u32 = 0,
      trade_count: u64 = 0,
      base_volume: u64 = 0,
      quote_volume: u64 = 0
    ) {
      this.market_id = market_id;
      this.base_token = base_token;
      this.quote_token = quote_token;
      this.min_base_amount = min_base_amount;
      this.last_price = last_price;
      this.trade_head = trade_head;
      this.trade_count = trade_count;
      this.base_volume = base_volume;
      this.quote_volume = quote_volume;
    }
  }

  export class order_object {
    static encode(message: order_object, writer: Writer): void {
      if (message.id != 0) {
        writer.uint32(8);
        writer.uint64(message.id);
      }

      if (message.market_id != 0) {
        writer.uint32(16);
        writer.uint32(message.market_id);
      }

      if (message.side != 0) {
        writer.uint32(24);
        writer.uint32(message.side);
      }

      if (message.price != 0) {
        writer.uint32(32);
        writer.uint64(message.price);
      }

      if (message.quantity != 0) {
        writer.uint32(40);
        writer.uint64(message.quantity);
      }

      if (message.remaining != 0) {
        writer.uint32(48);
        writer.uint64(message.remaining);
      }

      if (message.escrow != 0) {
        writer.uint32(56);
        writer.uint64(message.escrow);
      }

      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(66);
        writer.bytes(unique_name_owner);
      }

      if (message.timestamp != 0) {
        writer.uint32(72);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): order_object {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new order_object();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.uint64();
            break;

          case 2:
            message.market_id = reader.uint32();
            break;

          case 3:
            message.side = reader.uint32();
            break;

          case 4:
            message.price = reader.uint64();
            break;

          case 5:
            message.quantity = reader.uint64();
            break;

          case 6:
            message.remaining = reader.uint64();
            break;

          case 7:
            message.escrow = reader.uint64();
            break;

          case 8:
            message.owner = reader.bytes();
            break;

          case 9:
            message.timestamp = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: u64;
    market_id: u32;
    side: u32;
    price: u64;
    quantity: u64;
    remaining: u64;
    escrow: u64;
    owner: Uint8Array | null;
    timestamp: u64;

    constructor(
      id: u64 = 0,
      market_id: u32 = 0,
      side: u32 = 0,
      price: u64 = 0,
      quantity: u64 = 0,
      remaining: u64 = 0,
      escrow: u64 = 0,
      owner: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.id = id;
      this.market_id = market_id;
      this.side = side;
      this.price = price;
      this.quantity = quantity;
      this.remaining = remaining;
      this.escrow = escrow;
      this.owner = owner;
      this.timestamp = timestamp;
    }
  }

  export class trade_object {
    static encode(message: trade_object, writer: Writer): void {
      if (message.seq != 0) {
        writer.uint32(8);
        writer.uint64(message.seq);
      }

      if (message.market_id != 0) {
        writer.uint32(16);
        writer.uint32(message.market_id);
      }

      if (message.price != 0) {
        writer.uint32(24);
        writer.uint64(message.price);
      }

      if (message.quantity != 0) {
        writer.uint32(32);
        writer.uint64(message.quantity);
      }

      if (message.quote_amount != 0) {
        writer.uint32(40);
        writer.uint64(message.quote_amount);
      }

      if (message.taker_side != 0) {
        writer.uint32(48);
        writer.uint32(message.taker_side);
      }

      if (message.timestamp != 0) {
        writer.uint32(56);
        writer.uint64(message.timestamp);
      }

      const unique_name_maker = message.maker;
      if (unique_name_maker !== null) {
        writer.uint32(66);
        writer.bytes(unique_name_maker);
      }

      const unique_name_taker = message.taker;
      if (unique_name_taker !== null) {
        writer.uint32(74);
        writer.bytes(unique_name_taker);
      }

      if (message.maker_order_id != 0) {
        writer.uint32(80);
        writer.uint64(message.maker_order_id);
      }
    }

    static decode(reader: Reader, length: i32): trade_object {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new trade_object();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.seq = reader.uint64();
            break;

          case 2:
            message.market_id = reader.uint32();
            break;

          case 3:
            message.price = reader.uint64();
            break;

          case 4:
            message.quantity = reader.uint64();
            break;

          case 5:
            message.quote_amount = reader.uint64();
            break;

          case 6:
            message.taker_side = reader.uint32();
            break;

          case 7:
            message.timestamp = reader.uint64();
            break;

          case 8:
            message.maker = reader.bytes();
            break;

          case 9:
            message.taker = reader.bytes();
            break;

          case 10:
            message.maker_order_id = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    seq: u64;
    market_id: u32;
    price: u64;
    quantity: u64;
    quote_amount: u64;
    taker_side: u32;
    timestamp: u64;
    maker: Uint8Array | null;
    taker: Uint8Array | null;
    maker_order_id: u64;

    constructor(
      seq: u64 = 0,
      market_id: u32 = 0,
      price: u64 = 0,
      quantity: u64 = 0,
      quote_amount: u64 = 0,
      taker_side: u32 = 0,
      timestamp: u64 = 0,
      maker: Uint8Array | null = null,
      taker: Uint8Array | null = null,
      maker_order_id: u64 = 0
    ) {
      this.seq = seq;
      this.market_id = market_id;
      this.price = price;
      this.quantity = quantity;
      this.quote_amount = quote_amount;
      this.taker_side = taker_side;
      this.timestamp = timestamp;
      this.maker = maker;
      this.taker = taker;
      this.maker_order_id = maker_order_id;
    }
  }

  @unmanaged
  export class global_state {
    static encode(message: global_state, writer: Writer): void {
      if (message.next_order_id != 0) {
        writer.uint32(8);
        writer.uint64(message.next_order_id);
      }

      if (message.next_trade_seq != 0) {
        writer.uint32(16);
        writer.uint64(message.next_trade_seq);
      }

      if (message.next_market_id != 0) {
        writer.uint32(24);
        writer.uint32(message.next_market_id);
      }
    }

    static decode(reader: Reader, length: i32): global_state {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new global_state();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.next_order_id = reader.uint64();
            break;

          case 2:
            message.next_trade_seq = reader.uint64();
            break;

          case 3:
            message.next_market_id = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    next_order_id: u64;
    next_trade_seq: u64;
    next_market_id: u32;

    constructor(
      next_order_id: u64 = 0,
      next_trade_seq: u64 = 0,
      next_market_id: u32 = 0
    ) {
      this.next_order_id = next_order_id;
      this.next_trade_seq = next_trade_seq;
      this.next_market_id = next_market_id;
    }
  }

  export class create_market_arguments {
    static encode(message: create_market_arguments, writer: Writer): void {
      const unique_name_base_token = message.base_token;
      if (unique_name_base_token !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_base_token);
      }

      const unique_name_quote_token = message.quote_token;
      if (unique_name_quote_token !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_quote_token);
      }

      if (message.min_base_amount != 0) {
        writer.uint32(24);
        writer.uint64(message.min_base_amount);
      }
    }

    static decode(reader: Reader, length: i32): create_market_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new create_market_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.base_token = reader.bytes();
            break;

          case 2:
            message.quote_token = reader.bytes();
            break;

          case 3:
            message.min_base_amount = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    base_token: Uint8Array | null;
    quote_token: Uint8Array | null;
    min_base_amount: u64;

    constructor(
      base_token: Uint8Array | null = null,
      quote_token: Uint8Array | null = null,
      min_base_amount: u64 = 0
    ) {
      this.base_token = base_token;
      this.quote_token = quote_token;
      this.min_base_amount = min_base_amount;
    }
  }

  @unmanaged
  export class create_market_result {
    static encode(message: create_market_result, writer: Writer): void {
      if (message.market_id != 0) {
        writer.uint32(8);
        writer.uint32(message.market_id);
      }
    }

    static decode(reader: Reader, length: i32): create_market_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new create_market_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.market_id = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    market_id: u32;

    constructor(market_id: u32 = 0) {
      this.market_id = market_id;
    }
  }

  @unmanaged
  export class set_min_base_amount_arguments {
    static encode(
      message: set_min_base_amount_arguments,
      writer: Writer
    ): void {
      if (message.market_id != 0) {
        writer.uint32(8);
        writer.uint32(message.market_id);
      }

      if (message.min_base_amount != 0) {
        writer.uint32(16);
        writer.uint64(message.min_base_amount);
      }
    }

    static decode(reader: Reader, length: i32): set_min_base_amount_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_min_base_amount_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.market_id = reader.uint32();
            break;

          case 2:
            message.min_base_amount = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    market_id: u32;
    min_base_amount: u64;

    constructor(market_id: u32 = 0, min_base_amount: u64 = 0) {
      this.market_id = market_id;
      this.min_base_amount = min_base_amount;
    }
  }

  @unmanaged
  export class set_min_base_amount_result {
    static encode(message: set_min_base_amount_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_min_base_amount_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_min_base_amount_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  export class place_order_arguments {
    static encode(message: place_order_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      if (message.market_id != 0) {
        writer.uint32(16);
        writer.uint32(message.market_id);
      }

      if (message.side != 0) {
        writer.uint32(24);
        writer.uint32(message.side);
      }

      if (message.price != 0) {
        writer.uint32(32);
        writer.uint64(message.price);
      }

      if (message.quantity != 0) {
        writer.uint32(40);
        writer.uint64(message.quantity);
      }

      if (message.flags != 0) {
        writer.uint32(48);
        writer.uint32(message.flags);
      }
    }

    static decode(reader: Reader, length: i32): place_order_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new place_order_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.market_id = reader.uint32();
            break;

          case 3:
            message.side = reader.uint32();
            break;

          case 4:
            message.price = reader.uint64();
            break;

          case 5:
            message.quantity = reader.uint64();
            break;

          case 6:
            message.flags = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    market_id: u32;
    side: u32;
    price: u64;
    quantity: u64;
    flags: u32;

    constructor(
      owner: Uint8Array | null = null,
      market_id: u32 = 0,
      side: u32 = 0,
      price: u64 = 0,
      quantity: u64 = 0,
      flags: u32 = 0
    ) {
      this.owner = owner;
      this.market_id = market_id;
      this.side = side;
      this.price = price;
      this.quantity = quantity;
      this.flags = flags;
    }
  }

  @unmanaged
  export class place_order_result {
    static encode(message: place_order_result, writer: Writer): void {
      if (message.order_id != 0) {
        writer.uint32(8);
        writer.uint64(message.order_id);
      }

      if (message.filled_quantity != 0) {
        writer.uint32(16);
        writer.uint64(message.filled_quantity);
      }

      if (message.filled_quote != 0) {
        writer.uint32(24);
        writer.uint64(message.filled_quote);
      }

      if (message.remaining != 0) {
        writer.uint32(32);
        writer.uint64(message.remaining);
      }
    }

    static decode(reader: Reader, length: i32): place_order_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new place_order_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.order_id = reader.uint64();
            break;

          case 2:
            message.filled_quantity = reader.uint64();
            break;

          case 3:
            message.filled_quote = reader.uint64();
            break;

          case 4:
            message.remaining = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    order_id: u64;
    filled_quantity: u64;
    filled_quote: u64;
    remaining: u64;

    constructor(
      order_id: u64 = 0,
      filled_quantity: u64 = 0,
      filled_quote: u64 = 0,
      remaining: u64 = 0
    ) {
      this.order_id = order_id;
      this.filled_quantity = filled_quantity;
      this.filled_quote = filled_quote;
      this.remaining = remaining;
    }
  }

  @unmanaged
  export class cancel_order_arguments {
    static encode(message: cancel_order_arguments, writer: Writer): void {
      if (message.order_id != 0) {
        writer.uint32(8);
        writer.uint64(message.order_id);
      }
    }

    static decode(reader: Reader, length: i32): cancel_order_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_order_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.order_id = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    order_id: u64;

    constructor(order_id: u64 = 0) {
      this.order_id = order_id;
    }
  }

  @unmanaged
  export class cancel_order_result {
    static encode(message: cancel_order_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): cancel_order_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_order_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  @unmanaged
  export class get_markets_arguments {
    static encode(message: get_markets_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): get_markets_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_markets_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  export class get_markets_result {
    static encode(message: get_markets_result, writer: Writer): void {
      const unique_name_markets = message.markets;
      for (let i = 0; i < unique_name_markets.length; ++i) {
        writer.uint32(10);
        writer.fork();
        market_config.encode(unique_name_markets[i], writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_markets_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_markets_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.markets.push(market_config.decode(reader, reader.uint32()));
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    markets: Array<market_config>;

    constructor(markets: Array<market_config> = []) {
      this.markets = markets;
    }
  }

  @unmanaged
  export class get_orderbook_arguments {
    static encode(message: get_orderbook_arguments, writer: Writer): void {
      if (message.market_id != 0) {
        writer.uint32(8);
        writer.uint32(message.market_id);
      }

      if (message.limit != 0) {
        writer.uint32(16);
        writer.uint32(message.limit);
      }
    }

    static decode(reader: Reader, length: i32): get_orderbook_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_orderbook_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.market_id = reader.uint32();
            break;

          case 2:
            message.limit = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    market_id: u32;
    limit: u32;

    constructor(market_id: u32 = 0, limit: u32 = 0) {
      this.market_id = market_id;
      this.limit = limit;
    }
  }

  export class get_orderbook_result {
    static encode(message: get_orderbook_result, writer: Writer): void {
      const unique_name_bids = message.bids;
      for (let i = 0; i < unique_name_bids.length; ++i) {
        writer.uint32(10);
        writer.fork();
        order_object.encode(unique_name_bids[i], writer);
        writer.ldelim();
      }

      const unique_name_asks = message.asks;
      for (let i = 0; i < unique_name_asks.length; ++i) {
        writer.uint32(18);
        writer.fork();
        order_object.encode(unique_name_asks[i], writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_orderbook_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_orderbook_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.bids.push(order_object.decode(reader, reader.uint32()));
            break;

          case 2:
            message.asks.push(order_object.decode(reader, reader.uint32()));
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    bids: Array<order_object>;
    asks: Array<order_object>;

    constructor(
      bids: Array<order_object> = [],
      asks: Array<order_object> = []
    ) {
      this.bids = bids;
      this.asks = asks;
    }
  }

  @unmanaged
  export class get_order_arguments {
    static encode(message: get_order_arguments, writer: Writer): void {
      if (message.order_id != 0) {
        writer.uint32(8);
        writer.uint64(message.order_id);
      }
    }

    static decode(reader: Reader, length: i32): get_order_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_order_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.order_id = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    order_id: u64;

    constructor(order_id: u64 = 0) {
      this.order_id = order_id;
    }
  }

  export class get_order_result {
    static encode(message: get_order_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        order_object.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_order_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_order_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = order_object.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: order_object | null;

    constructor(value: order_object | null = null) {
      this.value = value;
    }
  }

  export class get_user_orders_arguments {
    static encode(message: get_user_orders_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      if (message.start != 0) {
        writer.uint32(16);
        writer.uint64(message.start);
      }

      if (message.limit != 0) {
        writer.uint32(24);
        writer.uint32(message.limit);
      }
    }

    static decode(reader: Reader, length: i32): get_user_orders_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_user_orders_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.start = reader.uint64();
            break;

          case 3:
            message.limit = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    start: u64;
    limit: u32;

    constructor(
      owner: Uint8Array | null = null,
      start: u64 = 0,
      limit: u32 = 0
    ) {
      this.owner = owner;
      this.start = start;
      this.limit = limit;
    }
  }

  export class get_user_orders_result {
    static encode(message: get_user_orders_result, writer: Writer): void {
      const unique_name_orders = message.orders;
      for (let i = 0; i < unique_name_orders.length; ++i) {
        writer.uint32(10);
        writer.fork();
        order_object.encode(unique_name_orders[i], writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_user_orders_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_user_orders_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.orders.push(order_object.decode(reader, reader.uint32()));
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    orders: Array<order_object>;

    constructor(orders: Array<order_object> = []) {
      this.orders = orders;
    }
  }

  @unmanaged
  export class get_trades_arguments {
    static encode(message: get_trades_arguments, writer: Writer): void {
      if (message.market_id != 0) {
        writer.uint32(8);
        writer.uint32(message.market_id);
      }

      if (message.limit != 0) {
        writer.uint32(16);
        writer.uint32(message.limit);
      }
    }

    static decode(reader: Reader, length: i32): get_trades_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_trades_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.market_id = reader.uint32();
            break;

          case 2:
            message.limit = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    market_id: u32;
    limit: u32;

    constructor(market_id: u32 = 0, limit: u32 = 0) {
      this.market_id = market_id;
      this.limit = limit;
    }
  }

  export class get_trades_result {
    static encode(message: get_trades_result, writer: Writer): void {
      const unique_name_trades = message.trades;
      for (let i = 0; i < unique_name_trades.length; ++i) {
        writer.uint32(10);
        writer.fork();
        trade_object.encode(unique_name_trades[i], writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_trades_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_trades_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.trades.push(trade_object.decode(reader, reader.uint32()));
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    trades: Array<trade_object>;

    constructor(trades: Array<trade_object> = []) {
      this.trades = trades;
    }
  }

  export class market_created_event {
    static encode(message: market_created_event, writer: Writer): void {
      const unique_name_market = message.market;
      if (unique_name_market !== null) {
        writer.uint32(10);
        writer.fork();
        market_config.encode(unique_name_market, writer);
        writer.ldelim();
      }

      const unique_name_creator = message.creator;
      if (unique_name_creator !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_creator);
      }
    }

    static decode(reader: Reader, length: i32): market_created_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new market_created_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.market = market_config.decode(reader, reader.uint32());
            break;

          case 2:
            message.creator = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    market: market_config | null;
    creator: Uint8Array | null;

    constructor(
      market: market_config | null = null,
      creator: Uint8Array | null = null
    ) {
      this.market = market;
      this.creator = creator;
    }
  }

  export class order_placed_event {
    static encode(message: order_placed_event, writer: Writer): void {
      const unique_name_order = message.order;
      if (unique_name_order !== null) {
        writer.uint32(10);
        writer.fork();
        order_object.encode(unique_name_order, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): order_placed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new order_placed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.order = order_object.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    order: order_object | null;

    constructor(order: order_object | null = null) {
      this.order = order;
    }
  }

  export class order_cancelled_event {
    static encode(message: order_cancelled_event, writer: Writer): void {
      if (message.order_id != 0) {
        writer.uint32(8);
        writer.uint64(message.order_id);
      }

      if (message.market_id != 0) {
        writer.uint32(16);
        writer.uint32(message.market_id);
      }

      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_owner);
      }
    }

    static decode(reader: Reader, length: i32): order_cancelled_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new order_cancelled_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.order_id = reader.uint64();
            break;

          case 2:
            message.market_id = reader.uint32();
            break;

          case 3:
            message.owner = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    order_id: u64;
    market_id: u32;
    owner: Uint8Array | null;

    constructor(
      order_id: u64 = 0,
      market_id: u32 = 0,
      owner: Uint8Array | null = null
    ) {
      this.order_id = order_id;
      this.market_id = market_id;
      this.owner = owner;
    }
  }

  export class trade_event {
    static encode(message: trade_event, writer: Writer): void {
      const unique_name_trade = message.trade;
      if (unique_name_trade !== null) {
        writer.uint32(10);
        writer.fork();
        trade_object.encode(unique_name_trade, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): trade_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new trade_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.trade = trade_object.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    trade: trade_object | null;

    constructor(trade: trade_object | null = null) {
      this.trade = trade;
    }
  }
}
