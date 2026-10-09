// Opt-in Harbinger candidate rehearsal. The original native checkpoint is read
// only; all new keys, signed transactions and receipts stay in a separate dir.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Contract, Serializer, Signer, utils } from 'koilib';
import { root, compile, digest } from './rehearsal-build.js';
import { HARBINGER, HARBINGER_RPC, assertChain, checkNetwork, sameChain, providerFor,
  executeTransaction, save, publicReport, reconcileResourceRejection, findReceipt } from './rehearsal-core.js';
import { RpcRejection } from './rehearsal-core.js';
import { toKoilibAbi } from './abi-utils.js';

export const directory = path.join(root, '.testnet-liquidity');
const manifestFile = path.join(root, 'docs/release-evidence/launchpad-liquidity-candidate-2026-10-09.json');
const UNIT = 100000000n;
export const CANDIDATE_SHA = 'd6bcf48764ff2fa2ab42050af600a881ed5fe363843ed4c9ba53d148c6a3309d';
export const CASES = Object.freeze([
  { id: 1, name: 'excess fixture tokens', liquidityTokens: '10100000', usedNative: '5000000', usedBase: '10000000', refundNative: '0', refundBase: '100000' },
  { id: 2, name: 'excess native KOIN', liquidityTokens: '9900000', usedNative: '4950000', usedBase: '9900000', refundNative: '50000', refundBase: '0' },
]);
const limitations = ['Unapproved launchpad candidate, with only native-token/router address substitutions for Harbinger.',
  'Uses real native KOIN and official-source pre-existing pool; fixture sale token has no allowance reader.',
  'Original launch 3 and original launchpad balances must remain unchanged.',
  'Does not replace independent security review or full atomic production-state replay.',
  'Does not change the original candidate seven-day reclaim test or establish this candidate elapsed seven-day evidence.'];
const metadataCodec = new Serializer({ nested: { Address: { fields: { value: { type: 'bytes', id: 1 } } }, Metadata: { fields: {
  hash: { type: 'bytes', id: 1 }, system: { type: 'bool', id: 2 }, authorizesCall: { type: 'bool', id: 3 },
  authorizesTransaction: { type: 'bool', id: 4 }, authorizesUpload: { type: 'bool', id: 5 },
} } } });
const json = file => JSON.parse(fs.readFileSync(file));
const launchAbi = () => toKoilibAbi(json(path.join(root, 'frontend/src/lib/launchpad-abi.json')));
const u = value => {
  assert.match(String(value ?? '0'), /^(0|[1-9][0-9]*)$/);
  const n = BigInt(value ?? '0'); assert.ok(n <= (1n << 64n) - 1n); return n;
};

export function dependencyReads(provider, fixtureAddress) {
  const fixture = new Contract({ id: fixtureAddress, provider, abi: utils.tokenAbi });
  return {
    nativeAddress: async () => {
      const response = await provider.readContract({ contract_id: fixtureAddress, entry_point: 0x10000004, args: '' });
      const decoded = await metadataCodec.deserialize(response.result, 'Address');
      assert.ok(decoded?.value, 'Native-name resolver returned no address');
      return utils.encodeBase58(Buffer.from(decoded.value, 'base64url'));
    },
    metadata: async address => {
      const { operation } = await fixture.functions.balanceOf({ owner: address }, { onlyOperation: true });
      try {
        const response = await provider.readContract({ contract_id: fixtureAddress, entry_point: 0x10000003, args: operation.call_contract.args });
        assert.ok(response.result, 'Fixture returned empty metadata');
        return metadataCodec.deserialize(response.result, 'Metadata');
      } catch (error) {
        if (error instanceof RpcRejection && /fixture: contract metadata missing/.test(error.message)) return null;
        throw error;
      }
    },
  };
}

export function verifiedReceipt(block, entry) {
  assert.equal(block?.block_id, entry.evidence.blockId, 'Transaction block changed');
  assert.equal(block?.block?.id, block.block_id, 'Block ID mismatch');
  assert.equal(block?.receipt?.id, block.block_id, 'Block receipt ID mismatch');
  assert.equal(String(block.block_height), String(entry.evidence.height), 'Block height mismatch');
  assert.equal(String(block.block.header?.height), String(entry.evidence.height), 'Block header height mismatch');
  assert.ok(Array.isArray(block.block.transactions)); assert.ok(Array.isArray(block.receipt.transaction_receipts));
  assert.equal(block.block.transactions.filter(t => t.id === entry.id).length, 1, 'Missing or duplicate transaction');
  const receipts = block.receipt.transaction_receipts.filter(r => r.id === entry.id);
  assert.equal(receipts.length, 1, 'Missing or duplicate transaction receipt');
  const receipt = receipts[0];
  assert.ok(receipt.reverted === undefined || receipt.reverted === false, 'Reverted or malformed transaction receipt');
  return receipt;
}

