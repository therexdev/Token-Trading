import type { SendTransactionOptions, SignerInterface, TransactionJson, TransactionJsonWait } from "koilib";

export const BIO_WALLET_API = (import.meta.env.VITE_BIO_WALLET_API || "https://koinvault.app").replace(/\/+$/, "");
const KEY = "trade-koinos:bio-wallet:v2:" + BIO_WALLET_API;

export interface BioSession { sessionId: string; secret: string; address: string; }
export interface BioPair { sessionId: string; secret: string; uri: string; expiresAt: number; protocolVersion: 2; }

async function json(path: string, init?: RequestInit) {
  const response = await fetch(BIO_WALLET_API + path, { ...init, cache: "no-store", signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.ok) {
    throw Object.assign(new Error(body?.error || "KOIN Vault did not respond"), { status: response.status });
  }
  return body;
}

export async function createBioPair(): Promise<BioPair> {
  const pair: BioPair = await json("/api/dapp/create", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Trade Koinos", icon: `${location.origin}/favicon.svg`, walletUrl: BIO_WALLET_API, protocolVersion: 2 }),
  });
  if (pair.protocolVersion !== 2) throw new Error("KOIN Vault needs an update before secure pairing is available.");
  const uri = new URL(pair.uri);
  const credentials = new URLSearchParams(uri.hash.slice(1));
  if (uri.origin !== BIO_WALLET_API || uri.pathname !== "/" || uri.username || uri.password
      || uri.search || credentials.get("connect") !== pair.sessionId || credentials.get("secret") !== pair.secret) {
    throw new Error("KOIN Vault returned an unexpected connection link");
  }
  return pair;
}

export async function readBioPair(pair: Pick<BioPair, "sessionId" | "secret">) {
  return json("/api/dapp/status", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: pair.sessionId, secret: pair.secret }),
  });
}

export function isBioDisconnected(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 404 || status === 410;
}

export function watchBioSession(session: BioSession, onDisconnect: () => void): () => void {
  let stopped = false, checking = false;
  const stop = () => {
    stopped = true; clearInterval(timer);
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("focus", check);
    window.removeEventListener("online", check);
  };
  const ended = () => { if (!stopped) { stop(); onDisconnect(); } };
  async function check() {
    if (stopped || checking || document.hidden) return;
    checking = true;
    try {
      const live = await readBioPair(session);
      if (!live.connected || live.address !== session.address) ended();
    } catch (error) {
      if (isBioDisconnected(error)) ended();
    } finally { checking = false; }
  }
  const timer = setInterval(check, 2000);
  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  void check();
  return stop;
}

export async function disconnectBioSession(session = loadBioSession()): Promise<void> {
  // Clear synchronously so no further action can use this tab's old signer.
  const current = loadBioSession();
  if (current?.sessionId === session?.sessionId && current?.secret === session?.secret) saveBioSession(null);
  if (session) await json("/api/dapp/disconnect", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(session),
  }).catch(() => {});
}

export function saveBioSession(session: BioSession | null) {
  try { session ? sessionStorage.setItem(KEY, JSON.stringify(session)) : sessionStorage.removeItem(KEY); } catch { /* memory-less fallback */ }
}
export function loadBioSession(): BioSession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || "null");
    return value?.sessionId && value?.secret && value?.address ? value : null;
  } catch { return null; }
}

export class BioWalletSigner implements Partial<SignerInterface> {
  public readonly address: string;
  constructor(private session: BioSession, private onExpire?: () => void) { this.address = session.address; }
  getAddress() { return this.address; }
  async signMessage(): Promise<Uint8Array> {
    throw new Error("This action requires Google or Kondor. KOIN Vault currently supports on-chain transactions, but not the message proof used for token minting, logos, and project links.");
  }
  async signTransaction(): Promise<TransactionJson> {
    throw new Error("KOIN Vault signs and broadcasts after approval; use sendTransaction");
  }
  async sendTransaction(transaction: TransactionJson | TransactionJsonWait, _options?: SendTransactionOptions): Promise<{ transaction: TransactionJsonWait; receipt: any }> {
    let request: any;
    try {
      request = await json("/api/dapp/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...this.session, operations: transaction.operations || [], summary: {
          title: "Trade Koinos transaction", detail: `${transaction.operations?.length || 0} contract call${transaction.operations?.length === 1 ? "" : "s"} requested by Trade Koinos`,
          network: import.meta.env.VITE_KOINOS_NETWORK || "mainnet",
        } }),
      });
    } catch (error: any) {
      const current = loadBioSession();
      if (isBioDisconnected(error) && current?.sessionId === this.session.sessionId && current?.secret === this.session.secret) {
        // The connection watcher clears storage and UI together after checking
        // the session endpoint. A request error alone must not orphan the UI.
        this.onExpire?.();
      }
      throw error;
    }
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const status = await json("/api/dapp/request-status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: this.session.sessionId, secret: this.session.secret, requestId: request.requestId }),
      });
      if (status.status === "rejected") throw new Error("Transaction rejected in KOIN Vault");
      if (status.status === "failed") throw new Error(status.error || "KOIN Vault could not submit the transaction");
      if (status.status === "approved" && status.txid) {
        const done = transaction as TransactionJsonWait;
        done.id = status.txid;
        return { transaction: done, receipt: { id: status.txid } };
      }
    }
    throw new Error("KOIN Vault approval expired");
  }
}

export function getBioSigner(address: string, onExpire?: () => void): SignerInterface | null {
  const session = loadBioSession();
  return session && session.address === address ? new BioWalletSigner(session, onExpire) as unknown as SignerInterface : null;
}
