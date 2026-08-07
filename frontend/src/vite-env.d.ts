/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ORDERBOOK_ADDRESS?: string;
  readonly VITE_KOINOS_RPC?: string;
  readonly VITE_KOINOS_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
