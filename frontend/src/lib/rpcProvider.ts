import { Provider } from "koilib";
import { RPC_URLS } from "../config/tokens";

/**
 * A koilib Provider that actually fails over across the configured RPC nodes.
 *
 * koilib does NOT fail over on its own. On any error `Provider.call` advances
 * to the next node and then asks `onError` whether to stop — and the default
 * `onError` is `() => true`, i.e. give up immediately. So handing the Provider
 * a list of nodes changes nothing until you replace `onError`: one node
 * answering "context deadline exceeded" just throws instead of trying the
 * backup.
 *
 * This installs an `onError` that fails over **only for transport / node-side
 * problems** (timeouts, 5xx, dropped connections) and gives up once every node
 * has been tried. A genuine error — a contract revert, bad arguments — is thrown
 * at once: retrying those on the backup would only double the load and bury the
 * real message behind a second, identical failure.
 */
export function createProvider(): Provider {
  const provider = new Provider(RPC_URLS);
  provider.onError = (error: unknown, _failedNode: string, nextNode: string) => {
    const message = String((error as any)?.message ?? error ?? "");
    const transient =
      /deadline exceeded|timeout|timed out|failed to fetch|networkerror|network error|internal server error|bad gateway|service unavailable|gateway timeout|50[234]|econn|socket hang|fetch/i.test(
        message
      );
    // true = stop and throw; false = try `nextNode`.
    if (!transient) return true;
    // Stop once we've wrapped back to the first node (every node tried once).
    return RPC_URLS.length <= 1 || nextNode === RPC_URLS[0];
  };
  return provider;
}
