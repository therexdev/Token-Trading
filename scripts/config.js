// Shared configuration for deployment / admin scripts

export const RPC_URLS = {
  mainnet: [process.env.KOINOS_RPC || "https://api.koinos.io"],
  harbinger: [process.env.KOINOS_RPC || "https://harbinger-api.koinos.io"],
};

// Token registry. The v-tokens implement KCS-4 allowances, so the dapp
// includes an `approve` operation before any transaction that makes the
// orderbook contract pull them. KOIN authorizes transfers directly from the
// transaction signature.
export const TOKENS = {
  mainnet: {
    // NOTE: the widely-cited 15DJN4a8SgrbGhhGksSBASiSYjGnMU8dGL address is the
    // RETIRED pre-migration KOIN contract (its storage is system-locked and
    // calling it fails with "user code cannot access system space"). The live
    // KOIN token contract is 19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK.
    KOIN: {
      address: "19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK",
      allowances: true,
    },
    VHP: {
      // 12Y5vW6... is the LIVE VHP contract (KCS-4 allowances). The
      // widely-cited 18tWNU7E4yuQzz7hMVpceb9ixmaWLVyQsr address is the
      // RETIRED pre-migration VHP with system-locked storage — markets
      // created against it fail every escrow pull with "user code cannot
      // access system space".
      address: "12Y5vW6gk8GceH53YfRkRre2Rrcsgw7Naq",
      allowances: true,
    },
    vUSDT: {
      address: "12VoHz41a4HtfiyhTWbg9RXqGMRbYk6pXh",
      allowances: true,
    },
    vUSDC: {
      address: "1N8iYrYEJdCVK1rhbqv3qZUzHcpoeKmFnj",
      allowances: true,
    },
    vETH: {
      address: "1Tf1QKv3gVYLjq34yURSHw5ErTYbFjqTG",
      allowances: true,
    },
  },
  // On harbinger provide your own test token addresses via environment
  // variables before running create-markets.
  harbinger: {
    KOIN: {
      address: process.env.HARBINGER_KOIN || "1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju",
      allowances: false,
    },
    VHP: { address: process.env.HARBINGER_VHP || "", allowances: true },
    vUSDT: { address: process.env.HARBINGER_VUSDT || "", allowances: true },
    vUSDC: { address: process.env.HARBINGER_VUSDC || "", allowances: true },
    vETH: { address: process.env.HARBINGER_VETH || "", allowances: true },
  },
};

// Markets to ensure exist: [base, quote]. Prices are quoted in the quote
// token per base token. Every market is created with the minimum order size
// set to one smallest unit of the base token — there is no artificial
// minimum; the contract rejects orders whose value rounds to zero anyway.
// Re-running create-markets is safe — pairs that already exist are skipped.
export const MARKETS = [
  ["KOIN", "vUSDT"],
  ["KOIN", "vUSDC"],
  ["KOIN", "vETH"],
  ["VHP", "KOIN"],
  ["VHP", "vUSDT"],
  ["VHP", "vUSDC"],
  ["VHP", "vETH"],
  ["vETH", "vUSDT"],
  ["vETH", "vUSDC"],
  ["vUSDT", "vUSDC"],
];

export function getNetwork() {
  const network = process.env.KOINOS_NETWORK || "mainnet";
  if (!RPC_URLS[network]) {
    throw new Error(`unknown network "${network}" (use mainnet or harbinger)`);
  }
  return network;
}

export function requireWif() {
  const wif = process.env.KOINOS_WIF;
  if (!wif) {
    throw new Error(
      "set KOINOS_WIF to the private key (WIF) of the contract account"
    );
  }
  return wif;
}
