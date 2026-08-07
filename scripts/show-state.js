// Inspect a deployed orderbook contract: markets, books and recent trades.
//
//   ORDERBOOK_ADDRESS=<address> [KOINOS_NETWORK=mainnet] npm run show-state

import { Provider, Contract } from "koilib";
import { RPC_URLS, getNetwork } from "./config.js";
import { loadOrderbookAbi } from "./abi-utils.js";

async function main() {
  const address = process.env.ORDERBOOK_ADDRESS;
  if (!address) throw new Error("set ORDERBOOK_ADDRESS");

  const provider = new Provider(RPC_URLS[getNetwork()]);
  const orderbook = new Contract({
    id: address,
    abi: loadOrderbookAbi(),
    provider,
  });

  const { result } = await orderbook.functions.get_markets({});
  const markets = result?.markets || [];
  console.log(`${markets.length} markets`);

  for (const market of markets) {
    console.log(
      `\n#${market.marketId} ${market.baseToken} / ${market.quoteToken}`
    );
    console.log(
      `  last=${market.lastPrice || 0} trades=${market.tradeCount || 0} volume=${market.baseVolume || 0}`
    );

    const { result: book } = await orderbook.functions.get_orderbook({
      marketId: market.marketId,
      limit: 5,
    });
    console.log(`  asks:`);
    for (const order of (book?.asks || []).reverse()) {
      console.log(`    ${order.price} x ${order.remaining} (#${order.id})`);
    }
    console.log(`  bids:`);
    for (const order of book?.bids || []) {
      console.log(`    ${order.price} x ${order.remaining} (#${order.id})`);
    }

    const { result: trades } = await orderbook.functions.get_trades({
      marketId: market.marketId,
      limit: 5,
    });
    console.log(`  recent trades:`);
    for (const trade of trades?.trades || []) {
      console.log(
        `    seq=${trade.seq} price=${trade.price} qty=${trade.quantity} takerSide=${trade.takerSide || 0}`
      );
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
