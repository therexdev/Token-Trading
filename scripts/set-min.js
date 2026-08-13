// Set the minimum order size of existing markets (contract authority only).
//
//   KOINOS_WIF=<contract wif> npm run set-min             # every market -> 1
//   KOINOS_WIF=<wif> MARKET_ID=7 MIN=1 npm run set-min    # a single market
//
// Uses the set_min_base_amount entry point. The default (no MARKET_ID)
// walks every market on the contract and lowers any minimum that is not
// already the target to it, batching the updates into one transaction.

import { Signer, Provider, Contract, Transaction } from "koilib";
import { RPC_URLS, getNetwork, requireWif } from "./config.js";
import { loadOrderbookAbi } from "./abi-utils.js";

const BATCH_SIZE = 10; // set_min ops per transaction

async function main() {
  const network = getNetwork();
  const provider = new Provider(RPC_URLS[network]);
  console.log(`rpc      : ${RPC_URLS[network][0]}`);
  const signer = Signer.fromWif(requireWif());
  signer.provider = provider;

  const orderbook = new Contract({
    id: signer.getAddress(),
    abi: loadOrderbookAbi(),
    provider,
    signer,
  });

  const target = process.env.MIN || "1";
  let updates;
  if (process.env.MARKET_ID) {
    updates = [{ marketId: Number(process.env.MARKET_ID) }];
  } else {
    const { result } = await orderbook.functions.get_markets({});
    updates = (result?.markets || [])
      .filter((market) => String(market.minBaseAmount ?? "0") !== target)
      .map((market) => ({ marketId: Number(market.marketId) }));
  }

  if (!updates.length) {
    console.log(`nothing to do: every market already has min ${target}`);
    return;
  }
  console.log(
    `setting min_base_amount=${target} on market(s) ${updates
      .map((update) => update.marketId)
      .join(", ")}`
  );

  for (let start = 0; start < updates.length; start += BATCH_SIZE) {
    const batch = updates.slice(start, start + BATCH_SIZE);
    const transaction = new Transaction({
      signer,
      provider,
      options: { rcLimit: "500000000" }, // 5 KOIN of mana per batch
    });
    for (const { marketId } of batch) {
      await transaction.pushOperation(orderbook.functions.set_min_base_amount, {
        marketId,
        minBaseAmount: target,
      });
    }
    await transaction.send();
    console.log(
      `  batch of ${batch.length} submitted in ${transaction.transaction?.id}, waiting...`
    );
    await transaction.wait("byBlock", 60000);
  }

  const { result } = await orderbook.functions.get_markets({});
  console.log("\nminimums on chain:");
  for (const market of result?.markets || []) {
    console.log(`  #${market.marketId} min=${market.minBaseAmount ?? 0}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