export const mayAttemptEarlyClaim = (chainTime, due) => Number.isSafeInteger(chainTime) && Number.isSafeInteger(due) && due - chainTime >= 60000;

export function reconciledResourceArchive(entry, journal) {
  const r = entry.reconciliation;
  let error, detail;
  try { error = JSON.parse(entry.submissionError); detail = typeof error.data === 'string' ? JSON.parse(error.data) : error.data; } catch { return false; }
  return entry.status === 'rejected' && entry.outcome === 'node-rejected-resource-budget' && !entry.expectedError &&
    error.message === 'insufficient pending account resources' && detail?.code === 104 &&
    r?.included === false && r?.transactionStoreFound === false &&
    /^(0|[1-9][0-9]*)$/.test(String(r.lastIrreversibleBlock)) &&
    Number.isSafeInteger(entry.startHeight) && BigInt(r.lastIrreversibleBlock) >= BigInt(entry.startHeight) &&
    r.nextNonce === entry.transaction?.header?.nonce &&
    Object.values(journal).some(replacement => replacement.replaces === entry.id && replacement.transaction?.header?.nonce === r.nextNonce);
}

export function assertNoOtherUnresolved(state, label) {
  for (const [savedLabel, entry] of Object.entries(state.journal || {})) {
    if (savedLabel !== label && ['pending', 'retry-ready', 'failed'].includes(entry.status)) {
      throw new Error(`Resolve saved ${savedLabel} (${entry.id}) before preparing ${label}; no new transaction may reuse an unresolved payer nonce`);
    }
  }
}

export async function reconcilePending(state, persist, readReceipt) {
  // A timed early-claim branch may no longer run after unlock. Reconcile its
  // saved ID here before any newly eligible claim or later case can submit.
  for (const [label, entry] of Object.entries(state.journal || {})) {
    if (entry.status === 'failed') throw new Error(`Previously failed ${label}; review its receipt before proceeding`);
    if (entry.status !== 'pending') continue;
    const evidence = await readReceipt(entry);
    if (!evidence) throw new Error(`Saved ${label} remains unresolved (${entry.id}); only receipt checks are permitted`);
    const receipt = evidence.receipt;
    const typedFlag = receipt?.reverted === undefined || typeof receipt?.reverted === 'boolean';
    const reason = Array.isArray(receipt?.logs) ? receipt.logs.join('\n') : '';
    const passed = receipt?.id === entry.id && typedFlag && (entry.expectedError
      ? receipt.reverted === true && new RegExp(entry.expectedError).test(reason)
      : receipt.reverted !== true);
    entry.evidence = evidence; entry.status = passed ? 'passed' : 'failed';
    entry.outcome = receipt?.reverted === true ? 'reverted' : 'included'; persist();
    if (!passed) throw new Error(`Saved ${label} has an unexpected or malformed receipt; review before proceeding`);
  }
}

export function verifyCandidateFiles(expectedManifestHash) {
  const bytes = fs.readFileSync(manifestFile), manifest = JSON.parse(bytes);
  if (expectedManifestHash) assert.equal(digest(bytes), expectedManifestHash, 'Candidate review manifest changed');
  assert.equal(manifest.sha256, CANDIDATE_SHA, 'Candidate production hash changed');
  for (const [file, expected] of Object.entries(manifest.sourceFiles)) assert.equal(digest(fs.readFileSync(path.join(root, file))), expected, `Candidate source changed: ${file}`);
  assert.equal(digest(fs.readFileSync(path.join(root, manifest.wasm))), CANDIDATE_SHA, 'Candidate production artifact changed');
  return { manifest, sha256: digest(bytes) };
}

