// Read-only upgrade preparation. This module has no signer, key loading, or
// transaction submission path. An operation is not a signed transaction.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Provider, Contract, Serializer, utils } from 'koilib';
import { toKoilibAbi, buildRegisteredAbi } from './abi-utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const release = JSON.parse(fs.readFileSync(path.join(root, 'scripts/security-release.json')));
export const hash = data => createHash('sha256').update(data).digest('hex');
const bytes = value => Buffer.from(value || '', 'base64url');
const U64_MAX = (1n << 64n) - 1n;
const amount = value => {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value ?? '0'))) throw new Error('invalid unsigned amount');
  const n = BigInt(value ?? '0');
  if (n > U64_MAX) throw new Error('amount exceeds uint64');
  return n;
};
const be = (value, size) => { const b = Buffer.alloc(size); size === 8 ? b.writeBigUInt64BE(BigInt(value)) : b.writeUInt32BE(Number(value)); return b; };
const abiFor = name => toKoilibAbi(JSON.parse(fs.readFileSync(path.join(root, `frontend/src/lib/${name}-abi.json`))));

export async function decodeState(serializer, value, type) {
  // koilib's address conversion drops numeric zero and false. Restore protobuf
  // defaults before interpreting buy sides, ACTIVE status, counters, and flags.
  const proto = serializer.root.lookupType(type);
  const defaults = proto.toObject(proto.create(), { defaults: true, longs: String, bytes: String });
  return { ...defaults, ...await serializer.deserialize(value, type) };
}

export function readOnlyProvider(endpoint, fetchImpl = fetch) {
  const url = new URL(endpoint);
  if (url.username || url.password || !(url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('RPC must use HTTPS or local loopback');
  const provider = new Provider(endpoint);
  const methods = new Set(['chain.get_head_info', 'chain.get_chain_id', 'chain.get_account_rc', 'chain.read_contract']);
  let queue = Promise.resolve();
  provider.call = async (method, params = {}) => {
    if (!methods.has(method) && !(method === 'chain.invoke_system_call' &&
      ['get_object', 'get_next_object'].includes(params.name))) throw new Error('RPC mutation or unsupported method refused');
    // A full inventory fans out over many storage spaces. Serialize transport
    // so those scans cannot create a burst against an operator's RPC node.
    const read = async () => {
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`RPC ${method} HTTP ${response.status}`);
      const result = await response.json();
      if (result.error) throw new Error(String(result.error.message || 'RPC read failed').slice(0, 240));
      if (!result.result) throw new Error('RPC returned no result');
      return result.result;
    };
    const pending = queue.then(read);
    queue = pending.catch(() => {});
    return pending;
  };
  return provider;
}

export async function collectSpace(provider, address, id, limit = 5000) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error('invalid storage scan limit');
  const records = [];
  const first = await provider.invokeGetObjectGeneric({ systemCallIdOrName: 'get_object', address, id, key: '' });
  if (first?.exists) records.push({ key: '', value: first.value || '' });
  let key = '';
  for (;;) {
    const next = await provider.invokeGetNextObject({ address, id, key });
    if (!next?.exists) return { id, records, sha256: hash(JSON.stringify(records)) };
    if (typeof next.key !== 'string' || Buffer.compare(bytes(next.key), bytes(key)) <= 0) throw new Error('storage pagination did not advance');
    if (records.length >= limit) throw new Error(`storage space ${id} exceeded scan limit; inventory is incomplete`);
    key = next.key;
    records.push({ key, value: next.value || '' });
  }
}

