// Inspect launchpad contract state - a quick post-deploy smoke check and a
// debugging window into any launch.
//
//   LAUNCHPAD_ADDRESS=<addr> npm run launchpad-state             # all launches
//   LAUNCHPAD_ADDRESS=<addr> npm run launchpad-state -- 3        # one launch + buyers

import { Provider, Contract } from "koilib";
import { RPC_URLS, getNetwork } from "./config.js";
import { loadLaunchpadAbi } from "./abi-utils.js";

const STATUS = ["ACTIVE", "DISTRIBUTING", "COMPLETED", "REFUNDING", "CANCELED"];
const MODE = ["FIXED", "POOL"];

function fmtKoin(units) {
  return (Number(units || 0) / 1e8).toLocaleString("en-US", {
    maximumFractionDigits: 8,
  });
}

function fmtTime(ms) {
  const value = Number(ms || 0);
  return value ? new Date(value).toISOString() : "-";
}

async function main() {
  const address = process.env.LAUNCHPAD_ADDRESS;
  if (!address) throw new Error("set LAUNCHPAD_ADDRESS");
  const provider = new Provider(RPC_URLS[getNetwork()]);
  const contract = new Contract({
    id: address,
    provider,
    abi: loadLaunchpadAbi(),
  });

  const onlyId = process.argv[2] ? Number(process.argv[2]) : null;

  const { result } = await contract.functions.get_launches({
    start: 0,
    limit: 100,
  });
  const launches = result?.launches || [];
  console.log(`launchpad ${address}: ${launches.length} launch(es)\n`);

  for (const launch of launches) {
    if (onlyId !== null && Number(launch.id) !== onlyId) continue;
    console.log(`#${launch.id} [${MODE[launch.mode || 0]}] ${STATUS[launch.status || 0]}`);
    console.log(`  token     : ${launch.token}`);
    console.log(`  creator   : ${launch.creator}`);
    console.log(`  for sale  : ${launch.for_sale_amount} units, locked ${launch.locked_amount || 0} until ${fmtTime(launch.unlock_time)}`);
    if ((launch.mode || 0) === 0) console.log(`  price     : ${fmtKoin(launch.price)} KOIN per whole token (1e8 units)`);
    console.log(`  window    : ${fmtTime(launch.start_time)} -> ${fmtTime(launch.end_time)}`);
    console.log(`  caps      : soft ${fmtKoin(launch.soft_cap)} / hard ${fmtKoin(launch.hard_cap)} KOIN`);
    console.log(`  raised    : ${fmtKoin(launch.raised)} KOIN from ${launch.buyer_count || 0} buyer(s), sold ${launch.sold || 0} units`);
    console.log(`  settled   : cursor ${launch.cursor || 0}/${launch.buyer_count || 0}, distributed ${launch.distributed || 0}, refunded ${fmtKoin(launch.refunded)} KOIN`);

    if (onlyId !== null) {
      const { result: buyers } = await contract.functions.get_buyers({
        launch_id: launch.id,
        start: 0,
        limit: 100,
      });
      for (const entry of buyers?.contributions || []) {
        console.log(
          `    buyer ${entry.buyer}: ${fmtKoin(entry.koin)} KOIN -> ${entry.tokens || 0} units ${entry.settled ? "(settled)" : ""}`
        );
      }
    }
    console.log("");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