export function liquidityAccounting(reserves, supply, desiredNative, desiredBase) {
  const a = u(reserves.reserveA), b = u(reserves.reserveB), s = u(supply), da = u(desiredNative), db = u(desiredBase);
  assert.ok(a > 0n && b > 0n && s > 0n, 'An existing funded pool is required');
  assert.equal(b, a * 2n, 'Expected exact existing pool ratio of two fixture units per native unit');
  // Every prior operation here is a proportional liquidity mint with no swap;
  // this precondition rules out a fee mint changing the LP denominator.
  assert.equal(BigInt(reserves.kLast || '0'), a * b, 'Pool protocol-fee growth requires separate accounting');
  const optimalBase = da * b / a;
  const usedNative = optimalBase <= db ? da : db * a / b;
  const usedBase = optimalBase <= db ? optimalBase : db;
  const mintA = usedNative * s / a, mintB = usedBase * s / b;
  const lp = mintA < mintB ? mintA : mintB;
  assert.ok(lp > 0n && usedNative * 10000n >= da * 9800n && usedBase * 10000n >= db * 9800n);
  return { usedNative, usedBase, refundNative: da - usedNative, refundBase: db - usedBase, lp };
}

export async function assertCandidateOperations(operations, state, label) {
  assertChain(state.chainId, HARBINGER);
  assert.notEqual(state.addresses.launchpad, state.originalLaunchpad, 'Never target the original launchpad');
  const tokenCodec = new Serializer(utils.tokenAbi.koilib_types), lpAbi = launchAbi(), lpCodec = new Serializer(lpAbi.koilib_types);
  let contribution = 0n;
  const count = async op => {
    if (op.call_contract?.contract_id === state.addresses.launchpad && op.call_contract.entry_point === lpAbi.methods.contribute.entry_point) {
      contribution += u((await lpCodec.deserialize(op.call_contract.args, lpAbi.methods.contribute.argument)).amount);
    }
  };
  for (const [savedLabel, entry] of Object.entries(state.journal || {})) {
    if (savedLabel === label && JSON.stringify(entry.transaction?.operations) === JSON.stringify(operations)) continue;
    if (reconciledResourceArchive(entry, state.journal)) continue;
    for (const operation of entry.transaction?.operations || []) await count(operation);
  }
  const caseSpec = CASES.find(c => label.startsWith(`case-${c.id}-`));
  for (const operation of operations) {
    assert.equal(Object.keys(operation).length, 1);
    if (operation.upload_contract) {
      const upload = operation.upload_contract;
      assert.equal(label, 'upload-candidate'); assert.equal(operations.length, 1);
      assert.equal(upload.contract_id, state.addresses.launchpad);
      assert.equal(digest(Buffer.from(upload.bytecode, 'base64url')), state.testArtifactSha256);
      assert.equal(upload.authorizes_call_contract, false); assert.equal(upload.authorizes_transaction_application, false); assert.equal(upload.authorizes_upload_contract, false);
      continue;
    }
    const call = operation.call_contract; assert.ok(call, 'Only candidate calls/uploads are allowed');
    if ([state.nativeToken, state.addresses.base].includes(call.contract_id)) {
      assert.equal(label, 'bounded-allowances'); assert.equal(call.entry_point, utils.tokenAbi.methods.approve.entry_point, 'No transfers, mint or extra token methods');
      const args = await tokenCodec.deserialize(call.args, utils.tokenAbi.methods.approve.argument);
      assert.equal(args.spender, state.addresses.launchpad);
      const native = call.contract_id === state.nativeToken;
      assert.equal(args.owner, native ? state.addresses.buyer : state.addresses.owner);
      assert.equal(u(args.value), native ? 20000000n : UNIT);
      continue;
    }
    assert.equal(call.contract_id, state.addresses.launchpad, 'No original contract/router/pool mutations');
    assert.ok(caseSpec, 'Unknown candidate case label');
    const method = Object.entries(lpAbi.methods).find(([, m]) => m.entry_point === call.entry_point)?.[0];
    assert.ok(['create_launch', 'contribute', 'finalize', 'process', 'provide_liquidity', 'claim_liquidity'].includes(method), 'Candidate method forbidden');
    const args = await lpCodec.deserialize(call.args, lpAbi.methods[method].argument);
    if (method === 'create_launch') {
      assert.equal(label, `case-${caseSpec.id}-settlement`);
      assert.equal(args.creator, state.addresses.owner); assert.equal(args.token, state.addresses.base);
      assert.equal(u(args.price), UNIT); assert.equal(u(args.forSaleAmount), 10000000n);
      assert.equal(args.liquidityBps, 5000); assert.equal(args.liquidityTokens, caseSpec.liquidityTokens);
      for (const field of ['mode', 'lockedAmount', 'unlockTime', 'softCap', 'hardCap', 'unsoldAction']) assert.equal(u(args[field]), 0n);
      const schedule = state.schedules[caseSpec.id]; assert.ok(schedule);
      assert.equal(args.startTime, schedule.start); assert.equal(args.endTime, schedule.end); assert.equal(args.lpUnlockTime, schedule.end);
    } else {
      assert.equal(args.launchId, caseSpec.id);
      if (method === 'contribute') {
        assert.equal(label, `case-${caseSpec.id}-settlement`); assert.equal(args.buyer, state.addresses.buyer); assert.equal(u(args.amount), 10000000n);
      } else if (['finalize', 'process'].includes(method)) {
        assert.equal(label, `case-${caseSpec.id}-settlement`); if (method === 'process') assert.equal(args.limit, 1);
      } else if (method === 'provide_liquidity') assert.equal(label, `case-${caseSpec.id}-liquidity`);
      else assert.ok([`case-${caseSpec.id}-early-claim`, `case-${caseSpec.id}-claim`, `case-${caseSpec.id}-duplicate-claim`].includes(label));
    }
    await count(operation);
  }
  assert.ok(contribution <= 20000000n, 'Total candidate buyer spend exceeds 0.2 tKOIN');
}

