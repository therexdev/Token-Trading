import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Signer } from 'koilib';
import { buildRehearsal, work } from './rehearsal-build.js';
import { HARBINGER, HARBINGER_RPC, providerFor, createState, checkNetwork, save, publicReport } from './rehearsal-core.js';
import { scenarios } from './rehearsal-scenarios.js';

export async function main(command = process.argv[2]) {
  const stateFile = path.join(work, 'state.json');
  if (command === 'init') {
    const state = createState();
    console.log(`Created disposable test accounts. Payer: ${state.addresses.payer}`);
    console.log('Fund this address with tKOIN ONLY after check verifies your Harbinger RPC. Keys stay in .testnet-rehearsal/keys.json.');
    return;
  }
  if (command === 'offline-build') {
    const addresses = Object.fromEntries(['payer', 'owner', 'buyer', 'orderbook', 'launchpad', 'base', 'quote', 'router']
      .map(role => [role, Signer.fromSeed('PUBLIC OFFLINE TEST ONLY ' + role).getAddress()]));
    const manifest = buildRehearsal({ addresses }, path.join(work, 'offline-build'));
    console.log(JSON.stringify(manifest.artifacts, null, 2)); return;
  }
  if (!['build', 'check', 'run', 'resume', 'report'].includes(command)) throw new Error('Usage: node scripts/testnet-rehearsal.js init|build|check|run|resume|report|offline-build');
  if (!fs.existsSync(stateFile)) throw new Error('Run init first');
  const state = JSON.parse(fs.readFileSync(stateFile));
  const persist = () => save(stateFile, state);
  const manifestFile = path.join(work, 'build/manifest.json');
  if (command === 'build') {
    if (Object.keys(state.journal).length) throw new Error('Cannot rebuild artifacts after a transaction has been journaled');
    const manifest = buildRehearsal(state); console.log(JSON.stringify(manifest.artifacts, null, 2)); return;
  }
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile)) : null;
  const report = () => { const output = path.join(work, 'report.json'); save(output, publicReport(state, manifest)); console.log(`Public report: ${output}`); };
  if (command === 'report') { report(); return; }
  const p = providerFor(process.env.REHEARSAL_RPC || HARBINGER_RPC);
  const expected = state.chainId || process.env.REHEARSAL_CHAIN_ID || HARBINGER;
  const network = await checkNetwork(p, expected);
  if (!state.chainId) { state.chainId = network.chainId; persist(); }
  const rc = BigInt(await p.getAccountRc(state.addresses.payer));
  console.log(`Verified testnet chain: ${state.chainId}`);
  console.log(`Payer: ${state.addresses.payer}; available Mana: ${Number(rc) / 1e8} tKOIN`);
  if (!manifest) throw new Error('Run build to create the test-only artifacts');
  if (JSON.stringify(manifest.addresses) !== JSON.stringify(state.addresses)) throw new Error('Build belongs to different test accounts');
  const limits = (await p.getResourceLimits()).resource_limit_data;
  // Conservative upload budget plus a fixed transaction execution reserve.
  const stored = 3 * manifest.artifacts.fixture.bytes + manifest.artifacts['orderbook-before'].bytes + manifest.artifacts['launchpad-before'].bytes + 10000;
  const traffic = stored + manifest.artifacts['orderbook-after'].bytes + manifest.artifacts['launchpad-after'].bytes + 100000;
  const estimate = BigInt(stored) * BigInt(limits.disk_storage_cost) + BigInt(traffic) * BigInt(limits.network_bandwidth_cost) + 100n * 100000000n;
  console.log(`Planning budget: ${Number((estimate + 99999999n) / 100000000n)} tKOIN of Mana (estimate; actual costs are recorded per transaction).`);
  if (command === 'check') { if (rc < estimate) console.log('Funding needed before the complete run.'); return; }
  if (Object.keys(state.journal).length === 0 && rc < estimate) throw new Error('Fund the test payer to the printed planning budget before run');
  const keys = JSON.parse(fs.readFileSync(path.join(work, 'keys.json')));
  try { await scenarios(p, state, keys, persist, manifest); }
  finally { report(); }
  console.log(`Passed ${Object.values(state.checks).filter(x => x.status === 'passed').length} rehearsal stages. Mainnet deployment is not authorized by this result.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.stderr?.toString() || error.message); process.exitCode = 1;
});
