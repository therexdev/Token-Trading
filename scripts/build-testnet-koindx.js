// Reproducible, isolated source build. This script never loads keys or sends RPCs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, digest } from './rehearsal-build.js';

export const sources = Object.freeze({
  core: { repository: 'https://github.com/koindx/v2-core.git', commit: '2ac84216015dc54e007766787d57a06dbe3140b6', proto: 'core' },
  periphery: { repository: 'https://github.com/koindx/v2-periphery.git', commit: 'b4a73401bcf0aed293ec46ed6fba295b1830c507', proto: 'periphery' },
});
const workspace = path.join(root, '.testnet-native');
const sourceRoot = path.join(workspace, 'koindx-sources');
const buildRoot = path.join(workspace, 'koindx-build');
const protocSpec = Object.freeze({ version: '3.20.3', archiveSha256: '44a6b498e996b845edef83864734c0e52f42197e85c9d567af55f4e3ff09d755',
  url: 'https://github.com/protocolbuffers/protobuf/releases/download/v3.20.3/protoc-3.20.3-linux-x86_64.zip' });
const run = (program, args, cwd, extra = {}) => execFileSync(program, args, { cwd, stdio: 'inherit', ...extra });
const git = (cwd, ...args) => execFileSync('git', args, { cwd });

function checkout(name, spec) {
  fs.mkdirSync(sourceRoot, { recursive: true });
  const directory = path.join(sourceRoot, name);
  if (!fs.existsSync(path.join(directory, '.git'))) {
    run('git', ['clone', '--no-checkout', spec.repository, directory], root);
  }
  if (git(directory, 'remote', 'get-url', 'origin').toString().trim() !== spec.repository) throw new Error(`Unexpected ${name} origin`);
  try { git(directory, 'cat-file', '-e', `${spec.commit}^{commit}`); }
  catch { run('git', ['fetch', '--depth', '1', 'origin', spec.commit], directory); }
  // Read every file from the pinned object, so an existing dirty checkout cannot
  // silently change the build. No git reset or checkout overwrites local work.
  const files = git(directory, 'ls-tree', '-rz', '--name-only', spec.commit).toString().split('\0').filter(Boolean);
  const output = path.join(buildRoot, name);
  fs.mkdirSync(output, { recursive: true });
  const hashes = {};
  for (const file of files) {
    if (path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Unsafe upstream path');
    const bytes = git(directory, 'show', `${spec.commit}:${file}`);
    const target = path.join(output, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    hashes[file] = digest(bytes);
  }
  return { directory, output, hashes };
}

function dependencies(target) {
  // Yarn's frozen lock resolves the historical AssemblyScript / SDK toolchain.
  // Dependency lifecycle scripts are intentionally disabled.
  run('npm', ['exec', '--yes', '--package=yarn@1.22.22', '--', 'yarn', 'install', '--frozen-lockfile', '--ignore-scripts', '--non-interactive'], target);
  // protobufjs 6's CLI otherwise installs missing development dependencies
  // dynamically on first invocation. Supply a separate locked, scripts-disabled
  // dependency set before allowing either generator to execute.
  const cli = path.join(target, 'node_modules/protobufjs/cli');
  for (const name of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(root, 'scripts/koindx-toolchain', `protobuf-cli-${name}`), path.join(cli, name));
  }
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], cli);
}

function prepareProtoc() {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Pinned KoinDX test build currently requires Linux x86_64 (WSL is supported)');
  const archive = path.join(workspace, `koindx-protoc-${protocSpec.version}.zip`);
  if (!fs.existsSync(archive)) run('curl', ['--fail', '--location', '--retry', '2', '--connect-timeout', '15', '--max-time', '90', protocSpec.url, '-o', archive], root);
  if (digest(fs.readFileSync(archive)) !== protocSpec.archiveSha256) throw new Error('Protoc release archive hash mismatch');
  const directory = path.join(workspace, 'koindx-toolchain', `protoc-${protocSpec.version}`);
  fs.mkdirSync(directory, { recursive: true });
  run('unzip', ['-oq', archive, '-d', directory], root);
  return path.join(directory, 'bin', 'protoc');
}