export function obligations(name, state) {
  const owed = new Map();
  const add = (token, value) => {
    const n = typeof value === 'bigint' ? value : amount(value);
    if (n < 0n) throw new Error('negative remaining obligation');
    if (!n) return;
    if (!token) throw new Error('missing obligation token');
    owed.set(token, (owed.get(token) || 0n) + n);
  };
  if (name === 'orderbook') {
    const markets = new Map(state.markets.map(m => [m.marketId, m]));
    for (const order of state.orders) {
      const market = markets.get(order.marketId);
      if (!market || ![0, 1].includes(order.side) || amount(order.remaining) === 0n) throw new Error('invalid resting order');
      add(order.side === 0 ? market.quoteToken : market.baseToken, order.escrow);
    }
  } else if (name === 'launchpad') {
    for (const l of state.launches) {
      if (![0, 1, 2, 3, 4].includes(l.status) || ![0, 1].includes(l.mode) || ![0, 1, 2, 3].includes(l.liquidityState)) throw new Error('unknown launch lifecycle');
      if (l.status === 0) {
        add(l.token, amount(l.forSaleAmount) + amount(l.lockedAmount) + amount(l.liquidityTokens));
        add(release.koin, l.raised);
      } else if (l.status === 3) {
        add(release.koin, amount(l.raised) - amount(l.refunded));
      } else if ([1, 2].includes(l.status)) {
        if (l.status === 1) add(l.token, amount(l.mode === 0 ? l.sold : l.forSaleAmount) - amount(l.distributed));
        if (!l.lockedClaimed) add(l.token, l.lockedAmount);
        if (l.liquidityState === 1) { add(l.token, l.liquidityTokens); add(release.koin, l.liquidityKoin); }
      }
      if (l.liquidityState === 2 && !l.lpClaimed) add(l.pair, l.lpAmount);
    }
  } else throw new Error('unknown contract');
  return [...owed].sort(([a], [b]) => a.localeCompare(b)).map(([token, units]) => ({ token, units: units.toString() }));
}

function validateIndexes(name, state, spaces) {
  const records = id => spaces.find(s => s.id === id).records;
  if (name === 'orderbook') {
    if (records(3).length !== state.orders.length || records(4).length !== state.orders.length) throw new Error('order index counts disagree');
    const book = new Map(records(3).map(r => [bytes(r.key).toString('hex'), bytes(r.value).toString('hex')]));
    const users = new Map(records(4).map(r => [bytes(r.key).toString('hex'), bytes(r.value).toString('hex')]));
    for (let i = 0; i < state.orders.length; i++) {
      const o = state.orders[i], id = be(o.id, 8);
      if (!bytes(records(2)[i].key).equals(id)) throw new Error('order id/key mismatch');
      const price = amount(o.price), sortPrice = o.side === 0 ? U64_MAX - price : price;
      const bookKey = Buffer.concat([be(o.marketId, 4), Buffer.from([o.side]), be(sortPrice, 8), id]).toString('hex');
      const userKey = Buffer.concat([utils.decodeBase58(o.owner), id]).toString('hex');
      if (book.get(bookKey) !== id.toString('hex') || users.get(userKey) !== '01') throw new Error('order index content disagrees');
    }
  } else {
    const buyers = new Map(records(3).map(r => [bytes(r.key).toString('hex'), bytes(r.value).toString('hex')]));
    if (records(3).length !== state.contributions.length) throw new Error('buyer/contribution counts disagree');
    for (const l of state.launches) {
      const entries = state.contributions.filter(c => c.launchId === l.id);
      if (entries.length !== l.buyerCount || l.cursor > l.buyerCount) throw new Error('launch buyer counts disagree');
      if (entries.reduce((sum, c) => sum + amount(c.koin), 0n) !== amount(l.raised)) throw new Error('contributions disagree with raised amount');
      for (const c of entries) {
        const key = Buffer.concat([be(l.id, 4), be(c.seq, 4)]).toString('hex');
        if (buyers.get(key) !== Buffer.from(utils.decodeBase58(c.buyer)).toString('hex')) throw new Error('buyer index content disagrees');
      }
    }
  }
}