function buildCandidate(state, candidate) {
  const build = path.join(directory, 'build'), production = path.join(build, 'production');
  fs.mkdirSync(path.join(production, 'proto'), { recursive: true });
  for (const file of ['index.ts', 'Launchpad.ts', 'proto/launchpad.ts']) fs.copyFileSync(path.join(root, 'launchpad/assembly', file), path.join(production, file));
  const productionArtifact = compile(path.join(production, 'index.ts'), path.join(build, 'production-check.wasm'));
  assert.equal(productionArtifact.sha256, CANDIDATE_SHA, 'Candidate compiler does not reproduce the production pin');
  const testDir = path.join(build, 'test'); fs.mkdirSync(path.join(testDir, 'proto'), { recursive: true });
  const sources = {};
  for (const file of ['index.ts', 'Launchpad.ts', 'proto/launchpad.ts']) {
    const original = fs.readFileSync(path.join(production, file)); let content = original.toString();
    if (file === 'Launchpad.ts') for (const [from, to] of [['19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK', state.nativeToken], ['17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s', state.addresses.router]]) {
      assert.equal(content.split(`"${from}"`).length, 2); content = content.replace(`"${from}"`, `"${to}"`);
    }
    fs.writeFileSync(path.join(testDir, file), content); sources[file] = { original: digest(original), test: digest(content) };
  }
  const artifact = compile(path.join(testDir, 'index.ts'), path.join(build, 'candidate.wasm'));
  return { testOnly: true, candidateManifestSha256: candidate.sha256, productionSha256: CANDIDATE_SHA,
    artifacts: { productionCheck: productionArtifact, candidate: artifact }, sources, limitations };
}

