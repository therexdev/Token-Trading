export interface TokenConfig {
  symbol: string;
  name: string;
  address: string;
  /** fallback until on-chain decimals are fetched */
  decimals: number;
  /** KCS-4 allowance token: the dapp adds an approve op before escrow pulls */
  allowances: boolean;
  /**
   * system contract name on the REST API. KOIN's storage lives in system
   * space, so `read_contract` cannot serve balance_of in user mode; the REST
   * endpoint /v1/token/{name}/balance/{account} runs it with kernel
   * privileges instead.
   */
  restName?: string;
  color: string;
  /**
   * true for tokens discovered on-chain from permissionless listings
   * (metadata probed via read_contract, not curated in this config)
   */
  dynamic?: boolean;
}

/**
 * Retired pre-migration system contracts. Their storage is system-locked —
 * every call fails with "user code cannot access system space" — so they are
 * never probed and markets against them stay hidden.
 */
export const RETIRED_ADDRESSES: string[] = [
  "15DJN4a8SgrbGhhGksSBASiSYjGnMU8dGL", // retired KOIN
  "18tWNU7E4yuQzz7hMVpceb9ixmaWLVyQsr", // retired VHP
];

export const ORDERBOOK_ADDRESS: string =
  import.meta.env.VITE_ORDERBOOK_ADDRESS || "";

// One or more JSON-RPC endpoints, comma-separated. Extra nodes act as
// failover: koilib's Provider moves to the next when one errors, so a single
// node answering get_markets with "context deadline exceeded" becomes a retry
// on another node instead of a blank market screen. Add one with
// VITE_KOINOS_RPC="https://api.koinos.io,https://second-node".
export const RPC_URLS: string[] = (
  import.meta.env.VITE_KOINOS_RPC ||
  "https://api.koinos.io,https://api.koinosblocks.com"
)
  .split(",")
  .map((url: string) => url.trim())
  .filter(Boolean);

export const RPC_URL: string = RPC_URLS[0] || "https://api.koinos.io";

/** REST API base (same host as the JSON-RPC endpoint unless overridden) */
export const REST_URL: string =
  import.meta.env.VITE_KOINOS_REST || RPC_URL.replace(/\/+$/, "");

export const NETWORK: string =
  import.meta.env.VITE_KOINOS_NETWORK || "mainnet";

export const EXPLORER_TX = (id: string) =>
  `https://koinosblocks.com/tx/${encodeURIComponent(id)}`;

export const TOKENS: TokenConfig[] = [
  {
    // 19GYj... is the LIVE KOIN token contract. The widely-cited 15DJN...
    // address is the retired pre-migration contract whose storage is
    // system-locked (calls fail with "user code cannot access system space").
    symbol: "KOIN",
    name: "Koin",
    address: "19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK",
    decimals: 8,
    allowances: true,
    color: "#4f8cff",
  },
  {
    // 12Y5vW6... is the LIVE VHP token contract (KCS-4 allowances, normal
    // user-space storage readable via read_contract). The widely-cited
    // 18tWNU7E4yuQzz7hMVpceb9ixmaWLVyQsr address is the RETIRED
    // pre-migration VHP whose storage is system-locked — calling it fails
    // with "user code cannot access system space", the same trap as the
    // retired 15DJN... KOIN address (verified against the chain's name
    // service: get_contract_address("vhp")).
    symbol: "VHP",
    name: "Virtual Hash Power",
    address: "12Y5vW6gk8GceH53YfRkRre2Rrcsgw7Naq",
    decimals: 8,
    allowances: true,
    color: "#e8a33d",
  },
  {
    symbol: "vUSDT",
    name: "Virtual USDT",
    address: "12VoHz41a4HtfiyhTWbg9RXqGMRbYk6pXh",
    decimals: 8,
    allowances: true,
    color: "#26a17b",
  },
  {
    symbol: "vUSDC",
    name: "Virtual USDC",
    address: "1N8iYrYEJdCVK1rhbqv3qZUzHcpoeKmFnj",
    decimals: 8,
    allowances: true,
    color: "#2775ca",
  },
  {
    symbol: "vETH",
    name: "Virtual ETH",
    address: "1Tf1QKv3gVYLjq34yURSHw5ErTYbFjqTG",
    decimals: 8,
    allowances: true,
    color: "#8c8c9e",
  },
];

export function tokenByAddress(address: string): TokenConfig | undefined {
  return TOKENS.find((token) => token.address === address);
}

export function tokenBySymbol(symbol: string): TokenConfig | undefined {
  return TOKENS.find((token) => token.symbol === symbol);
}