function compile(target, proto, protoc) {
  const bin = name => path.join(target, 'node_modules/.bin', name);
  const env = { ...process.env, PATH: `${path.dirname(protoc)}${path.delimiter}${path.join(target, 'node_modules/.bin')}${path.delimiter}${process.env.PATH}` };
  fs.mkdirSync(path.join(target, 'abi'), { recursive: true });
  run(protoc, [`--plugin=protoc-gen-abi=${bin('koinos-abi-proto-gen')}`, '--abi_out=abi/', `assembly/proto/${proto}.proto`], target, { env });
  const protos = fs.readdirSync(path.join(target, 'assembly/proto')).filter(f => f.endsWith('.proto')).sort().map(f => `assembly/proto/${f}`);
  run(protoc, [`--plugin=protoc-gen-as=${bin('as-proto-gen')}`, '--as_out=.', ...protos], target, { env });
  run(protoc, [`--plugin=protoc-gen-as=${bin('koinos-as-gen')}`, '--as_out=assembly/', `assembly/proto/${proto}.proto`], target, { env });
  // Same historical compiler and release target as upstream, with its
  // explicit-start option required by the current Koinos WASM entrypoint.
  run(process.execPath, [path.join(target, 'node_modules/assemblyscript/bin/asc'), 'assembly/index.ts', '--target', 'release',
    '--use', 'abort=', '--use', 'BUILD_FOR_TESTING=0', '--disable', 'sign-extension', '--explicitStart', '--config', 'asconfig.json'], target, { env });
  const file = path.join(target, 'build/release/contract.wasm');
  const bytes = fs.readFileSync(file);
  const module = new WebAssembly.Module(bytes);
  const generatedSourceHashes = {};
  const inspect = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(filename);
      else if (entry.isFile() && filename.endsWith('.ts')) generatedSourceHashes[path.relative(target, filename)] = digest(fs.readFileSync(filename));
    }
  };
  inspect(path.join(target, 'assembly'));
  return { file: path.relative(root, file), bytes: bytes.length, sha256: digest(bytes),
    generatedSourceHashes,
    protobufCliLockSha256: digest(fs.readFileSync(path.join(target, 'node_modules/protobufjs/cli/package-lock.json'))),
    exports: WebAssembly.Module.exports(module), imports: WebAssembly.Module.imports(module),
    toolchain: Object.fromEntries(['assemblyscript', '@koinos/sdk-as', '@koinos/sdk-as-cli', '@koinos/as-proto-gen', '@koinos/as-gen', '@koinos/abi-proto-gen', 'protobufjs'].map(name => [name, JSON.parse(fs.readFileSync(path.join(target, 'node_modules', name, 'package.json'))).version])) };
}

export function buildTestnetKoindx({ install = true } = {}) {
  const stateFile = path.join(workspace, 'state.json');
  if (fs.existsSync(stateFile) && JSON.parse(fs.readFileSync(stateFile)).koindx) {
    throw new Error('KoinDX extension is already initialized; restore its pinned build instead of overwriting the saved manifest');
  }
  const protoc = prepareProtoc();
  const manifest = { schemaVersion: 1, testOnly: true, mainnetReady: false, createdAt: new Date().toISOString(),
    purpose: 'Isolated official-source KoinDX router and pool integration on current Harbinger',
    sources: {}, artifacts: {}, substitutions: [], protoc: protocSpec,
    buildAdaptations: ['Pinned protoc 3.20.3; upstream wrapper otherwise downloads an unpinned latest protoc.', 'Historical AssemblyScript --explicitStart exports _start for the current Koinos runtime.'],
    limitations: ['Source-derived upstream contracts; this is not proof of a byte-for-byte reproduction of the live mainnet KoinDX deployment.',
      'The generated manifest states whether the compiled pool matches the original upstream router hash pin.',
      'Successful compilation does not establish live pool creation, liquidity delivery, or security review.'] };
  for (const [name, spec] of Object.entries(sources)) {
    const artifactName = name === 'core' ? 'pool' : 'router';
    const { output, hashes } = checkout(name, spec);
    manifest.sources[name] = { ...spec, hashes, upstreamLockSha256: hashes['yarn.lock'] };
    if (name === 'periphery') {
      const constant = path.join(output, 'assembly/Contants.ts');
      const original = fs.readFileSync(constant, 'utf8');
      const pattern = /export const HASH_BYTECODE: u8\[\] = \[[^\]]+\];/g;
      if ([...original.matchAll(pattern)].length !== 1) throw new Error('Expected one upstream pool hash pin');
      const multihash = [18, 32, ...Buffer.from(manifest.artifacts.pool.sha256, 'hex')];
      const upstreamPin = original.match(pattern)[0].match(/= \[([^\]]+)\]/)[1].split(',').map(value => Number(value.trim()));
      manifest.poolHashPin = { upstream: Buffer.from(upstreamPin).toString('hex'), compiled: Buffer.from(multihash).toString('hex'), matchesUpstream: Buffer.from(upstreamPin).equals(Buffer.from(multihash)) };
      if (!manifest.poolHashPin.matchesUpstream) {
        throw new Error('Compiled pool differs from the original upstream router pin; inspect the build toolchain before proceeding');
      }
    }
    if (install) dependencies(output);
    if (digest(fs.readFileSync(path.join(output, 'yarn.lock'))) !== hashes['yarn.lock']) throw new Error('Pinned dependency lock changed');
    const artifact = compile(output, spec.proto, protoc);
    const artifactFile = path.join(buildRoot, `${artifactName}.wasm`);
    fs.copyFileSync(path.join(root, artifact.file), artifactFile);
    artifact.file = path.relative(root, artifactFile);
    manifest.artifacts[artifactName] = artifact;
    const abiFile = path.join(output, 'abi', `${spec.proto}-abi.json`);
    if (!fs.existsSync(abiFile)) throw new Error(`Missing generated ${name} ABI`);
    const publicAbi = path.join(buildRoot, `${artifactName}-abi.json`);
    fs.copyFileSync(abiFile, publicAbi);
    artifact.abi = { file: path.relative(root, publicAbi), sha256: digest(fs.readFileSync(publicAbi)) };
    fs.writeFileSync(path.join(buildRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  const evidence = path.join(root, 'docs/release-evidence/koindx-source-build-2026-10-06.json');
  fs.writeFileSync(evidence, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = buildTestnetKoindx({ install: !process.argv.includes('--skip-install') });
  console.log(JSON.stringify({ testOnly: true, artifacts: manifest.artifacts }, null, 2));
}
