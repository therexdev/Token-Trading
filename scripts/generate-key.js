// Generate a fresh Koinos key pair for the orderbook contract account.
//
// The address printed here becomes the on-chain address of the DEX contract
// once you deploy to it. Keep the WIF safe: it is also the admin key that
// creates markets.

import { Signer } from "koilib";
import crypto from "crypto";

const signer = new Signer({
  privateKey: crypto.randomBytes(32).toString("hex"),
});

console.log("Generated a new Koinos account for the orderbook contract:\n");
console.log(`  address : ${signer.getAddress()}`);
console.log(`  wif     : ${signer.getPrivateKey("wif")}`);
console.log(`
Next steps:
  1. Store the WIF somewhere safe (password manager). Anyone with this key
     controls the DEX contract and its escrowed funds.
  2. Send a small amount of KOIN to the address so it has mana to deploy.
  3. Deploy:          KOINOS_WIF=<wif> npm run deploy
  4. Create markets:  KOINOS_WIF=<wif> npm run create-markets
`);