// Older RPC nodes do not implement caller_data for user-space get_object.
// Their supported public contract readers still let us inventory liabilities,
// but cannot prove unused storage spaces or exact raw storage preservation.
async function publicState(provider, name, abi, serializer) {
  const contract = new Contract({ id: release.contracts[name].address, provider, abi });
  const normalize = async (type, value) => decodeState(serializer, await serializer.serialize(value, name + '.' + type), name + '.' + type);
  if (name === 'orderbook') {
    const { result } = await contract.functions.get_markets({});
    if (!Array.isArray(result?.markets)) throw new Error('missing markets response');
    const markets = await Promise.all(result.markets.map(m => normalize('market_config', m)));
    const orders = [], ids = new Set();
    for (const market of markets) {
      const { result: book } = await contract.functions.get_orderbook({ marketId: market.marketId, limit: 200 });
      if (!book) throw new Error('missing orderbook response');
      for (const [side, entries] of [[0, book.bids || []], [1, book.asks || []]]) {
        if (entries.length >= 200) throw new Error('public orderbook limit reached; inventory is incomplete');
        for (const entry of entries) {
          const order = await normalize('order_object', entry);
          if (ids.has(order.id) || order.marketId !== market.marketId || order.side !== side) throw new Error('public orderbook indexes disagree');
          ids.add(order.id); orders.push(order);
        }
      }
    }
    orders.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
    return { global: [], markets, orders };
  }
  const launches = [], contributions = [];
  let start = 0;
  for (;;) {
    const { result } = await contract.functions.get_launches({ start, limit: 100 });
    if (!result) throw new Error('missing launches response');
    const batch = result.launches || [];
    for (const entry of batch) {
      const launch = await normalize('launch_object', entry);
      if (launch.id <= start || launches.length >= 5000) throw new Error('launch pagination failed or exceeded limit');
      launches.push(launch); start = launch.id;
    }
    if (batch.length < 100) break;
  }
  for (const launch of launches) {
    let start = 0;
    while (start < launch.buyerCount) {
      const { result } = await contract.functions.get_buyers({ launchId: launch.id, start, limit: 100 });
      const batch = result?.contributions;
      if (!batch?.length || contributions.length + batch.length > 5000) throw new Error('buyer inventory incomplete');
      for (const entry of batch) {
        const contribution = await normalize('contribution_object', entry);
        if (contribution.launchId !== launch.id || contribution.seq !== start) throw new Error('buyer sequence mismatch');
        contributions.push(contribution); start++;
      }
    }
    if (start !== launch.buyerCount) throw new Error('buyer count mismatch');
  }
  return { global: [], launches, contributions };
}

export async function inspectContract(provider, name) {
  const spec = release.contracts[name];
  if (!spec) throw new Error('unknown contract');
  const key = utils.encodeBase64url(utils.decodeBase58(spec.address));
  const query = { address: spec.address, system: true, zone: '', key };
  const [code, rawMeta, rc] = await Promise.all([
    provider.invokeGetObject({ ...query, id: 2 }), provider.invokeGetObject({ ...query, id: 3 }),
    provider.getAccountRc(spec.address),
  ]);
  if (!code || !rawMeta) throw new Error('contract code or metadata is missing');
  const metadataSerializer = new Serializer({ nested: { Metadata: { fields: {
    hash: { type: 'bytes', id: 1 }, system: { type: 'bool', id: 2 },
    authorizesCall: { type: 'bool', id: 3 }, authorizesTransaction: { type: 'bool', id: 4 }, authorizesUpload: { type: 'bool', id: 5 },
  } } } });
  const metadata = await decodeState(metadataSerializer, rawMeta, 'Metadata');
  const bytecodeSha256 = hash(bytes(code));
  if (bytes(metadata.hash).toString('hex') !== '1220' + bytecodeSha256) throw new Error('metadata hash disagrees with bytecode');
  const abi = abiFor(name), serializer = new Serializer(abi.koilib_types);
  let spaces = null, state;
  try {
    spaces = await Promise.all([...spec.preservedSpaces, spec.lockSpace].map(id => collectSpace(provider, spec.address, id)));
  } catch (e) {
    if (!String(e.message).includes('privileged code can only access system space')) throw e;
  }
  if (spaces) {
    const decode = (id, type) => Promise.all(spaces.find(s => s.id === id).records.map(r => decodeState(serializer, r.value, name + '.' + type)));
    state = name === 'orderbook'
      ? { global: await decode(0, 'global_state'), markets: await decode(1, 'market_config'), orders: await decode(2, 'order_object') }
      : { global: await decode(0, 'global_state'), launches: await decode(1, 'launch_object'), contributions: await decode(2, 'contribution_object') };
    validateIndexes(name, state, spaces);
  } else state = await publicState(provider, name, abi, serializer);
  const liabilities = obligations(name, state);
  // Report only tokens represented by current obligations plus native KOIN.
  // Unrelated tokens sent directly to the account are outside this inventory.
  const balances = await Promise.all([...new Set([release.koin, ...liabilities.map(o => o.token)])].map(async token => {
    const owed = liabilities.find(o => o.token === token)?.units || '0';
    try {
      const contract = new Contract({ id: token, provider, abi: utils.tokenAbi });
      const { result } = await contract.functions.balanceOf({ owner: spec.address });
      if (result?.value === undefined) throw new Error('token returned no balance');
      const held = amount(result.value);
      return { token, held: held.toString(), owed, covered: held >= BigInt(owed) };
    } catch (e) { return { token, owed, covered: false, error: String(e.message).slice(0, 240) }; }
  }));
  const blockers = [];
  if (![spec.previousSha256, spec.sha256].includes(bytecodeSha256)) blockers.push('unrecognized deployed bytecode');
  if (metadata.system || metadata.authorizesCall || metadata.authorizesTransaction || metadata.authorizesUpload) blockers.push('authorization metadata changed');
  if (!spaces) blockers.push('RPC cannot verify raw storage or the new lock space; node-side export or a compatible RPC is required');
  else if (spaces.find(s => s.id === spec.lockSpace).records.length) blockers.push('new lock storage space is occupied');
  if (balances.some(b => !b.covered)) blockers.push('an obligation has insufficient or unreadable token balance');
  return { name, address: spec.address, bytecodeBytes: bytes(code).length, bytecodeSha256,
    patched: bytecodeSha256 === spec.sha256, metadata, rc, rawStorageVerified: !!spaces, spaces, state,
    stateSha256: hash(JSON.stringify(state)), balances, blockers };
}

