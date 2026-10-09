// Read-only production dependency attestation. No signer, key loading, or
// transaction submission. Current-head reads are never called a state replay.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, Serializer, utils } from 'koilib';
import { readOnlyProvider, decodeState, hash, release } from './upgrade-audit.js';
import { toKoilibAbi } from './abi-utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytes = value => Buffer.from(value || '', 'base64url');
export const pins = Object.freeze({
  router: '17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s',
  routerSha256: 'a835153f9259c73bc35cc4fd22027402fb2e3891d450f22d1719b4419c875fdf',
  routerBytes: 63615,
  poolSha256: 'a3ca71ad5ca801080265aeec7842a1d51c1d220e6461c72a98344f49b8e5a532',
  poolBytes: 65070,
  coreCommit: '2ac84216015dc54e007766787d57a06dbe3140b6',
  peripheryCommit: 'b4a73401bcf0aed293ec46ed6fba295b1830c507',
  launchId: 4,
  pair: '1Bgb4hw9DrdRqEWGS9gFfo9E6Uw8qVzyhT',
  token: '1GwXTEUJ2ftBnosp4Q5RLAf5XEmaLfxW21',
  creator: '12Kw58PnaGUemfWy5Hf8qp7YftaoTBATYA',
  lpAmount: '99990000',
  lpUnlockTime: '1803508620000',
});
const metadataCodec = new Serializer({ nested: { Metadata: { fields: {
  hash: { type: 'bytes', id: 1 }, system: { type: 'bool', id: 2 },
  authorizesCall: { type: 'bool', id: 3 }, authorizesTransaction: { type: 'bool', id: 4 },
  authorizesUpload: { type: 'bool', id: 5 },
} } } });

export function verifyBuild(manifest) {
  if (manifest.sources?.core?.commit !== pins.coreCommit ||
      manifest.sources?.periphery?.commit !== pins.peripheryCommit ||
      manifest.artifacts?.router?.sha256 !== pins.routerSha256 ||
      manifest.artifacts?.router?.bytes !== pins.routerBytes ||
      manifest.artifacts?.pool?.sha256 !== pins.poolSha256 ||
      manifest.artifacts?.pool?.bytes !== pins.poolBytes ||
      manifest.poolHashPin?.upstream !== '1220' + pins.poolSha256 ||
      manifest.poolHashPin?.compiled !== '1220' + pins.poolSha256 ||
      manifest.poolHashPin?.matchesUpstream !== true || manifest.substitutions?.length !== 0) {
    throw new Error('Official source-build evidence does not match reviewed pins');
  }
}

export function verifyMetadata(metadata, sha256, overrides) {
  if (bytes(metadata.hash).toString('hex') !== '1220' + sha256) throw new Error('Deployed metadata hash differs from the pinned build');
  if (metadata.system !== false || ['authorizesCall', 'authorizesTransaction', 'authorizesUpload']
    .some(flag => metadata[flag] !== overrides)) throw new Error('Unexpected contract authorization flags');
}

export function verifyBytecode(code, sha256, size) {
  const wasm = bytes(code);
  if (wasm.length !== size || hash(wasm) !== sha256 ||
      !wasm.subarray(0, 8).equals(Buffer.from('0061736d01000000', 'hex'))) {
    throw new Error('Deployed bytecode differs from the pinned build');
  }
  return { bytes: wasm.length, sha256: hash(wasm) };
}

function units(value) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error('Invalid token amount');
  const n = BigInt(value);
  if (n > (1n << 64n) - 1n) throw new Error('Invalid token amount');
  return n;
}

export function verifyPair({ launch, pair, reversePair, tokens, balance }) {
  if (launch?.id !== pins.launchId || launch.token !== pins.token || launch.pair !== pins.pair ||
      launch.liquidityState !== 2 || launch.lpClaimed !== false || launch.creator !== pins.creator ||
      launch.lpAmount !== pins.lpAmount || launch.lpUnlockTime !== pins.lpUnlockTime) {
    throw new Error('Preserved production LP claim changed; review the new lifecycle before attesting');
  }
  if (pair?.value !== pins.pair || reversePair?.value !== pins.pair) throw new Error('Router pair mapping does not match the preserved claim');
  if (tokens?.tokenA !== release.koin || tokens?.tokenB !== pins.token) throw new Error('Pool token identity or ordering differs');
  if (units(balance?.value) < units(launch.lpAmount)) throw new Error('Preserved LP claim is underfunded');
}

const abi = file => JSON.parse(fs.readFileSync(path.join(root, file)));
async function read(contract, name, args = {}) {
  const method = contract.abi.methods[name];
  if (!method?.read_only) throw new Error('Only read-only contract methods are allowed');
  const { result } = await contract.functions[name](args);
  if (!result) throw new Error(`Missing ${name} response`);
  return decodeState(contract.serializer, await contract.serializer.serialize(result, method.return), method.return);
}
async function metadata(provider, address) {
  const raw = await provider.invokeGetObject({ address, system: true, zone: '', id: 3,
    key: utils.encodeBase64url(utils.decodeBase58(address)) });
  if (!raw) throw new Error('Contract metadata missing');
  return decodeState(metadataCodec, raw, 'Metadata');
}
async function bytecode(provider, address) {
  return provider.invokeGetObject({ address, system: true, zone: '', id: 2,
    key: utils.encodeBase64url(utils.decodeBase58(address)) });
}

