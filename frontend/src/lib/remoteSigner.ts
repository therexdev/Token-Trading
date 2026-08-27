import { Provider } from "koilib";
import type {
  SignerInterface,
  TransactionJson,
  TransactionJsonWait,
  SendTransactionOptions,
} from "koilib";
import { RPC_URL } from "../config/tokens";
import { SIGNER_API } from "../config/signer";

/**
 * A koilib signer that never holds a private key.
 *
 * Google accounts sign through usekoinos.com: this signer holds only a
 * short-lived session token and the account address, and asks the server to
 * sign each transaction with the key it custodies. The key never enters the
 * browser — the whole point of the server-side signer. An XSS on this page
 * can at most ask usekoinos to sign during the token's lifetime, through a
 * rate-limited endpoint; it can never steal the key.
 *
 * It implements exactly the slice of SignerInterface that koilib's
 * Transaction uses (getAddress, signTransaction, sendTransaction), mirroring
 * koilib's own Signer.sendTransaction so it is a drop-in for the Kondor
 * signer — the calling code in koinos.ts does not change.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super("Your sign-in session expired — sign in with Google again");
    this.name = "SessionExpiredError";
  }
}

export class RemoteSigner implements Partial<SignerInterface> {
  // koilib reads this; it must be the real address the server will sign for
  public readonly address: string;
  public provider: Provider;
  private token: string;
  private onExpire?: () => void;

  constructor(address: string, token: string, onExpire?: () => void) {
    this.address = address;
    this.token = token;
    this.onExpire = onExpire;
    // its own provider on the same RPC — used only to broadcast, never to sign
    this.provider = new Provider([RPC_URL]);
  }

  getAddress(): string {
    return this.address;
  }

  /**
   * Ask usekoinos to sign the prepared transaction and attach the signatures.
   * The request carries the session token and the transaction — never a key,
   * because there is none here to send.
   */
  async signTransaction(
    transaction: TransactionJson,
  ): Promise<TransactionJson> {
    let response: Response;
    try {
      response = await fetch(`${SIGNER_API}/api/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: this.token, transaction }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error("Could not reach the signing service — try again shortly");
    }

    let body: any = null;
    try {
      body = await response.json();
    } catch {
      /* fall through to status handling */
    }

    if (response.status === 401) {
      this.onExpire?.();
      throw new SessionExpiredError();
    }
    if (!response.ok || !body?.ok || !Array.isArray(body.signatures)) {
      throw new Error(body?.error || "Signing failed");
    }

    transaction.signatures = [
      ...(transaction.signatures || []),
      ...body.signatures,
    ];
    return transaction;
  }

  /**
   * Sign (remotely) then broadcast — the same two steps koilib's own
   * Signer.sendTransaction performs, so Transaction.send() behaves identically
   * to the Kondor path.
   */
  async sendTransaction(
    transaction: TransactionJson | TransactionJsonWait,
    options?: SendTransactionOptions,
  ): Promise<{ transaction: TransactionJsonWait; receipt: any }> {
    if (!transaction.signatures || !transaction.signatures.length) {
      await this.signTransaction(transaction);
    }
    return this.provider.sendTransaction(
      transaction as TransactionJsonWait,
      options?.broadcast,
    ) as Promise<{ transaction: TransactionJsonWait; receipt: any }>;
  }
}
