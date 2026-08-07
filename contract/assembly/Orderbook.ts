import {
  System,
  Protobuf,
  authority,
  chain,
  Token,
  u128,
} from "@koinos/sdk-as";
import { orderbook } from "./proto/orderbook";

// Order sides
const SIDE_BUY: u32 = 0;
const SIDE_SELL: u32 = 1;

// Order flags
const FLAG_GTC: u32 = 0;
const FLAG_IOC: u32 = 1;
const FLAG_POST_ONLY: u32 = 2;

// Prices are expressed in quote token units per 1e8 base token units
const PRICE_SCALE: u64 = 100000000;

// Bound the amount of work a single order placement can do
const MAX_FILLS_PER_TX: u32 = 20;

// Per-market trade history ring buffer capacity
const TRADE_RING_CAP: u32 = 2000;

// Read limits
const DEFAULT_BOOK_LIMIT: u32 = 50;
const MAX_BOOK_LIMIT: u32 = 200;
const DEFAULT_TRADES_LIMIT: u32 = 100;
const MAX_TRADES_LIMIT: u32 = 500;
const DEFAULT_USER_ORDERS_LIMIT: u32 = 50;
const MAX_USER_ORDERS_LIMIT: u32 = 200;

// Storage space ids
const SPACE_GLOBAL: u32 = 0;
const SPACE_MARKETS: u32 = 1;
const SPACE_ORDERS: u32 = 2;
const SPACE_BOOK: u32 = 3;
const SPACE_USER_ORDERS: u32 = 4;
const SPACE_TRADES: u32 = 5;

const GLOBAL_KEY: Uint8Array = new Uint8Array(0);

function u32ToBytesBE(value: u32): Uint8Array {
  const buffer = new Uint8Array(4);
  buffer[0] = u8((value >> 24) & 0xff);
  buffer[1] = u8((value >> 16) & 0xff);
  buffer[2] = u8((value >> 8) & 0xff);
  buffer[3] = u8(value & 0xff);
  return buffer;
}

function u64ToBytesBE(value: u64): Uint8Array {
  const buffer = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    buffer[7 - i] = u8((value >> (8 * i)) & 0xff);
  }
  return buffer;
}

function bytesToU64BE(buffer: Uint8Array, offset: i32): u64 {
  let value: u64 = 0;
  for (let i = 0; i < 8; i++) {
    value = (value << 8) | u64(buffer[offset + i]);
  }
  return value;
}

