// Create the trading markets on a deployed orderbook contract.
//
//   KOINOS_WIF=<contract wif> [KOINOS_NETWORK=mainnet] npm run create-markets
//
// Every market is created with the minimum order size set to one smallest
// unit of the base token (no artificial minimum).

import { Signer, Provider, Contract } from "koilib";
import { RPC_URLS, TOKENS, MARKETS, getNetwork, requireWif } from "./config.js";
import { loadOrderbookAbi } from "./abi-utils.js";

async function main() {
  const network = getNetwork();
  const provider = new Provider(RPC_URLS[network]);
  console.log(`rpc      : ${RPC_URLS[network][0]}`);
  const signer = Signer.fromWif(requireWif());
  signer.provider = provider;
  const tokens = TOKENS[network];

  const orderbook = new Contract({
    id: signer.getAddress(),
    abi: loadOrderbookAbi(),
    provider,
    signer,
  });

  const { result: existing } = await orderbook.functions.get_markets({});
  const existingPairs = new Set(
    (existing?.markets || []).map((m) => `${m.baseToken}/${m.quoteToken}`)
  );

  for (const [baseSymbol, quoteSymbol] of MARKETS) {
    const base = tokens[baseSymbol];
    const quote = tokens[quoteSymbol];
    if (!base?.address || !quote?.address) {
      console.log(`skipping ${baseSymbol}/${quoteSymbol}: missing token address`);
      continue;
    }
    if (
      existingPairs.has(`${base.address}/${quote.address}`) ||
      existingPairs.has(`${quote.address}/${base.address}`)
    ) {
      console.log(`skipping ${baseSymbol}/${quoteSymbol}: already exists`);
      continue;
    }

    const minBaseAmount = "1"; // one smallest unit of the base token
    console.log(`creating ${baseSymbol}/${quoteSymbol}...`);
    // market creation is a tiny transaction: ask for a small rc limit so the
    // mempool never sees us requesting the account's whole mana allowance
    // (which collides with reservations from just-submitted transactions)
    const submit = () =>
      orderbook.functions.create_market(
        {
          baseToken: base.address,
          quoteToken: quote.address,
          minBaseAmount,
        },
        { rcLimit: "300000000" } // 3 KOIN of mana
      );
    let transaction;
    for (let attempt = 1; ; attempt++) {
      try {
        ({ transaction } = await submit());
        break;
      } catch (error) {
        const message = String(error?.message || error);
        if (attempt < 5 && message.includes("insufficient pending account resources")) {
          console.log(
            "  mempool still holds a reservation from the previous transaction, retrying in 15s..."
          );
          await new Promise((resolve) => setTimeout(resolve, 15000));
          continue;
        }
        throw error;
      }
    }
    await transaction.wait("byBlock", 60000);
    console.log(`  created in transaction ${transaction.id}`);
  }

  const { result } = await orderbook.functions.get_markets({});
  console.log("\nmarkets on chain:");
  for (const market of result?.markets || []) {
    console.log(
      `  #${market.marketId} base=${market.baseToken} quote=${market.quoteToken} min=${market.minBaseAmount}`
    );
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
