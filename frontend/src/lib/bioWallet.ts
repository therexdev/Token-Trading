import type { SendTransactionOptions, SignerInterface, TransactionJson, TransactionJsonWait } from "koilib";

export const BIO_WALLET_API = (import.meta.env.VITE_BIO_WALLET_API || "https://wallet.usekoinos.com").replace(/\/+$/, "");
const KEY = "trade-koinos:bio-wallet:v1";

export interface BioSession { sessionId: string; secret: string; address: string; }
export interface BioPair { sessionId: string; secret: string; uri: string; expiresAt: number; }

async function json(path: string, init?: RequestInit) {
  const response = await fetch(BIO_WALLET_API + path, { ...init, signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.ok) throw new Error(body?.error || "Bio Wallet did not respond");
  return body;
}

export async function createBioPair(): Promise<BioPair> {
  return json("/api/dapp/create", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Trade Koinos", icon: `${location.origin}/favicon.svg`, walletUrl: BIO_WALLET_API }),
  });
}

export async function readBioPair(pair: Pick<BioPair, "sessionId" | "secret">) {
  return json(`/api/dapp/status?${new URLSearchParams({ sessionId: pair.sessionId, secret: pair.secret })}`);
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
  async signTransaction(): Promise<TransactionJson> {
    throw new Error("Bio Wallet signs and broadcasts after approval; use sendTransaction");
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
      if (/expired|not found/i.test(error?.message || "")) { saveBioSession(null); this.onExpire?.(); }
      throw error;
    }
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const status = await json(`/api/dapp/request-status?${new URLSearchParams({ ...this.session, requestId: request.requestId })}`);
      if (status.status === "rejected") throw new Error("Transaction rejected in Bio Wallet");
      if (status.status === "failed") throw new Error(status.error || "Bio Wallet could not submit the transaction");
      if (status.status === "approved" && status.txid) {
        const done = transaction as TransactionJsonWait;
        done.id = status.txid;
        return { transaction: done, receipt: { id: status.txid } };
      }
    }
    throw new Error("Bio Wallet approval expired");
  }
}

export function getBioSigner(address: string, onExpire?: () => void): SignerInterface | null {
  const session = loadBioSession();
  return session && session.address === address ? new BioWalletSigner(session, onExpire) as unknown as SignerInterface : null;
}