export async function inspectRelease(provider) {
  const chainId = await provider.getChainId();
  if (!bytes(chainId).equals(bytes(release.chainId))) throw new Error('RPC chain id does not match the mainnet release');
  const start = await provider.getHeadInfo();
  const contracts = await Promise.all(Object.keys(release.contracts).map(name => inspectContract(provider, name)));
  const end = await provider.getHeadInfo();
  return { release: release.id, capturedAt: new Date().toISOString(), chainId,
    heads: { start: start.head_topology, end: end.head_topology },
    headTimes: { start: start.head_block_time, end: end.head_block_time },
    consistency: 'Current-head reads, not an atomic or block-pinned snapshot. Recheck at the upgrade boundary.', contracts };
}

export function prepareOperation(name, report, bytecode, now = Date.now()) {
  const spec = release.contracts[name];
  if (!spec || report.release !== release.id || !bytes(report.chainId).equals(bytes(release.chainId))) throw new Error('wrong release or network');
  const observed = report.contracts.find(c => c.name === name);
  if (!observed || observed.address !== spec.address || observed.bytecodeSha256 !== spec.previousSha256) throw new Error('unexpected target address or deployed code');
  if (observed.blockers.length) throw new Error('contract preflight has blockers');
  const captured = Date.parse(report.capturedAt);
  if (!Number.isFinite(captured) || now - captured > 300000 || captured > now + 30000) throw new Error('preflight report is stale');
  if (!observed.rawStorageVerified || observed.metadata.system || observed.metadata.authorizesCall ||
      observed.metadata.authorizesTransaction || observed.metadata.authorizesUpload ||
      !observed.spaces || observed.spaces.find(s => s.id === spec.lockSpace)?.records.length !== 0 ||
      observed.balances.some(b => !b.covered)) throw new Error('storage, authorization, or balance verification is incomplete');
  if (hash(bytecode) !== spec.sha256 || !bytecode.subarray(0, 8).equals(Buffer.from('0061736d01000000', 'hex'))) throw new Error('local artifact does not match the pinned patched WASM');
  return { upload_contract: {
    contract_id: spec.address, bytecode: utils.encodeBase64url(bytecode), abi: buildRegisteredAbi(name),
    authorizes_call_contract: false, authorizes_transaction_application: false, authorizes_upload_contract: false,
  } };
}

async function main() {
  const [mode, output] = process.argv.slice(2);
  if (!['inspect', 'prepare'].includes(mode) || !output) throw new Error('Usage: node upgrade-audit.js inspect|prepare OUTPUT.json (KOINOS_RPC optional)');
  const provider = readOnlyProvider(process.env.KOINOS_RPC || 'https://api.koinosblocks.com');
  const report = await inspectRelease(provider);
  report.readyToBroadcast = false;
  report.reviewRequired = ['independent contract review', 'real-node upgrade rehearsal', 'upgrade-key custody verification', 'current state recheck', 'operator authorization'];
  if (mode === 'prepare') {
    report.operations = Object.entries(release.contracts).map(([name, spec]) => prepareOperation(name, report, fs.readFileSync(path.join(root, spec.wasm))));
    report.signed = false;
  }
  // Never overwrite a previous review record or key file supplied by mistake.
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Saved ${mode} report to ${output}`);
  for (const c of report.contracts) console.log(`${c.name}: ${c.patched ? 'patched' : 'upgrade pending'}; ${c.state.orders?.length ?? c.state.launches?.length} records; ${c.blockers.length} preflight blockers`);
  if (report.contracts.some(c => c.blockers.length)) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exitCode = 1; });
