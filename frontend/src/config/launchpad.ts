/**
 * The launchpad contract address. Baked at build time like the orderbook's;
 * when unset, usekoinos' /api/signer-config can supply it at runtime (the
 * store calls setLaunchpadAddress once the config probe lands), so a static
 * deploy without the env var still lights the launchpad up.
 */
let address: string = import.meta.env.VITE_LAUNCHPAD_ADDRESS || "";

export function launchpadAddress(): string {
  return address;
}

export function setLaunchpadAddress(fromServer: string | null | undefined): void {
  if (!address && fromServer) address = fromServer;
}
