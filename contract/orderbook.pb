
Ñ
assembly/proto/orderbook.proto	orderbookkoinos/options.proto"×
market_config
	market_id (RmarketId#

base_token (B€µR	baseToken%
quote_token (B€µR
quoteToken*
min_base_amount (B0RminBaseAmount!

last_price (B0R	lastPrice

trade_head (R	tradeHead#
trade_count (B0R
tradeCount#
base_volume (B0R
baseVolume%
quote_volume	 (B0RquoteVolume"‰
order_object
id (B0Rid
	market_id (RmarketId
side (Rside
price (B0Rprice
quantity (B0Rquantity 
	remaining (B0R	remaining
escrow (B0Rescrow
owner (B€µRowner 
	timestamp	 (B0R	timestamp"Å
trade_object
seq (B0Rseq
	market_id (RmarketId
price (B0Rprice
quantity (B0Rquantity%
quote_amount (B0RquoteAmount

taker_side (R	takerSide 
	timestamp (B0R	timestamp
maker (B€µRmaker
taker	 (B€µRtaker(
maker_order_id
 (B0RmakerOrderId"†
global_state&
next_order_id (B0RnextOrderId(
next_trade_seq (B0RnextTradeSeq$
next_market_id (RnextMarketId"‘
create_market_arguments#

base_token (B€µR	baseToken%
quote_token (B€µR
quoteToken*
min_base_amount (B0RminBaseAmount"3
create_market_result
	market_id (RmarketId"´
place_order_arguments
owner (B€µRowner
	market_id (RmarketId
side (Rside
price (B0Rprice
quantity (B0Rquantity
flags (Rflags"©
place_order_result
order_id (B0RorderId+
filled_quantity (B0RfilledQuantity%
filled_quote (B0RfilledQuote 
	remaining (B0R	remaining"7
cancel_order_arguments
order_id (B0RorderId"
cancel_order_result"
get_markets_arguments"H
get_markets_result2
markets (2.orderbook.market_configRmarkets"L
get_orderbook_arguments
	market_id (RmarketId
limit (Rlimit"p
get_orderbook_result+
bids (2.orderbook.order_objectRbids+
asks (2.orderbook.order_objectRasks"4
get_order_arguments
order_id (B0RorderId"A
get_order_result-
value (2.orderbook.order_objectRvalue"g
get_user_orders_arguments
owner (B€µRowner
start (B0Rstart
limit (Rlimit"I
get_user_orders_result/
orders (2.orderbook.order_objectRorders"I
get_trades_arguments
	market_id (RmarketId
limit (Rlimit"D
get_trades_result/
trades (2.orderbook.trade_objectRtrades"C
order_placed_event-
order (2.orderbook.order_objectRorder"o
order_cancelled_event
order_id (B0RorderId
	market_id (RmarketId
owner (B€µRowner"<
trade_event-
trade (2.orderbook.trade_objectRtradebproto3