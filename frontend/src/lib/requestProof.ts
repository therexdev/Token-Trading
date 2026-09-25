/** Wire format shared with discover-koinos/public/js/request-proof.js.
 * Both implementations use the request-proof-v2.json conformance fixture. */
export const TTL_MS = 5 * 60 * 1000;
export const PATHS = {
  'mint-nft': '/api/mint-nft', 'upload-nft': '/api/upload-nft',
  'launch-token': '/api/launch-token', 'list-dex': '/api/list-dex',
  'launchpad-logo': '/api/launchpad-logo', 'launchpad-profile': '/api/launchpad-profile',
  prepare: '/api/prepare',
} as const;
export type ProofAction = keyof typeof PATHS;

export function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error('request is too deeply nested');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => canonical(v, depth + 1)).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map(k => JSON.stringify(k) + ':' + canonical(record[k], depth + 1)).join(',') + '}';
  }
  throw new Error('request must contain JSON values');
}

export function validOrigin(value: string): boolean {
  try {
    const u = new URL(value);
    return u.origin === value && (u.protocol === 'https:' ||
      (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)));
  } catch { return false; }
}

export function message(fields: Record<string, unknown>): string {
  return 'discover-koinos:request-proof:v2\n' + canonical(fields);
}

interface ProofOptions {
  action: ProofAction;
  payload: Record<string, unknown>;
  address: string;
  context: unknown;
  audience: string;
  network: string;
  origin: string;
  signMessage: (message: string) => Promise<Uint8Array>;
}

export async function create({ action, payload, address, context, audience, network, origin, signMessage }: ProofOptions): Promise<Record<string, unknown>> {
  if (!Object.prototype.hasOwnProperty.call(PATHS, action)) throw new Error('unsupported signed action');
  const ctx = context as Record<string, unknown> | null;
  if (!ctx || ctx.version !== 2 || ctx.audience !== audience || ctx.network !== network ||
      ctx.ttlMs !== TTL_MS || !validOrigin(audience) || !validOrigin(origin)) {
    throw new Error('Secure request signing is unavailable. Refresh and try again shortly.');
  }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object' ||
      ['address', 'proof', 'sessionToken', 'ts', 'sig'].some(k => Object.prototype.hasOwnProperty.call(payload, k))) {
    throw new Error('unexpected authentication fields');
  }
  const body = JSON.parse(JSON.stringify({ ...payload, address }));
  const issuedAt = Date.now();
  const random = crypto.getRandomValues(new Uint8Array(32));
  const nonce = issuedAt + '.' + Array.from(random, b => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(body)));
  const fields = {
    version: 2, action, method: 'POST', path: PATHS[action], address,
    audience, origin, network, issuedAt, expiresAt: issuedAt + TTL_MS, nonce,
    payloadHash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''),
  };
  const signature = await signMessage(message(fields));
  return { ...body, proof: { ...fields, signature: btoa(String.fromCharCode(...new Uint8Array(signature))) } };
}

/** Fetch advertised support without permitting a legacy downgrade. Expected
 * audience and network come from the app configuration, never from the response. */
export async function signGatewayRequest(options: Omit<ProofOptions, 'context'>): Promise<Record<string, unknown>> {
  const payload = JSON.parse(JSON.stringify(options.payload));
  if (!validOrigin(options.audience)) throw new Error('Invalid signing service origin');
  const response = await fetch(`${options.audience}/api/signer-config`, {
    cache: 'no-store', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Could not check secure request signing — try again shortly');
  const config = await response.json();
  return create({ ...options, payload, context: config?.requestProof });
}
