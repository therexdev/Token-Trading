#!/usr/bin/env node
// Read-only source verification. Never uploads or invokes a contract.
// Uses the historical, committed generated TypeScript; does not regenerate it.
// Usage: node scripts/verify-launchpad-provenance.js [--report FILE] [--fixture FILE]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCommit = '165d311f7065d45177be5289110e3a3e3d2e5d1a';
const rehearsalBaseline = '9b3fdbfed4ac348c8ea8e2e34b82623f719b3975';
const expectedSha256 = '2aa1b55a81eede98a55bffe5a7b9ff0c4908fef01a5b523ced3ab893d6ccf117';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root });
const sourceAt = (commit, name) => git('show', `${commit}:${name}`);

function run() {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!['--report', '--fixture'].includes(key) || !process.argv[i + 1] || options[key]) {
      throw new Error('Usage: node scripts/verify-launchpad-provenance.js [--report FILE] [--fixture FILE]');
    }
    options[key] = path.resolve(process.argv[i + 1]);
  }
  const fixturePath = options['--fixture'] || path.join(root, 'security-tests/fixtures/launchpad-mainnet-before-security.wasm');
  const fixture = fs.readFileSync(fixturePath);
  if (sha256(fixture) !== expectedSha256) throw new Error('Historical launchpad fixture does not match the pinned mainnet SHA-256');

  const originalLock = sourceAt(sourceCommit, 'launchpad/package-lock.json');
  const lock = JSON.parse(originalLock);
  const dependencies = path.join(root, 'launchpad/node_modules');
  const toolchain = {};
  // Compiler, its optimizer, MVP lowering, and AssemblyScript source libraries.
  for (const name of ['assemblyscript', 'assemblyscript/node_modules/binaryen', 'long', 'binaryen',
    '@koinos/sdk-as', '@koinos/proto-as', 'as-proto', 'as-bignum']) {
    const locked = lock.packages[`node_modules/${name}`];
    if (!locked) throw new Error(`Historical lockfile lacks ${name}`);
    const installed = JSON.parse(fs.readFileSync(path.join(dependencies, name, 'package.json')));
    if (installed.version !== locked.version) {
      throw new Error(`Toolchain mismatch for ${name}: installed ${installed.version}, historical ${locked.version}`);
    }
    toolchain[name] = { version: locked.version, lockfileIntegrity: locked.integrity };
  }

  const parent = path.join(root, '.testnet-rehearsal/provenance');
  fs.mkdirSync(parent, { recursive: true });
  const work = fs.mkdtempSync(path.join(parent, 'verified-'));
  const sourceHashes = {};
  const files = ['assembly/index.ts', 'assembly/Launchpad.ts', 'assembly/proto/launchpad.ts',
    'assembly/proto/launchpad.proto', 'asconfig.json', 'build.js', 'package-lock.json'];
  for (const name of files) {
    const original = sourceAt(sourceCommit, `launchpad/${name}`);
    if (!original.equals(sourceAt(rehearsalBaseline, `launchpad/${name}`))) {
      throw new Error(`Rehearsal baseline changed historical build input: ${name}`);
    }
    const target = path.join(work, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, original);
    sourceHashes[`launchpad/${name}`] = sha256(original);
  }

  const output = path.join(work, 'contract.wasm');
  const temporary = path.join(work, 'contract.unoptimized.wasm');
  const compilerArgs = [path.join(dependencies, 'assemblyscript/bin/asc'), 'assembly/index.ts',
    '--config', 'asconfig.json', '--target', 'release', '--outFile', temporary,
    '--textFile', path.join(work, 'contract.wat'), '--sourceMap', path.join(work, 'contract.map'),
    '--use', 'abort=', '--use', 'BUILD_FOR_TESTING=0', '--exportStart', '_start',
    '--disable', 'sign-extension,bulk-memory,nontrapping-f2i,multi-value', '--path', dependencies];
  const loweringArgs = [path.join(dependencies, 'binaryen/bin/wasm-opt'), temporary, '-all',
    '--llvm-memory-copy-fill-lowering', '--signext-lowering', '--llvm-nontrapping-fptoint-lowering',
    '-O1', '--mvp-features', '--strip-debug', '--strip-producers', '-o', output];
  execFileSync(process.execPath, compilerArgs, { cwd: work, stdio: 'pipe' });
  execFileSync(process.execPath, loweringArgs, { cwd: work, stdio: 'pipe' });
  const rebuilt = fs.readFileSync(output);
  if (!rebuilt.equals(fixture)) {
    throw new Error(`Historical rebuild mismatch: expected ${expectedSha256}, got ${sha256(rebuilt)} (${rebuilt.length} bytes)`);
  }
  new WebAssembly.Module(rebuilt);
  const report = {
    generatedAt: new Date().toISOString(), command: 'node scripts/verify-launchpad-provenance.js',
    result: 'passed', byteForByteMatch: true, sourceCommit, rehearsalBaseline,
    baselineInputsIdentical: true, contractAddress: '13akLV3xQZdRjdQ2ANYo7cvSsD8qfBZReV',
    historicalSha256: expectedSha256, rebuiltSha256: sha256(rebuilt), bytes: rebuilt.length,
    nodeVersion: process.version, historicalLockfileSha256: sha256(originalLock), sourceHashes, toolchain,
    buildMethod: 'Compile unchanged committed TypeScript using historical asconfig release target and build.js compiler/MVP lowering flags; output paths and dependency search path only are redirected.',
    limits: [
      'Generated dispatcher and protobuf TypeScript are taken verbatim from Git; protoc/ABI generation is not rerun.',
      'The matching binary is the captured pre-security mainnet fixture, not the patched release.',
      'This establishes reproducible source provenance, not an independent security review or mainnet release approval.',
      'No RPC calls, signatures, transactions, or contract uploads are performed.'
    ]
  };
  const reportPath = options['--report'] || path.join(work, 'report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ result: report.result, sha256: expectedSha256, bytes: rebuilt.length,
    sourceCommit, report: path.relative(root, reportPath) }, null, 2));
}

try { run(); } catch (error) {
  console.error(`Launchpad provenance verification failed: ${error.message}`);
  process.exitCode = 1;
}
