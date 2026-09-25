const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto, createHash } = require('node:crypto');
const { Signer } = require('koilib');
const fixture = require('./fixtures/request-proof-v2.json');
const audience = 'https://usekoinos.com', origin = 'https://app.tradekoinos.com';
const context = { version: 2, audience, network: 'mainnet', ttlMs: 300000 };
const signer = new Signer({ privateKey: '01'.repeat(32) });
const address = signer.getAddress();

function load(file, dependencies = {}, fetch = globalThis.fetch, clock = Date, random = webcrypto) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const evaluate = vm.runInThisContext(`(function(exports, require, fetch, window, crypto, Date) { ${code}\n })`);
  evaluate(exports, name => dependencies[name] || {}, fetch, { location: { origin } }, random, clock);
  return exports;
}
const protocol = load('requestProof.ts');
const options = payload => ({ action: 'launch-token', payload, address, context, audience, network: 'mainnet', origin,
  signMessage: m => signer.signMessage(m) });

test('Trade and gateway share the exact canonical payload, digest, and signing message', () => {
  assert.equal(protocol.canonical(fixture.payload), fixture.canonicalPayload);
  assert.equal(createHash('sha256').update(protocol.canonical(fixture.payload)).digest('hex'), fixture.fields.payloadHash);
  assert.equal(protocol.message(fixture.fields), fixture.message);
});

test('Trade produces a real verifiable signature over the entire v2 request', async () => {
  const body = await protocol.create(options({ name: 'Test', supply: '100', mintable: false }));
  const { proof, ...payload } = body;
  const { signature, ...fields } = proof;
  assert.equal(fields.address, address); assert.equal(fields.path, '/api/launch-token');
  assert.equal(fields.payloadHash, createHash('sha256').update(protocol.canonical(payload)).digest('hex'));
  assert.equal(Signer.recoverAddress(createHash('sha256').update(protocol.message(fields)).digest(), Buffer.from(signature, 'base64')), address);
  assert.match(proof.nonce, new RegExp('^' + proof.issuedAt + '\\.[a-f0-9]{64}$'));
});

test('Trade producer matches the independent wire fixture byte for byte', async () => {
  const p = load('requestProof.ts', {}, globalThis.fetch, { now: () => fixture.fields.issuedAt }, {
    subtle: webcrypto.subtle, getRandomValues: bytes => bytes.fill(0xab),
  });
  const { address: fixtureAddress, ...payload } = fixture.payload;
  let signed;
  const body = await p.create({ ...options(payload), address: fixtureAddress,
    signMessage: async message => { signed = message; return new Uint8Array(65); } });
  assert.equal(signed, fixture.message);
  assert.deepEqual(body.proof, { ...fixture.fields, signature: Buffer.alloc(65).toString('base64') });
});

test('discovery cannot downgrade signing or change the app audience or network', async () => {
  for (const advertised of [undefined, null, { ...context, version: 1 }, { ...context, audience: 'https://evil.example' },
    { ...context, network: 'harbinger' }, { ...context, ttlMs: 3600000 }]) {
    let signatures = 0;
    const p = load('requestProof.ts', {}, async () => ({ ok: true, json: async () => ({ requestProof: advertised }) }));
    await assert.rejects(p.signGatewayRequest({ ...options({}), signMessage: async () => { signatures++; } }), /unavailable/);
    assert.equal(signatures, 0);
  }
});

test('payload is frozen before discovery and a wallet prompt, with fresh nonces per request', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const p = load('requestProof.ts', {}, async () => { await wait; return { ok: true, json: async () => ({ requestProof: context }) }; });
  const payload = { links: { website: 'https://original.example' } };
  const pending = p.signGatewayRequest(options(payload));
  payload.links.website = 'https://changed.example'; release();
  const first = await pending, second = await p.signGatewayRequest(options(payload));
  assert.equal(first.links.website, 'https://original.example');
  assert.equal(second.links.website, 'https://changed.example');
  assert.notEqual(first.proof.nonce, second.proof.nonce);
});

test('every Trade launch endpoint sends its full signed body; Google still sends its session', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    if (url.endsWith('/api/signer-config')) return { ok: true, json: async () => ({ requestProof: context }) };
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ ok: true, address: 'token-address', txid: 'tx', links: {} }) };
  };
  const proof = load('requestProof.ts', {}, fetch);
  const api = load('launchpad.ts', {
    './abi': { toKoilibAbi: () => ({}) }, './requestProof': proof,
    './koinos': { getSignerFor: () => signer }, '../config/signer': { SIGNER_API: audience },
    '../config/tokens': { TOKENS: [], NETWORK: 'mainnet' },
  }, fetch);
  const cases = [
    ['mintTokenViaUsekoinos', 'launch-token', { name: 'Test', symbol: 'TST', decimals: 8, supply: '100', mintable: false }],
    ['uploadTokenLogo', 'launchpad-logo', { token: 'token-address', logo: 'image-data' }],
    ['saveLaunchLinks', 'launchpad-profile', { launchId: 10, links: { website: 'https://example.com' } }],
  ];
  for (const [method, action, payload] of cases) {
    await api[method]({ ...payload, kondorAddress: address });
    const call = calls.at(-1), { proof: signed, ...body } = call.body;
    assert.equal(call.url, audience + '/api/' + action);
    assert.deepEqual(body, { ...payload, address });
    assert.equal(signed.action, action);
    assert.equal(signed.payloadHash, createHash('sha256').update(protocol.canonical(body)).digest('hex'));
    await api[method]({ ...payload, sessionToken: 'session-fixture' });
    assert.deepEqual(calls.at(-1).body, { ...payload, sessionToken: 'session-fixture' });
  }
});

test('signing or discovery failure never sends a launch mutation', async () => {
  for (const mode of ['discovery', 'signature']) {
    let mutations = 0;
    const fetch = async (url) => {
      if (!url.endsWith('/api/signer-config')) mutations++;
      return { ok: mode !== 'discovery', json: async () => ({ requestProof: context }) };
    };
    const api = load('launchpad.ts', {
      './abi': { toKoilibAbi: () => ({}) }, './requestProof': load('requestProof.ts', {}, fetch),
      './koinos': { getSignerFor: () => ({ signMessage: async () => { throw new Error('denied'); } }) },
      '../config/signer': { SIGNER_API: audience }, '../config/tokens': { TOKENS: [], NETWORK: 'mainnet' },
    }, fetch);
    await assert.rejects(api.uploadTokenLogo({ token: 'token', logo: 'data', kondorAddress: address }));
    assert.equal(mutations, 0);
  }
});
