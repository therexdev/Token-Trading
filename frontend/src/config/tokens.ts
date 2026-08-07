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
}

export const ORDERBOOK_ADDRESS: string =
  import.meta.env.VITE_ORDERBOOK_ADDRESS || "";

export const RPC_URL: string =
  import.meta.env.VITE_KOINOS_RPC || "https://api.koinos.io";

/** REST API base (same host as the JSON-RPC endpoint unless overridden) */
export const REST_URL: string =
  import.meta.env.VITE_KOINOS_REST || RPC_URL.replace(/\/+$/, "");

export const NETWORK: string =
  import.meta.env.VITE_KOINOS_NETWORK || "mainnet";

export const EXPLORER_TX = (id: string) =>
  `https://koinosblocks.com/tx/${encodeURIComponent(id)}`;

export const TOKENS: TokenConfig[] = [
  {
    symbol: "KOIN",
    name: "Koin",
    address: "15DJN4a8SgrbGhhGksSBASiSYjGnMU8dGL",
    decimals: 8,
    allowances: false,
    restName: "koin",
    color: "#4f8cff",
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