async function context(state, provider) {
  const a = state.addresses, c = {};
  for (const role of ['native', 'base', 'pool']) c[role] = new Contract({ id: role === 'native' ? state.nativeToken : a[role], provider, abi: utils.tokenAbi });
  c.launchpad = new Contract({ id: a.launchpad, provider, abi: launchAbi() });
  c.original = new Contract({ id: state.originalLaunchpad, provider, abi: launchAbi() });
  c.router = new Contract({ id: a.router, provider, abi: toKoilibAbi(json(path.join(state.originalDirectory, 'koindx-build/router-abi.json'))) });
  c.poolRead = new Contract({ id: a.pool, provider, abi: toKoilibAbi(json(path.join(state.originalDirectory, 'koindx-build/pool-abi.json'))) });
  const read = async (role, method, args = {}) => (await c[role].functions[method](args)).result;
  const op = async (role, method, args = {}) => (await c[role].functions[method](args, { onlyOperation: true })).operation;
  const balance = async (role, owner) => u((await read(role, 'balanceOf', { owner }))?.value);
  const launch = async (id, role = 'launchpad') => (await read(role, 'get_launch', { launchId: id }))?.value;
  const { metadata, nativeAddress } = dependencyReads(provider, a.base);
  const snapshot = async () => {
    const balances = {};
    for (const token of ['native', 'base', 'pool']) {
      balances[token] = {};
      for (const role of ['buyer', 'owner', 'launchpad', 'router', 'pool']) balances[token][role] = String(await balance(token, a[role]));
      balances[token].original = String(await balance(token, state.originalLaunchpad));
    }
    return { balances, launch3: await launch(3, 'original'), launches: await read('launchpad', 'get_launches', { start: 0, limit: 100 }),
      reserves: await read('poolRead', 'get_reserves'), supply: String((await read('pool', 'totalSupply'))?.value || '0'),
      allowance: String((await read('native', 'allowance', { owner: a.launchpad, spender: a.router }))?.value || '0') };
  };
  const attest = async () => {
    assert.equal(await nativeAddress(), state.nativeToken, 'Native token resolution changed');
    for (const [role, sha, flags, system] of [['base', state.dependencies.baseSha256, false, false], ['router', state.dependencies.routerSha256, false, false], ['pool', state.dependencies.poolSha256, true, false], ['native', state.dependencies.nativeSha256, true, true]]) {
      const m = await metadata(role === 'native' ? state.nativeToken : a[role]); assert.ok(m, `Missing ${role} metadata`);
      assert.equal(Buffer.from(m.hash, 'base64url').toString('hex'), '1220' + sha, `${role} hash changed`);
      assert.equal(!!m.system, system); for (const flag of ['authorizesCall', 'authorizesTransaction', 'authorizesUpload']) assert.equal(!!m[flag], flags);
    }
    assert.equal((await read('router', 'get_pair', { tokenA: 'koin', tokenB: a.base })).value, a.pool);
    const tokens = await read('poolRead', 'get_tokens'); assert.equal(tokens.tokenA, state.nativeToken); assert.equal(tokens.tokenB, a.base);
    // Reject unsupported fee/config/reserve conditions before any deployment,
    // allowance or buyer contribution, rather than after settling a launch.
    const config = await read('router', 'get_config');
    assert.equal(config?.feeOn, true, 'This rehearsal expects the attested fee-on pool configuration');
    const reserves = await read('poolRead', 'get_reserves'), supply = (await read('pool', 'totalSupply'))?.value;
    for (const spec of CASES) {
      const expected = liquidityAccounting(reserves, supply, '5000000', spec.liquidityTokens);
      for (const key of ['usedNative', 'usedBase', 'refundNative', 'refundBase']) assert.equal(String(expected[key]), spec[key]);
    }
    const m = await metadata(a.launchpad);
    if (state.journal['upload-candidate']) {
      if (m) { assert.equal(Buffer.from(m.hash, 'base64url').toString('hex'), '1220' + state.testArtifactSha256); for (const flag of ['system', 'authorizesCall', 'authorizesTransaction', 'authorizesUpload']) assert.equal(!!m[flag], false); }
    } else assert.equal(m, null, 'Fresh candidate address already has code');
  };
  return { read, op, balance, launch, metadata, snapshot, attest };
}

function originalSnapshot(snapshot) { return { launch3: snapshot.launch3, balances: Object.fromEntries(Object.entries(snapshot.balances).map(([token, rows]) => [token, rows.original])) }; }
function delta(after, before, token, role, value) { assert.equal(u(after.balances[token][role]), u(before.balances[token][role]) + value, `${token}/${role} balance delta`); }

