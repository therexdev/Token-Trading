import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Provider, Signer, Transaction, utils } from 'koilib';
import { digest, work } from './rehearsal-build.js';
export const MAINNET = 'EiBZK_GGVP0H_fXVAM3j6EAuz3-B-l3ejxRSewi7qIBfSA==';
// Verified against the Foundation RPC on 2026-09-27. The older docs show a retired chain ID.
export const HARBINGER = 'EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==';
export const HARBINGER_RPC = 'https://testnet.koinosfoundation.org/jsonrpc';
export const TRANSACTION_RC_LIMIT = 20n * 100000000n;
export const roles = ['payer', 'owner', 'buyer', 'orderbook', 'launchpad', 'base', 'quote', 'router'];
const blocked = new Set(['1Bke72aGbpq4brDY3m1UQxRCGBB9GPTJQz', '13akLV3xQZdRjdQ2ANYo7cvSsD8qfBZReV',
  '19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK', '17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s']);
export const sameChain = (a, b) => Buffer.from(a, 'base64url').equals(Buffer.from(b, 'base64url'));
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function assertChain(chainId, expected) {
  const bytes = Buffer.from(chainId || '', 'base64url');
  if (bytes.length !== 34 || bytes[0] !== 0x12 || bytes[1] !== 0x20) throw new Error('Invalid chain ID');
  if (sameChain(chainId, MAINNET)) throw new Error('MAINNET IS FORBIDDEN');
  if (!expected || !sameChain(chainId, expected)) throw new Error('Chain ID does not match the configured testnet');
}
export function save(file, data) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temporary, file);
}
export function createState(directory = work) {
  const file = path.join(directory, 'state.json');
  if (fs.existsSync(file)) throw new Error('A rehearsal already exists; reuse it. Do not overwrite its keys or journal.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keys = {}, addresses = {};
  for (const role of roles) {
    const signer = Signer.fromSeed(randomBytes(32).toString('hex'));
    keys[role] = signer.getPrivateKey('wif'); addresses[role] = signer.getAddress();
  }
  const state = { version: 1, testOnly: true, createdAt: new Date().toISOString(), addresses,
    chainId: null, schedule: null, journal: {}, checks: {}, snapshots: {} };
  fs.writeFileSync(path.join(directory, 'keys.json'), JSON.stringify(keys, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return state;
}
export function assertOperation(operation, state) {
  if (Object.keys(operation).length !== 1) throw new Error('Only a single call or upload is allowed');
  const kind = Object.keys(operation)[0], value = operation[kind];
  if (!['call_contract', 'upload_contract'].includes(kind)) throw new Error('System operations are forbidden');
  if (blocked.has(value.contract_id) || !Object.values(state.addresses).includes(value.contract_id)) throw new Error('Operation targets an account outside this rehearsal');
  if (kind === 'upload_contract' && (value.authorizes_call_contract || value.authorizes_transaction_application || value.authorizes_upload_contract)) throw new Error('Authorization overrides are forbidden');
}
export class RpcRejection extends Error {}
export function providerFor(endpoint, fetcher = fetch) {
  if (!endpoint) throw new Error('Set REHEARSAL_RPC to a working Harbinger RPC URL');
  const url = new URL(endpoint);
  if (url.username || url.password || !(url.protocol === 'https:' ||
    (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS or a local SSH tunnel for the testnet RPC');
  const p = new Provider(endpoint);
  const allowed = new Set(['chain.get_chain_id', 'chain.get_head_info', 'chain.get_account_rc', 'chain.get_account_nonce',
    'chain.get_resource_limits', 'chain.read_contract', 'chain.submit_transaction',
    'block_store.get_blocks_by_height', 'block_store.get_blocks_by_id', 'transaction_store.get_transactions_by_id']);
  p.call = async (method, params) => {
    if (!allowed.has(method) && !(method === 'chain.invoke_system_call' && ['get_contract_address', 'get_object', 'get_contract_metadata'].includes(params.name))) throw new Error('Unsupported rehearsal RPC method');
    const id = randomUUID();
    const r = await fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`RPC ${method}: HTTP ${r.status}`);
    const data = await r.json();
    if (data.id !== id) throw new Error(`RPC ${method}: response ID mismatch`);
    if (data.error) throw new RpcRejection(JSON.stringify(data.error).slice(0, 3000));
    if (!data.result) throw new Error(`RPC ${method}: missing result`);
    return data.result;
  };
  return p;
}
export async function checkNetwork(provider, expected = HARBINGER, now = Date.now()) {
  const chainId = await provider.getChainId(); assertChain(chainId, expected);
  const head = await provider.getHeadInfo(), time = Number(head.head_block_time);
  if (!Number.isSafeInteger(time) || now - time > 300000 || time - now > 60000) throw new Error('Testnet node is stale or its clock is inconsistent');
  // Prove block receipts are served before any test deployment.
  const [block] = await provider.getBlocks(Number(head.head_topology.height), 1, head.head_topology.id, { returnBlock: true, returnReceipt: true });
  if (!block?.receipt || !block.block) throw new Error('RPC must provide canonical blocks and receipts');
  return { chainId, head };
}
export async function findReceipt(provider, entry) {
  const head = await provider.getHeadInfo(), height = Number(head.head_topology.height);
  if (height - entry.startHeight > 2000) throw new Error('Pending transaction is outside the bounded scan; reconcile its saved ID before restarting');
  for (let at = entry.startHeight; at <= height; at += 50) {
    const blocks = await provider.getBlocks(at, Math.min(50, height - at + 1), head.head_topology.id, { returnBlock: true, returnReceipt: true });
    for (const block of blocks) {
      const tx = block.block?.transactions?.find(t => t.id === entry.id);
      if (!tx) continue;
      const receipt = block.receipt?.transaction_receipts?.find(t => t.id === entry.id);
      if (!receipt) throw new Error('Included transaction has no receipt; outcome remains pending');
      const canonical = await provider.getBlocks(Number(block.block_height), 1, undefined, { returnBlock: false, returnReceipt: true });
      if (canonical[0]?.block_id !== block.block_id) throw new Error('Transaction block is no longer canonical');
      return { blockId: block.block_id, height: Number(block.block_height), receipt };
    }
  }
  return null;
}
export async function reconcileResourceRejection({ provider, state, persist, label }) {
  const entry = state.journal[label];
  if (!entry || entry.status !== 'pending' || entry.expectedError) throw new Error('Only an unresolved ordinary transaction can be reconciled');
  let rejection, detail;
  try { rejection = JSON.parse(entry.submissionError); detail = typeof rejection.data === 'string' ? JSON.parse(rejection.data) : rejection.data; } catch {}
  if (detail?.code !== 104 || rejection?.message !== 'insufficient pending account resources') throw new Error('No explicit pending-resource rejection; keep checking the original transaction');
  const network = await checkNetwork(provider, state.chainId);
  if (BigInt(network.head.last_irreversible_block) < BigInt(entry.startHeight)) throw new Error('Wait for the rejection starting block to become irreversible');
  if (await findReceipt(provider, entry)) throw new Error('Original transaction was included; resume it instead');
  const stored = await provider.getTransactionsById([entry.id]);
  if ((stored.transactions || []).length) throw new Error('Transaction store knows the original transaction; reconcile it before retrying');
  const nextNonce = await provider.getNextNonce(state.addresses.payer);
  if (nextNonce !== entry.transaction.header.nonce) throw new Error('Payer nonce changed; replacement is forbidden');
  entry.status = 'retry-ready';
  entry.reconciliation = { at: new Date().toISOString(), headHeight: network.head.head_topology.height,
    lastIrreversibleBlock: network.head.last_irreversible_block, nextNonce, included: false, transactionStoreFound: false };
  persist();
  return entry;
}
export async function executeTransaction({ provider, state, persist, keys, label, operations, actors = [], expectedError, timeout = 90000 }) {
  for (const op of operations) assertOperation(op, state);
  const fingerprint = digest(JSON.stringify({ operations, actors, expectedError: expectedError || null }));
  let entry = state.journal[label];
  if (entry && entry.fingerprint !== fingerprint) throw new Error(`Saved operation differs for ${label}; refusing to reuse its journal`);
  if (entry?.status === 'passed') return entry;
  if (entry?.status === 'failed') throw new Error(`Previously failed check: ${label}. Review the saved report before starting a fresh rehearsal.`);
  const wasPending = !!entry;
  const replacement = entry?.status === 'retry-ready' ? entry : null;
  if (!entry || replacement) {
    const network = await checkNetwork(provider, state.chainId);
    const available = BigInt(await provider.getAccountRc(state.addresses.payer));
    if (available < 100000000n) throw new Error('Less than 1 tKOIN of Mana remains; fund the rehearsal payer');
    if (replacement && await provider.getNextNonce(state.addresses.payer) !== replacement.transaction.header.nonce) throw new Error('Payer nonce changed after reconciliation; replacement is forbidden');
    const rcLimit = available < TRANSACTION_RC_LIMIT ? available : TRANSACTION_RC_LIMIT;
    const transaction = await Transaction.prepareTransaction({ operations, header: { payer: state.addresses.payer,
      chain_id: state.chainId, rc_limit: rcLimit.toString(), ...(replacement && { nonce: replacement.transaction.header.nonce }) } }, provider, state.addresses.payer);
    if (replacement && transaction.id === replacement.id) throw new Error('Replacement must change the rejected resource limit');
    for (const actor of new Set(['payer', ...actors])) {
      const signer = Signer.fromWif(keys[actor]);
      if (signer.getAddress() !== state.addresses[actor]) throw new Error('Test key does not match its recorded address');
      await signer.signTransaction(transaction);
    }
    // Save the exact signed transaction BEFORE submission. Never log keys.
    entry = { id: transaction.id, transaction, fingerprint, status: 'pending', startHeight: Number(network.head.head_topology.height), expectedError: expectedError || null };
    if (replacement) {
      state.journal[`${label}:rejected:${replacement.id}`] = { ...replacement, status: 'rejected', outcome: 'node-rejected-resource-budget' };
      entry.replaces = replacement.id;
    }
    state.journal[label] = entry; persist();
    try {
      // Recheck immediately before the only mutation path.
      assertChain(await provider.getChainId(), state.chainId);
      await provider.sendTransaction(transaction, true);
      console.log(`Submitted: ${label} (${entry.id})`);
    } catch (error) {
      if (error instanceof RpcRejection && expectedError && new RegExp(expectedError).test(error.message)) {
        entry.status = 'passed'; entry.outcome = 'node-rejected'; entry.reason = error.message; persist(); console.log(`Expected rejection: ${label}`); return entry;
      }
      entry.submissionError = error.message; persist();
      throw new Error(`${label}: submission outcome unresolved (${entry.id}). ${error.message}. Run resume to CHECK this ID; it will not rebroadcast.`);
    }
  }
  const deadline = Date.now() + timeout;
  do {
    const result = await findReceipt(provider, entry);
    if (result) {
      entry.evidence = result;
      const reason = (result.receipt.logs || []).join('\n');
      const correct = expectedError ? result.receipt.reverted === true && new RegExp(expectedError).test(reason) : result.receipt.reverted !== true;
      entry.status = correct ? 'passed' : 'failed'; entry.outcome = result.receipt.reverted ? 'reverted' : 'included'; persist();
      if (!correct) throw new Error(`${label}: unexpected receipt outcome. ${reason}`);
      console.log(`Confirmed: ${label} at block ${result.height}`);
      return entry;
    }
    if (Date.now() >= deadline) break;
    await delay(2500);
  } while (true);
  throw new Error(`${label}: ${wasPending ? 'still pending' : 'confirmation pending'} (${entry.id}). Resume only checks the saved ID. Do not initialize another run to bypass it.`);
}
export function publicReport(state, manifest) {
  return { testOnly: true, capturedAt: new Date().toISOString(), chainId: state.chainId, addresses: state.addresses,
    checks: state.checks, verifications: state.verifications, snapshots: state.snapshots, finality: state.finality,
    transactions: Object.entries(state.journal).map(([label, { transaction, ...entry }]) => ({ label, ...entry })),
    artifacts: manifest?.artifacts, limitations: manifest?.limitations, mainnetReady: false };
}
