// Separate build directories: production sources and production artifacts are never rewritten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const baseCommit = '9b3fdbfed4ac348c8ea8e2e34b82623f719b3975';
export const patchedCommit = 'd0298016557a4a3f9de01b3058ff3e4d5b6673bc';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const work = path.join(root, '.testnet-rehearsal');
export function sourceAt(commit, name) { return execFileSync('git', ['show', `${commit}:${name}`], { cwd: root }); }
export function compile(input, output) {
  const cwd = path.join(root, 'contract');
  const fromContract = createRequire(path.join(cwd, 'package.json'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const unoptimized = output + '.unoptimized';
  execFileSync(process.execPath, [path.join(cwd, 'node_modules/assemblyscript/bin/asc'), input,
    '--config', path.join(cwd, 'asconfig.json'), '--target', 'release', '--outFile', unoptimized,
    '--textFile', output + '.wat', '--sourceMap', output + '.map', '--exportStart', '_start',
    '--use', 'abort=', '--use', 'BUILD_FOR_TESTING=0', '--path', path.join(cwd, 'node_modules'),
    '--disable', 'sign-extension,bulk-memory,nontrapping-f2i,multi-value'], { cwd, stdio: 'pipe' });
  execFileSync(process.execPath, [fromContract.resolve('binaryen/bin/wasm-opt'), unoptimized, '-all',
    '--llvm-memory-copy-fill-lowering', '--signext-lowering', '--llvm-nontrapping-fptoint-lowering',
    '-O1', '--mvp-features', '--strip-debug', '--strip-producers', '-o', output], { cwd, stdio: 'pipe' });
  fs.unlinkSync(unoptimized);
  new WebAssembly.Module(fs.readFileSync(output));
  return { sha256: digest(fs.readFileSync(output)), bytes: fs.statSync(output).size };
}
export function buildRehearsal(config, directory = path.join(work, 'build')) {
  fs.mkdirSync(directory, { recursive: true });
  const manifest = { testOnly: true, baseCommit, patchedCommit, addresses: config.addresses, artifacts: {}, sources: {} };
  for (const [name, folder, cls] of [['orderbook', 'contract', 'Orderbook'], ['launchpad', 'launchpad', 'Launchpad']]) {
    for (const [version, commit] of [['before', baseCommit], ['after', patchedCommit]]) {
      const target = path.join(directory, `${name}-${version}`); fs.mkdirSync(path.join(target, 'proto'), { recursive: true });
      for (const file of ['index.ts', `${cls}.ts`, `proto/${name}.ts`]) {
        const original = sourceAt(commit, `${folder}/assembly/${file}`);
        let content = original.toString();
        if (name === 'launchpad' && file === 'Launchpad.ts') {
          for (const [old, replacement] of [['19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK', config.addresses.quote],
            ['17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s', config.addresses.router]]) {
            if (content.split(`"${old}"`).length !== 2) throw new Error('Expected exactly one network constant');
            content = content.replace(`"${old}"`, `"${replacement}"`);
          }
        }
        fs.writeFileSync(path.join(target, file), content);
        manifest.sources[`${name}-${version}/${file}`] = { original: digest(original), test: digest(content) };
      }
      const key = `${name}-${version}`, output = path.join(directory, `${key}.wasm`);
      manifest.artifacts[key] = compile(path.join(target, 'index.ts'), output);
    }
  }
  const fixtureDir = path.join(directory, 'fixture'); fs.mkdirSync(path.join(fixtureDir, 'proto'), { recursive: true });
  const fixture = fs.readFileSync(path.join(root, 'security-tests/testnet/Fixture.ts'), 'utf8').replace('__REHEARSAL_QUOTE__', config.addresses.quote);
  fs.writeFileSync(path.join(fixtureDir, 'index.ts'), fixture);
  fs.writeFileSync(path.join(fixtureDir, 'proto/launchpad.ts'), sourceAt(patchedCommit, 'launchpad/assembly/proto/launchpad.ts'));
  manifest.artifacts.fixture = compile(path.join(fixtureDir, 'index.ts'), path.join(directory, 'fixture.wasm'));
  const release = JSON.parse(fs.readFileSync(path.join(root, 'scripts/security-release.json')));
  for (const version of ['before', 'after']) {
    const expected = version === 'before' ? release.contracts.orderbook.previousSha256 : release.contracts.orderbook.sha256;
    if (manifest.artifacts[`orderbook-${version}`].sha256 !== expected) throw new Error(`Orderbook ${version} differs from pinned mainnet binary`);
  }
  manifest.limitations = ['Launchpad has two test-only address substitutions: payment fixture and router fixture.',
    'Historical launchpad source baseline is pinned but exact historical live binary provenance remains unverified.',
    'Router fixture is not KoinDX; native KOIN, keeper, wallet integrations and seven-day liquidity reclamation need separate coverage.',
    'Synthetic funded scenarios do not replace a complete production-state export rehearsal.'];
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