function concat2(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function startsWith(data: Uint8Array, prefix: Uint8Array): bool {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (data[i] != prefix[i]) return false;
  }
  return true;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): bool {
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

/**
 * floor(a * b / den) with 128-bit intermediate math
 */
function mulDivFloor(a: u64, b: u64, den: u64): u64 {
  const product = u128.fromU64(a) * u128.fromU64(b);
  const quotient = product / u128.fromU64(den);
  System.require(quotient.hi == 0, "orderbook: amount overflow");
  return quotient.lo;
}

/**
 * ceil(a * b / den) with 128-bit intermediate math
 */
function mulDivCeil(a: u64, b: u64, den: u64): u64 {
  const product =
    u128.fromU64(a) * u128.fromU64(b) + u128.fromU64(den - 1);
  const quotient = product / u128.fromU64(den);
  System.require(quotient.hi == 0, "orderbook: amount overflow");
  return quotient.lo;
}

/**
 * Book keys sort ascending, so the best order of a side must have the
 * smallest key: asks are keyed by price, bids by (u64.MAX - price).
 */
function sortablePrice(side: u32, price: u64): u64 {
  return side == SIDE_BUY ? u64.MAX_VALUE - price : price;
}

function priceCrosses(takerSide: u32, takerPrice: u64, makerPrice: u64): bool {
  return takerSide == SIDE_BUY
    ? takerPrice >= makerPrice
    : takerPrice <= makerPrice;
}

export class Orderbook {
  contractId: Uint8Array = System.getContractId();

  private space(id: u32): chain.object_space {
    return new chain.object_space(false, this.contractId, id);
  }

  // -------------------------------------------------------------------------
  // State helpers
  // -------------------------------------------------------------------------

  private getGlobalState(): orderbook.global_state {
    const state = System.getObject<Uint8Array, orderbook.global_state>(
      this.space(SPACE_GLOBAL),
      GLOBAL_KEY,
      orderbook.global_state.decode
    );
    if (state) return state;

    const fresh = new orderbook.global_state();
    fresh.next_order_id = 1;
    fresh.next_trade_seq = 1;
    fresh.next_market_id = 1;
    return fresh;
  }

  private saveGlobalState(state: orderbook.global_state): void {
    System.putObject(
      this.space(SPACE_GLOBAL),
      GLOBAL_KEY,
      state,
      orderbook.global_state.encode
    );
  }

  private getMarket(marketId: u32): orderbook.market_config | null {
    return System.getObject<Uint8Array, orderbook.market_config>(
      this.space(SPACE_MARKETS),
      u32ToBytesBE(marketId),
      orderbook.market_config.decode
    );
  }

  private saveMarket(market: orderbook.market_config): void {
    System.putObject(
      this.space(SPACE_MARKETS),
      u32ToBytesBE(market.market_id),
      market,
      orderbook.market_config.encode
    );
  }

  private getOrderById(orderId: u64): orderbook.order_object | null {
    return System.getObject<Uint8Array, orderbook.order_object>(
      this.space(SPACE_ORDERS),
      u64ToBytesBE(orderId),
      orderbook.order_object.decode
    );
  }

  private bookPrefix(marketId: u32, side: u32): Uint8Array {
    const prefix = new Uint8Array(5);
    prefix.set(u32ToBytesBE(marketId), 0);
    prefix[4] = u8(side & 0xff);
    return prefix;
  }

  private bookKey(order: orderbook.order_object): Uint8Array {
    const key = new Uint8Array(21);
    key.set(u32ToBytesBE(order.market_id), 0);
    key[4] = u8(order.side & 0xff);
    key.set(u64ToBytesBE(sortablePrice(order.side, order.price)), 5);
    key.set(u64ToBytesBE(order.id), 13);
    return key;
  }

  private userOrderKey(owner: Uint8Array, orderId: u64): Uint8Array {
    return concat2(owner, u64ToBytesBE(orderId));
  }

  /**
   * Persist an order in all three indexes (orders by id, book, user index)
   */
  private storeOrder(order: orderbook.order_object): void {
    System.putObject(
      this.space(SPACE_ORDERS),
      u64ToBytesBE(order.id),
      order,
      orderbook.order_object.encode
    );
    System.putBytes(
      this.space(SPACE_BOOK),
      this.bookKey(order),
      u64ToBytesBE(order.id)
    );
    const marker = new Uint8Array(1);
    marker[0] = 1;
    System.putBytes(
      this.space(SPACE_USER_ORDERS),
      this.userOrderKey(order.owner!, order.id),
      marker
    );
  }

  private updateOrder(order: orderbook.order_object): void {
    System.putObject(
      this.space(SPACE_ORDERS),
      u64ToBytesBE(order.id),
      order,
      orderbook.order_object.encode
    );
  }

  /**
   * Remove an order from all indexes
   */
  private deleteOrder(order: orderbook.order_object): void {
    System.removeObject(this.space(SPACE_ORDERS), u64ToBytesBE(order.id));
    System.removeObject(this.space(SPACE_BOOK), this.bookKey(order));
    System.removeObject(
      this.space(SPACE_USER_ORDERS),
      this.userOrderKey(order.owner!, order.id)
    );
  }

  /**
   * Best resting order id of a side, or 0 when the side is empty.
   * The book key encodes price-time priority so the first key of the
   * side prefix is always the best order.
   */
  private bestOrderId(marketId: u32, side: u32): u64 {
    const prefix = this.bookPrefix(marketId, side);
    const obj = System.getNextBytes(this.space(SPACE_BOOK), prefix);
    if (!obj) return 0;
    const key = obj.key;
    if (!key) return 0;
    if (key.length != 21 || !startsWith(key, prefix)) return 0;
    return bytesToU64BE(key, 13);
  }

  private tokenOf(
    order: orderbook.order_object,
    market: orderbook.market_config
  ): Token {
    // buy orders escrow the quote token, sell orders escrow the base token
    return order.side == SIDE_BUY
      ? new Token(market.quote_token!)
      : new Token(market.base_token!);
  }

  private blockTimestamp(): u64 {
    const field = System.getBlockField("header.timestamp");
    if (!field) return 0;
    return field.uint64_value;
  }

  private recordTrade(
    state: orderbook.global_state,
    market: orderbook.market_config,
    price: u64,
    quantity: u64,
    quoteAmount: u64,
    takerSide: u32,
    maker: Uint8Array,
    taker: Uint8Array,
    makerOrderId: u64,
    timestamp: u64
  ): void {
    const trade = new orderbook.trade_object();
    trade.seq = state.next_trade_seq;
    state.next_trade_seq += 1;
    trade.market_id = market.market_id;
    trade.price = price;
    trade.quantity = quantity;
    trade.quote_amount = quoteAmount;
    trade.taker_side = takerSide;
    trade.timestamp = timestamp;
    trade.maker = maker;
    trade.taker = taker;
    trade.maker_order_id = makerOrderId;

    const slotKey = concat2(
      u32ToBytesBE(market.market_id),
      u32ToBytesBE(market.trade_head)
    );
    System.putObject(
      this.space(SPACE_TRADES),
      slotKey,
      trade,
      orderbook.trade_object.encode
    );
    market.trade_head = (market.trade_head + 1) % TRADE_RING_CAP;
    market.trade_count += 1;
    market.last_price = price;
    market.base_volume += quantity;
    market.quote_volume += quoteAmount;

    const tradeEvent = new orderbook.trade_event(trade);
    const impacted: Uint8Array[] = [taker, maker];
    System.event(
      "orderbook.trade",
      Protobuf.encode(tradeEvent, orderbook.trade_event.encode),
      impacted
    );
  }

  // -------------------------------------------------------------------------
  // Entry points
  // -------------------------------------------------------------------------

  create_market(
    args: orderbook.create_market_arguments
  ): orderbook.create_market_result {
    // only the contract account itself may create markets
    System.requireAuthority(
      authority.authorization_type.contract_call,
      this.contractId
    );

    System.require(
      args.base_token != null && args.base_token!.length > 0,
      "orderbook: missing base token"
    );
    System.require(
      args.quote_token != null && args.quote_token!.length > 0,
      "orderbook: missing quote token"
    );
    const baseToken = args.base_token!;
    const quoteToken = args.quote_token!;
    System.require(
      !bytesEqual(baseToken, quoteToken),
      "orderbook: base and quote must differ"
    );
    System.require(
      args.min_base_amount > 0,
      "orderbook: min_base_amount must be positive"
    );

    const state = this.getGlobalState();

    // reject duplicated pairs in either direction
    for (let id: u32 = 1; id < state.next_market_id; id++) {
      const existing = this.getMarket(id);
      if (!existing) continue;
      const sameDirection =
        bytesEqual(existing.base_token!, baseToken) &&
        bytesEqual(existing.quote_token!, quoteToken);
      const reversed =
        bytesEqual(existing.base_token!, quoteToken) &&
        bytesEqual(existing.quote_token!, baseToken);
      System.require(
        !sameDirection && !reversed,
        "orderbook: market already exists for this pair"
      );
    }

    const market = new orderbook.market_config();
    market.market_id = state.next_market_id;
    market.base_token = baseToken;
    market.quote_token = quoteToken;
    market.min_base_amount = args.min_base_amount;
    market.last_price = 0;
    market.trade_head = 0;
    market.trade_count = 0;
    market.base_volume = 0;
    market.quote_volume = 0;

    state.next_market_id += 1;
    this.saveMarket(market);
    this.saveGlobalState(state);

    const result = new orderbook.create_market_result();
    result.market_id = market.market_id;
    return result;
  }

  place_order(
    args: orderbook.place_order_arguments
  ): orderbook.place_order_result {
    System.require(
      args.owner != null && args.owner!.length > 0,
      "orderbook: missing owner"
    );
    const owner = args.owner!;
    const side = args.side;
    const price = args.price;
    const quantity = args.quantity;
    const flags = args.flags;
    System.require(
      side == SIDE_BUY || side == SIDE_SELL,
      "orderbook: invalid side"
    );
    System.require(
      flags == FLAG_GTC || flags == FLAG_IOC || flags == FLAG_POST_ONLY,
      "orderbook: invalid flags"
    );
    System.require(price > 0, "orderbook: price must be positive");

    const market = this.getMarket(args.market_id);
    System.require(market != null, "orderbook: unknown market");
    const mkt = market!;

    System.require(
      quantity >= mkt.min_base_amount,
      "orderbook: quantity below market minimum"
    );
    System.require(
      mulDivFloor(quantity, price, PRICE_SCALE) > 0,
      "orderbook: order value rounds to zero"
    );

    // the order owner must have authorized this call
    System.requireAuthority(authority.authorization_type.contract_call, owner);

    const baseToken = new Token(mkt.base_token!);
    const quoteToken = new Token(mkt.quote_token!);

    // pull the full escrow upfront:
    //   buy  -> worst-case quote cost at the limit price
    //   sell -> the base quantity being sold
    let escrowLeft: u64;
    if (side == SIDE_BUY) {
      escrowLeft = mulDivCeil(quantity, price, PRICE_SCALE);
      System.require(
        quoteToken.transfer(owner, this.contractId, escrowLeft),
        "orderbook: quote token transfer failed (check balance/authority)"
      );
    } else {
      escrowLeft = quantity;
      System.require(
        baseToken.transfer(owner, this.contractId, escrowLeft),
        "orderbook: base token transfer failed (check balance/authority)"
      );
    }

    const oppositeSide = side == SIDE_BUY ? SIDE_SELL : SIDE_BUY;

    if (flags == FLAG_POST_ONLY) {
      const bestId = this.bestOrderId(mkt.market_id, oppositeSide);
      if (bestId > 0) {
        const best = this.getOrderById(bestId);
        System.require(
          best != null && !priceCrosses(side, price, best.price),
          "orderbook: post-only order would cross the spread"
        );
      }
    }

    const state = this.getGlobalState();
    const timestamp = this.blockTimestamp();

    let remaining = quantity;
    let filledQuantity: u64 = 0;
    let filledQuote: u64 = 0;
    let fills: u32 = 0;

    // match against the opposite side of the book, best priced order first
    while (remaining > 0 && fills < MAX_FILLS_PER_TX) {
      const makerId = this.bestOrderId(mkt.market_id, oppositeSide);
      if (makerId == 0) break;

      const makerOrder = this.getOrderById(makerId);
      System.require(makerOrder != null, "orderbook: corrupt book entry");
      const maker = makerOrder!;

      if (!priceCrosses(side, price, maker.price)) break;

      const fillQuantity =
        remaining < maker.remaining ? remaining : maker.remaining;
      // trades always execute at the resting (maker) price
      const quoteAmount = mulDivFloor(fillQuantity, maker.price, PRICE_SCALE);

      if (quoteAmount == 0) {
        if (fillQuantity == maker.remaining) {
          // the maker remainder is too small to be worth any quote: close it
          // and refund its escrow instead of trading it away for nothing
          this.deleteOrder(maker);
          if (maker.escrow > 0) {
            System.require(
              this.tokenOf(maker, mkt).transfer(
                this.contractId,
                maker.owner!,
                maker.escrow
              ),
              "orderbook: dust refund transfer failed"
            );
          }
          fills += 1;
          continue;
        }
        // the taker remainder is the dust: stop matching
        break;
      }

      if (side == SIDE_BUY) {
        // taker pays quote to the maker, receives base from maker escrow
        System.require(
          quoteAmount <= escrowLeft,
          "orderbook: taker escrow underflow"
        );
        System.require(
          fillQuantity <= maker.escrow,
          "orderbook: maker escrow underflow"
        );
        System.require(
          quoteToken.transfer(this.contractId, maker.owner!, quoteAmount),
          "orderbook: quote settlement transfer failed"
        );
        System.require(
          baseToken.transfer(this.contractId, owner, fillQuantity),
          "orderbook: base settlement transfer failed"
        );
        escrowLeft -= quoteAmount;
        maker.escrow -= fillQuantity;
      } else {
        // taker delivers base to the maker, receives quote from maker escrow
        System.require(
          fillQuantity <= escrowLeft,
          "orderbook: taker escrow underflow"
        );
        System.require(
          quoteAmount <= maker.escrow,
          "orderbook: maker escrow underflow"
        );
        System.require(
          baseToken.transfer(this.contractId, maker.owner!, fillQuantity),
          "orderbook: base settlement transfer failed"
        );
        System.require(
          quoteToken.transfer(this.contractId, owner, quoteAmount),
          "orderbook: quote settlement transfer failed"
        );
        escrowLeft -= fillQuantity;
        maker.escrow -= quoteAmount;
      }

      maker.remaining -= fillQuantity;
      remaining -= fillQuantity;
      filledQuantity += fillQuantity;
      filledQuote += quoteAmount;

      this.recordTrade(
        state,
        mkt,
        maker.price,
        fillQuantity,
        quoteAmount,
        side,
        maker.owner!,
        owner,
        maker.id,
        timestamp
      );

      if (maker.remaining == 0) {
        this.deleteOrder(maker);
        // refund any escrow dust left by floor rounding on buy orders
        if (maker.escrow > 0) {
          System.require(
            this.tokenOf(maker, mkt).transfer(
              this.contractId,
              maker.owner!,
              maker.escrow
            ),
            "orderbook: maker dust refund failed"
          );
        }
      } else {
        this.updateOrder(maker);
      }

      fills += 1;
    }

    const result = new orderbook.place_order_result();
    result.filled_quantity = filledQuantity;
    result.filled_quote = filledQuote;

    // decide what happens to the unfilled remainder
    const shouldRest =
      remaining >= mkt.min_base_amount &&
      flags != FLAG_IOC &&
      mulDivFloor(remaining, price, PRICE_SCALE) > 0;

    if (remaining > 0 && shouldRest) {
      const order = new orderbook.order_object();
      order.id = state.next_order_id;
      state.next_order_id += 1;
      order.market_id = mkt.market_id;
      order.side = side;
      order.price = price;
      order.quantity = quantity;
      order.remaining = remaining;
      order.owner = owner;
      order.timestamp = timestamp;

      if (side == SIDE_BUY) {
        // keep enough quote escrow to cover the remainder at the limit price
        const restEscrow = mulDivCeil(remaining, price, PRICE_SCALE);
        System.require(
          restEscrow <= escrowLeft,
          "orderbook: rest escrow underflow"
        );
        order.escrow = restEscrow;
        escrowLeft -= restEscrow;
      } else {
        order.escrow = remaining;
        escrowLeft = 0;
      }

      this.storeOrder(order);

      const placedEvent = new orderbook.order_placed_event(order);
      const impacted: Uint8Array[] = [owner];
      System.event(
        "orderbook.order_placed",
        Protobuf.encode(placedEvent, orderbook.order_placed_event.encode),
        impacted
      );

      result.order_id = order.id;
      result.remaining = remaining;
    } else {
      result.order_id = 0;
      result.remaining = 0;
    }

    // refund whatever escrow was neither spent nor left resting
    if (escrowLeft > 0) {
      const refundToken = side == SIDE_BUY ? quoteToken : baseToken;
      System.require(
        refundToken.transfer(this.contractId, owner, escrowLeft),
        "orderbook: escrow refund transfer failed"
      );
    }

    this.saveMarket(mkt);
    this.saveGlobalState(state);

    return result;
  }

  cancel_order(
    args: orderbook.cancel_order_arguments
  ): orderbook.cancel_order_result {
    const order = this.getOrderById(args.order_id);
    System.require(order != null, "orderbook: order not found");
    const ord = order!;

    System.requireAuthority(
      authority.authorization_type.contract_call,
      ord.owner!
    );

    const market = this.getMarket(ord.market_id);
    System.require(market != null, "orderbook: unknown market");

    this.deleteOrder(ord);

    if (ord.escrow > 0) {
      System.require(
        this.tokenOf(ord, market!).transfer(
          this.contractId,
          ord.owner!,
          ord.escrow
        ),
        "orderbook: cancel refund transfer failed"
      );
    }

    const cancelEvent = new orderbook.order_cancelled_event();
    cancelEvent.order_id = ord.id;
    cancelEvent.market_id = ord.market_id;
    cancelEvent.owner = ord.owner;
    const impacted: Uint8Array[] = [ord.owner!];
    System.event(
      "orderbook.order_cancelled",
      Protobuf.encode(cancelEvent, orderbook.order_cancelled_event.encode),
      impacted
    );

    return new orderbook.cancel_order_result();
  }

  get_markets(
    args: orderbook.get_markets_arguments
  ): orderbook.get_markets_result {
    const result = new orderbook.get_markets_result();
    const state = this.getGlobalState();
    for (let id: u32 = 1; id < state.next_market_id; id++) {
      const market = this.getMarket(id);
      if (market) result.markets.push(market);
    }
    return result;
  }

  get_orderbook(
    args: orderbook.get_orderbook_arguments
  ): orderbook.get_orderbook_result {
    const result = new orderbook.get_orderbook_result();
    let limit = args.limit == 0 ? DEFAULT_BOOK_LIMIT : args.limit;
    if (limit > MAX_BOOK_LIMIT) limit = MAX_BOOK_LIMIT;

    for (let s: u32 = 0; s <= 1; s++) {
      const prefix = this.bookPrefix(args.market_id, s);
      let cursor: Uint8Array = prefix;
      let count: u32 = 0;
      while (count < limit) {
        const obj = System.getNextBytes(this.space(SPACE_BOOK), cursor);
        if (!obj) break;
        const key = obj.key;
        if (!key) break;
        if (key.length != 21 || !startsWith(key, prefix)) break;
        const order = this.getOrderById(bytesToU64BE(key, 13));
        if (order) {
          if (s == SIDE_BUY) {
            result.bids.push(order);
          } else {
            result.asks.push(order);
          }
        }
        cursor = key;
        count += 1;
      }
    }
    return result;
  }

  get_order(args: orderbook.get_order_arguments): orderbook.get_order_result {
    const result = new orderbook.get_order_result();
    result.value = this.getOrderById(args.order_id);
    return result;
  }

  get_user_orders(
    args: orderbook.get_user_orders_arguments
  ): orderbook.get_user_orders_result {
    const result = new orderbook.get_user_orders_result();
    if (args.owner == null) return result;
    const owner = args.owner!;
    if (owner.length == 0) return result;

    let limit = args.limit == 0 ? DEFAULT_USER_ORDERS_LIMIT : args.limit;
    if (limit > MAX_USER_ORDERS_LIMIT) limit = MAX_USER_ORDERS_LIMIT;

    let cursor = this.userOrderKey(owner, args.start);
    let count: u32 = 0;
    while (count < limit) {
      const obj = System.getNextBytes(this.space(SPACE_USER_ORDERS), cursor);
      if (!obj) break;
      const key = obj.key;
      if (!key) break;
      if (key.length != owner.length + 8 || !startsWith(key, owner)) break;
      const order = this.getOrderById(bytesToU64BE(key, owner.length));
      if (order) result.orders.push(order);
      cursor = key;
      count += 1;
    }
    return result;
  }

  get_trades(
    args: orderbook.get_trades_arguments
  ): orderbook.get_trades_result {
    const result = new orderbook.get_trades_result();
    const market = this.getMarket(args.market_id);
    if (!market) return result;

    let limit = args.limit == 0 ? DEFAULT_TRADES_LIMIT : args.limit;
    if (limit > MAX_TRADES_LIMIT) limit = MAX_TRADES_LIMIT;

    let available: u64 = market.trade_count;
    if (available > u64(TRADE_RING_CAP)) available = u64(TRADE_RING_CAP);
    if (u64(limit) < available) available = u64(limit);

    // walk backwards from the newest slot
    let slot = market.trade_head;
    for (let i: u64 = 0; i < available; i++) {
      slot = slot == 0 ? TRADE_RING_CAP - 1 : slot - 1;
      const slotKey = concat2(u32ToBytesBE(args.market_id), u32ToBytesBE(slot));
      const trade = System.getObject<Uint8Array, orderbook.trade_object>(
        this.space(SPACE_TRADES),
        slotKey,
        orderbook.trade_object.decode
      );
      if (trade) result.trades.push(trade);
    }
    return result;
  }
}