export async function attestRouter(provider, endpoint) {
  const buildFile = path.join(root, 'docs/release-evidence/koindx-source-build-2026-10-06.json');
  const buildBytes = fs.readFileSync(buildFile), manifest = JSON.parse(buildBytes);
  verifyBuild(manifest);
  const chainId = await provider.getChainId();
  if (!bytes(chainId).equals(bytes(release.chainId))) throw new Error('Wrong chain for production attestation');
  const start = await provider.getHeadInfo();
  const routerMetadata = await metadata(provider, pins.router);
  verifyMetadata(routerMetadata, pins.routerSha256, false);
  const routerCode = verifyBytecode(await bytecode(provider, pins.router), pins.routerSha256, pins.routerBytes);
  const poolMetadata = await metadata(provider, pins.pair);
  verifyMetadata(poolMetadata, pins.poolSha256, true);
  let poolCode, poolCodeReadError;
  try { poolCode = await bytecode(provider, pins.pair); }
  catch (e) {
    // The public chain RPC has a fixed system-call result buffer. Keep that
    // limitation explicit; never substitute metadata for a direct byte read.
    if (!String(e.message).includes('return buffer is not large enough for the return value')) throw e;
    poolCodeReadError = e.message;
  }
  const poolBytecode = poolCodeReadError ? null : verifyBytecode(poolCode, pins.poolSha256, pins.poolBytes);
  const router = new Contract({ id: pins.router, provider, abi: abi('frontend/src/lib/koindx/periphery-abi.json') });
  const pool = new Contract({ id: pins.pair, provider, abi: abi('frontend/src/lib/koindx/core-abi.json') });
  const launchpad = new Contract({ id: release.contracts.launchpad.address, provider,
    abi: toKoilibAbi(abi('frontend/src/lib/launchpad-abi.json')) });
  const launchResponse = await read(launchpad, 'get_launch', { launchId: pins.launchId });
  const launch = launchResponse.value;
  if (!launch) throw new Error('Preserved production launch is missing');
  const pair = await read(router, 'get_pair', { tokenA: 'koin', tokenB: pins.token });
  const reversePair = await read(router, 'get_pair', { tokenA: pins.token, tokenB: 'koin' });
  const tokens = await read(pool, 'get_tokens');
  const balance = await read(pool, 'balance_of', { owner: release.contracts.launchpad.address });
  // Nested protobuf defaults are not restored by decodeState's top-level merge.
  // Normalize the launch message itself before checking its boolean fields.
  const normalizedLaunch = await decodeState(launchpad.serializer,
    await launchpad.serializer.serialize(launch, 'launchpad.launch_object'), 'launchpad.launch_object');
  verifyPair({ launch: normalizedLaunch, pair, reversePair, tokens, balance });
  const config = await read(router, 'get_config');
  const reserves = await read(pool, 'get_reserves');
  const endRouterMetadata = await metadata(provider, pins.router);
  const endPoolMetadata = await metadata(provider, pins.pair);
  if (JSON.stringify(routerMetadata) !== JSON.stringify(endRouterMetadata) ||
      JSON.stringify(poolMetadata) !== JSON.stringify(endPoolMetadata)) throw new Error('Contract metadata changed during capture');
  const end = await provider.getHeadInfo();
  return { schemaVersion: 1, capturedAt: new Date().toISOString(), endpoint, chainId,
    heads: { start, end },
    consistency: 'Current-head RPC observations, not an atomic state export or historical state proof. Recheck at the release boundary.',
    sourceBuild: { file: path.relative(root, buildFile), sha256: hash(buildBytes),
      core: manifest.sources.core.commit, periphery: manifest.sources.periphery.commit },
    router: { address: pins.router, bytecode: routerCode, metadata: routerMetadata,
      sourceBuildMatches: true, metadataStableDuringCapture: true, config },
    existingPool: { address: pins.pair, metadata: poolMetadata, metadataMatchesSourceBuild: true,
      bytecode: poolBytecode, bytecodeReadError: poolCodeReadError || null,
      directBytecodeVerified: !!poolBytecode, metadataStableDuringCapture: true,
      pair, reversePair, tokens, reserves, lpBalance: balance.value },
    preservedClaim: { launchId: normalizedLaunch.id, pair: normalizedLaunch.pair,
      creator: normalizedLaunch.creator, lpAmount: normalizedLaunch.lpAmount,
      lpUnlockTime: normalizedLaunch.lpUnlockTime, lpClaimed: normalizedLaunch.lpClaimed, covered: true },
    productionRouterIdentityVerified: true, atomicReplayComplete: false, readyToBroadcast: false,
    limitations: [
      'Router source and flags match the isolated official-source rehearsal; this is identity verification, not an independent security audit.',
      ...(poolCodeReadError ? ['The existing pool matches the pinned build through its on-chain metadata hash; direct pool-bytecode retrieval exceeded this RPC result buffer.'] : []),
      'This covers the existing launch 4 pair and current router configuration, not every KoinDX pool or future upgrades.',
      'Router upload authority remains under its account authority; refresh code and flags at the upgrade boundary.',
      'Atomic production-state replay and deployed keeper/wallet integration require separate evidence.',
    ] };
}

async function main() {
  const [output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: node scripts/router-attestation.js OUTPUT.json (KOINOS_RPC optional)');
  const endpoint = process.env.KOINOS_RPC || 'https://api.koinosblocks.com';
  const report = await attestRouter(readOnlyProvider(endpoint), endpoint);
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Production router identity verified; saved ${output}`);
  if (!report.existingPool.directBytecodeVerified) console.log('Pool verified through metadata hash; direct-bytecode RPC buffer limitation recorded.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
