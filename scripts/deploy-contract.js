// Deploy the orderbook contract to the account of KOINOS_WIF.
//
//   KOINOS_WIF=<wif> [KOINOS_NETWORK=mainnet|harbinger] npm run deploy
//
// The WASM must already be built (cd ../contract && yarn install && yarn build).

import { Signer, Provider, Contract } from "koilib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RPC_URLS, getNetwork, requireWif } from "./config.js";
import { buildRegisteredAbi } from "./abi-utils.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(here, "../contract/build/release/contract.wasm");

async function main() {
  const network = getNetwork();
  const provider = new Provider(RPC_URLS[network]);
  const signer = Signer.fromWif(requireWif());
  signer.provider = provider;

  if (!fs.existsSync(wasmPath)) {
    throw new Error(`missing ${wasmPath} - build the contract first`);
  }

  const bytecode = fs.readFileSync(wasmPath);
  const abi = buildRegisteredAbi();

  console.log(`network  : ${network}`);
  console.log(`contract : ${signer.getAddress()}`);
  console.log(`bytecode : ${bytecode.length} bytes (+${abi.length} bytes ABI)`);

  // preflight: contract uploads are disk-heavy, so estimate the mana cost
  // from live resource pricing before broadcasting anything
  const available =
    Number(await provider.getAccountRc(signer.getAddress())) / 1e8;
  const { resource_limit_data: limits } = await provider.call(
    "chain.get_resource_limits",
    {}
  );
  const storedBytes = bytecode.length + abi.length + 1024;
  const estimate =
    (storedBytes * Number(limits.disk_storage_cost) +
      (storedBytes + 2048) * Number(limits.network_bandwidth_cost)) /
      1e8 +
    2; // ~2 KOIN margin for compute
  console.log(`mana     : ${available.toFixed(2)} KOIN available`);
  console.log(`estimate : ~${estimate.toFixed(1)} KOIN of mana for this upload (worst case)`);
  if (available < estimate && process.env.FORCE !== "1") {
    throw new Error(
      `not enough mana: hold at least ${Math.ceil(estimate + 5)} KOIN on ` +
        `${signer.getAddress()} and retry. The KOIN is not spent - consumed ` +
        `mana recharges fully within 5 days. (Re-uploading over an existing ` +
        `contract of similar size costs much less than the estimate - set ` +
        `FORCE=1 to attempt anyway.)`
    );
  }

  const contract = new Contract({
    id: signer.getAddress(),
    provider,
    signer,
    bytecode,
  });

  // registering the ABI on-chain lets explorers and koilib discover it
  const { transaction } = await contract.deploy({ abi });
  console.log(`transaction ${transaction.id} submitted, waiting...`);
  const { blockNumber } = await transaction.wait("byBlock", 60000);
  console.log(`deployed in block ${blockNumber}`);
  console.log(
    `\nSet VITE_ORDERBOOK_ADDRESS=${signer.getAddress()} in frontend/.env`
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
