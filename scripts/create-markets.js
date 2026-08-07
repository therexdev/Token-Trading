// Create the trading markets on a deployed orderbook contract.
//
//   KOINOS_WIF=<contract wif> [KOINOS_NETWORK=mainnet] npm run create-markets
//
// Reads each token's decimals on-chain and converts the human minimum order
// size from config.js into base units.

import { Signer, Provider, Contract, utils } from "koilib";
import { RPC_URLS, TOKENS, MARKETS, getNetwork, requireWif } from "./config.js";
import { loadOrderbookAbi } from "./abi-utils.js";

async function main() {
  const network = getNetwork();
  const provider = new Provider(RPC_URLS[network]);
  const signer = Signer.fromWif(requireWif());
  signer.provider = provider;
  const tokens = TOKENS[network];

  const orderbook = new Contract({
    id: signer.getAddress(),
    abi: loadOrderbookAbi(),
    provider,
    signer,
  });

  // look up decimals for every token once
  const decimals = {};
  for (const [symbol, token] of Object.entries(tokens)) {
    if (!token.address) continue;
    const tokenContract = new Contract({
      id: token.address,
      abi: utils.tokenAbi,
      provider,
    });
    const { result } = await tokenContract.functions.decimals();
    decimals[symbol] = Number(result.value);
    console.log(`${symbol} (${token.address}): ${decimals[symbol]} decimals`);
  }

  const { result: existing } = await orderbook.functions.get_markets({});
  const existingPairs = new Set(
    (existing?.markets || []).map((m) => `${m.baseToken}/${m.quoteToken}`)
  );

  for (const [baseSymbol, quoteSymbol, minBaseHuman] of MARKETS) {
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

    const minBaseAmount = utils.parseUnits(minBaseHuman, decimals[baseSymbol]);
    console.log(
      `creating ${baseSymbol}/${quoteSymbol} (min order ${minBaseHuman} ${baseSymbol} = ${minBaseAmount})...`
    );
    const { transaction } = await orderbook.functions.create_market({
      baseToken: base.address,
      quoteToken: quote.address,
      minBaseAmount,
    });
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