export async function main(command = process.argv[2], originalDirectory = process.argv[3]) {
  const stateFile = path.join(directory, 'state.json'), buildFile = path.join(directory, 'build/manifest.json');
  if (command === 'init') {
    assert.ok(originalDirectory && path.isAbsolute(originalDirectory), 'Supply the absolute original .testnet-native directory');
    assert.ok(!fs.existsSync(directory), 'Candidate directory already exists; do not overwrite keys/journal');
    const candidate = verifyCandidateFiles(), original = json(path.join(originalDirectory, 'state.json')), oldKeys = json(path.join(originalDirectory, 'keys.json'));
    assertChain(original.chainId, HARBINGER); assert.ok(original.nativeToken && original.koindx);
    const signer = Signer.fromSeed(randomBytes(32).toString('hex'));
    const keys = { launchpad: signer.getPrivateKey('wif') }, addresses = { ...original.addresses, launchpad: signer.getAddress(), pool: original.addresses.pool };
    for (const role of ['payer', 'owner', 'buyer']) { keys[role] = oldKeys[role]; assert.equal(Signer.fromWif(keys[role]).getAddress(), addresses[role]); }
    const originalBuild = json(path.join(originalDirectory, 'build/manifest.json'));
    const originalFiles = ['state.json', 'keys.json', 'build/manifest.json', 'koindx-build/manifest.json', 'koindx-build/router-abi.json', 'koindx-build/pool-abi.json'];
    const state = { version: 1, kind: 'liquidity-remainder-candidate', testOnly: true, createdAt: new Date().toISOString(), chainId: HARBINGER,
      originalDirectory, originalLaunchpad: original.addresses.launchpad, nativeToken: original.nativeToken, addresses,
      originalFileDigests: Object.fromEntries(originalFiles.map(file => [file, digest(fs.readFileSync(path.join(originalDirectory, file)))])),
      candidateManifestSha256: candidate.sha256, schedules: {}, journal: {}, checks: {}, snapshots: {},
      dependencies: { nativeSha256: Buffer.from(original.nativeMetadata.hash, 'base64url').toString('hex').slice(4), baseSha256: originalBuild.artifacts.fixture.sha256,
        routerSha256: original.koindx.routerSha256, poolSha256: original.koindx.poolSha256 } };
    assert.notEqual(state.addresses.launchpad, state.originalLaunchpad);
    const provider = providerFor(process.env.REHEARSAL_RPC || HARBINGER_RPC); await checkNetwork(provider, HARBINGER);
    await (await context(state, provider)).attest();
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(path.join(directory, 'keys.json'), JSON.stringify(keys, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    const build = buildCandidate(state, candidate); state.testArtifactSha256 = build.artifacts.candidate.sha256;
    save(buildFile, build); save(stateFile, state);
    console.log(`Initialized candidate ${addresses.launchpad}; local builds/read-only attestation only, no transactions.`); return;
  }
  assert.ok(['run', 'resume', 'report', 'finality', 'reconcile-resource'].includes(command), 'Usage: init ABSOLUTE_ORIGINAL_DIR | run | resume | report | finality | reconcile-resource LABEL');
  const state = json(stateFile), manifest = json(buildFile), persist = () => save(stateFile, state);
  const report = () => save(path.join(directory, 'report.json'), { ...publicReport(state, manifest),
    candidateManifestSha256: state.candidateManifestSha256, productionCandidateSha256: CANDIDATE_SHA,
    originalLaunchpad: state.originalLaunchpad, nativeToken: state.nativeToken, schedules: state.schedules, originalPreserved: state.originalPreserved });
  if (command === 'report') { report(); return; }
  if (['run', 'resume', 'reconcile-resource'].includes(command)) for (const [file, expected] of Object.entries(state.originalFileDigests)) {
    assert.equal(digest(fs.readFileSync(path.join(state.originalDirectory, file))), expected, 'Original checkpoint changed; review before any candidate mutation');
  }
  verifyCandidateFiles(state.candidateManifestSha256); assert.equal(digest(fs.readFileSync(path.join(directory, 'build/candidate.wasm'))), state.testArtifactSha256);
  assert.equal(manifest.artifacts.candidate.sha256, state.testArtifactSha256); assertChain(state.chainId, HARBINGER);
  const provider = providerFor(process.env.REHEARSAL_RPC || HARBINGER_RPC); await checkNetwork(provider, HARBINGER);
  const { op, read, balance, launch, metadata, snapshot, attest } = await context(state, provider); await attest();
  const keys = json(path.join(directory, 'keys.json'));
  const tx = async (label, operations, actors = [], expectedError) => {
    assertNoOtherUnresolved(state, label);
    await assertCandidateOperations(operations, state, label);
    return executeTransaction({ provider, state, persist, keys, label, operations, actors, expectedError, rcLimitCap: 5n * UNIT });
  };
  const check = async (name, fn) => {
    if (state.checks[name]?.status === 'passed') return;
    try { const result = await fn(); state.checks[name] = result === false
      ? { status: 'skipped', detail: 'Too close to the actual unlock for a reliable early-rejection test', at: new Date().toISOString() }
      : { status: 'passed', at: new Date().toISOString() }; persist(); report(); }
    catch (e) { state.checks[name] = { status: 'incomplete', detail: e.message }; persist(); report(); throw e; }
  };
  const remember = async name => { if (!state.snapshots[name]) { state.snapshots[name] = await snapshot(); persist(); } return state.snapshots[name]; };
  const preserveOriginal = async () => {
    const current = { launch3: await launch(3, 'original'), balances: {} };
    for (const token of ['native', 'base', 'pool']) current.balances[token] = String(await balance(token, state.originalLaunchpad));
    if (!state.snapshots.original) { state.snapshots.original = current; persist(); }
    assert.deepEqual(current, state.snapshots.original, 'Original launchpad state or balances changed');
    state.originalPreserved = true; persist();
  };
  const finality = async () => {
    const head = await provider.getHeadInfo(); let last = 0, lastBlockId, count = 0, usedMana = 0n;
    for (const entry of Object.values(state.journal).filter(e => e.outcome === 'included')) {
      const [b] = await provider.getBlocks(entry.evidence.height, 1, head.head_topology.id, { returnBlock: true, returnReceipt: true });
      const receipt = verifiedReceipt(b, entry); count++;
      usedMana += u(receipt.rc_used); if (entry.evidence.height >= last) { last = entry.evidence.height; lastBlockId = entry.evidence.blockId; }
    }
    const end = await provider.getHeadInfo(); assert.ok(sameChain(await provider.getChainId(), state.chainId));
    if (lastBlockId) assert.equal((await provider.getBlocks(last, 1, end.head_topology.id, { returnBlock: false, returnReceipt: true }))[0].block_id, lastBlockId);
    state.finality = { canonicalReceiptsVerified: count, lastTransactionHeight: last, lastIrreversibleBlock: end.last_irreversible_block,
      reached: count > 0 && BigInt(end.last_irreversible_block) >= BigInt(last), includedManaUnits: String(usedMana), verifiedAt: new Date().toISOString() }; persist();
  };
  try {
    if (command === 'reconcile-resource') { await reconcileResourceRejection({ provider, state, persist, label: originalDirectory }); return; }
    if (command === 'finality') { await preserveOriginal(); await finality(); return; }
    await reconcilePending(state, persist, entry => findReceipt(provider, entry));
    await preserveOriginal();
    await check('deploy isolated candidate', async () => {
      await tx('upload-candidate', [{ upload_contract: { contract_id: state.addresses.launchpad,
        bytecode: utils.encodeBase64url(fs.readFileSync(path.join(directory, 'build/candidate.wasm'))),
        authorizes_call_contract: false, authorizes_transaction_application: false, authorizes_upload_contract: false } }], ['launchpad']);
      assert.equal(Buffer.from((await metadata(state.addresses.launchpad)).hash, 'base64url').toString('hex'), '1220' + state.testArtifactSha256);
    });
    await check('bounded existing-wallet allowances', async () => {
      assert.ok(await balance('native', state.addresses.buyer) >= 20000000n, 'Existing buyer must cover 0.2 tKOIN; no payer funding path');
      assert.ok(await balance('base', state.addresses.owner) >= 40000000n);
      await tx('bounded-allowances', [await op('native', 'approve', { owner: state.addresses.buyer, spender: state.addresses.launchpad, value: '20000000' }),
        await op('base', 'approve', { owner: state.addresses.owner, spender: state.addresses.launchpad, value: String(UNIT) })], ['owner', 'buyer']);
    });
    for (const spec of CASES) {
      const prefix = `case-${spec.id}`;
      await check(`${prefix} sold-out settlement`, async () => {
        const before = await remember(`${prefix}-before-settlement`);
        if (!state.schedules[spec.id]) { const h = await provider.getHeadInfo(); state.schedules[spec.id] = { start: String(Number(h.head_block_time) - 1000), end: String(Number(h.head_block_time) + 90000) }; persist(); }
        const schedule = state.schedules[spec.id];
        await tx(`${prefix}-settlement`, [await op('launchpad', 'create_launch', { creator: state.addresses.owner, token: state.addresses.base, price: String(UNIT),
          forSaleAmount: '10000000', startTime: schedule.start, endTime: schedule.end, liquidityBps: 5000, liquidityTokens: spec.liquidityTokens, lpUnlockTime: schedule.end }),
        await op('launchpad', 'contribute', { launchId: spec.id, buyer: state.addresses.buyer, amount: '10000000' }),
        await op('launchpad', 'finalize', { launchId: spec.id }), await op('launchpad', 'process', { launchId: spec.id, limit: 1 })], ['owner', 'buyer']);
        const after = await snapshot();
        delta(after, before, 'native', 'buyer', -10000000n); delta(after, before, 'base', 'buyer', 10000000n);
        delta(after, before, 'native', 'owner', 5000000n); delta(after, before, 'base', 'owner', -(10000000n + u(spec.liquidityTokens)));
        assert.equal(after.balances.native.launchpad, '5000000'); assert.equal(after.balances.base.launchpad, spec.liquidityTokens);
        assert.deepEqual(after.reserves, before.reserves); assert.equal(after.supply, before.supply);
        state.snapshots[`${prefix}-after-settlement`] = after; await preserveOriginal();
      });
      await check(`${prefix} remainder refund and approval reset`, async () => {
        const before = await remember(`${prefix}-before-liquidity`), expected = liquidityAccounting(before.reserves, before.supply, '5000000', spec.liquidityTokens);
        for (const key of ['usedNative', 'usedBase', 'refundNative', 'refundBase']) assert.equal(String(expected[key]), spec[key]);
        await tx(`${prefix}-liquidity`, [await op('launchpad', 'provide_liquidity', { launchId: spec.id })]);
        const after = await snapshot(), l = await launch(spec.id);
        assert.equal(l.liquidityState, 2); assert.equal(l.pair, state.addresses.pool); assert.equal(l.lpAmount, String(expected.lp));
        delta(after, before, 'native', 'owner', expected.refundNative); delta(after, before, 'base', 'owner', expected.refundBase);
        for (const token of ['native', 'base']) { assert.equal(after.balances[token].launchpad, '0'); delta(after, before, token, 'buyer', 0n); delta(after, before, token, 'router', 0n); }
        delta(after, before, 'native', 'pool', expected.usedNative); delta(after, before, 'base', 'pool', expected.usedBase);
        delta(after, before, 'pool', 'launchpad', expected.lp); delta(after, before, 'pool', 'owner', 0n); delta(after, before, 'pool', 'buyer', 0n);
        assert.equal(u(after.reserves.reserveA), u(before.reserves.reserveA) + expected.usedNative); assert.equal(u(after.reserves.reserveB), u(before.reserves.reserveB) + expected.usedBase);
        assert.equal(u(after.supply), u(before.supply) + expected.lp); assert.equal(after.allowance, '0');
        state.snapshots[`${prefix}-after-liquidity`] = after; await preserveOriginal();
      });
      const due = Number(state.schedules[spec.id].end), chainTime = Number((await provider.getHeadInfo()).head_block_time);
      if (chainTime < due) {
        // Do not race the boundary merely to generate a negative test. A slow
        // snapshot/RPC near unlock could turn it into a valid claim instead.
        if (mayAttemptEarlyClaim(chainTime, due)) await check(`${prefix} early LP rejection`, async () => {
          const before = await remember(`${prefix}-before-early-claim`);
          if (!mayAttemptEarlyClaim(Number((await provider.getHeadInfo()).head_block_time), due)) return false;
          await tx(`${prefix}-early-claim`, [await op('launchpad', 'claim_liquidity', { launchId: spec.id })], ['buyer'], 'liquidity is still locked');
          assert.deepEqual(await snapshot(), before); await preserveOriginal();
        });
        else if (state.checks[`${prefix} early LP rejection`]?.status !== 'passed') {
          state.checks[`${prefix} early LP rejection`] = { status: 'skipped', detail: 'Less than 60 seconds before the actual LP unlock', at: new Date().toISOString() }; persist();
        }
        state.checks[`${prefix} LP delivered once`] = { status: 'waiting', due: new Date(due).toISOString() }; persist();
        console.log(`Candidate case ${spec.id} LP unlock waiting until ${new Date(due).toISOString()}; resume after actual chain time.`);
        break;
      }
      await check(`${prefix} LP delivered once`, async () => {
        const before = await remember(`${prefix}-before-claim`), l = await launch(spec.id);
        await tx(`${prefix}-claim`, [await op('launchpad', 'claim_liquidity', { launchId: spec.id })], ['buyer']);
        const after = await snapshot(); delta(after, before, 'pool', 'owner', u(l.lpAmount)); delta(after, before, 'pool', 'launchpad', -u(l.lpAmount)); delta(after, before, 'pool', 'buyer', 0n);
        assert.equal(after.balances.pool.launchpad, '0');
        await tx(`${prefix}-duplicate-claim`, [await op('launchpad', 'claim_liquidity', { launchId: spec.id })], ['buyer'], 'no locked liquidity to claim');
        assert.deepEqual(await snapshot(), after); state.snapshots[`${prefix}-after-claim`] = after; await preserveOriginal();
      });
    }
    await finality();
  } finally { report(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.stderr?.toString() || e.message); process.exitCode = 1; });
