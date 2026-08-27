#!/usr/bin/env node
/* Build the trading UI for static hosting — what "npm run build" at the repo
   root produces.

   Hostinger's deploy-from-Git pipeline clones the repo, runs npm install and
   npm run build against the first package.json it finds, and publishes the
   configured output directory to public_html. Without THIS file's package.json
   at the root, that scan lands on contract/ and it publishes a compiled smart
   contract instead of the website (a 403, since there is no index.html).

   So this script is the one deploy entry point:
     1. installs and builds frontend/ (Vite),
     2. copies frontend/dist to a root-level dist/ for the publisher to pick up.

   Point the host's publish/output directory at `dist`.

   The contract address is baked in at build time. If VITE_ORDERBOOK_ADDRESS
   is not set in the build environment, the live mainnet orderbook is used —
   the same default the FTP workflow (.github/workflows/deploy-hostinger.yml)
   has always applied — so a plain `npm run build` with no configuration
   yields the real site, never the "needs configuration" screen. */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const frontend = path.join(root, 'frontend');

const env = { ...process.env };
if (!env.VITE_ORDERBOOK_ADDRESS) {
  env.VITE_ORDERBOOK_ADDRESS = '1Bke72aGbpq4brDY3m1UQxRCGBB9GPTJQz'; // live mainnet orderbook
  console.log('build-site: VITE_ORDERBOOK_ADDRESS not set — baking in the mainnet default');
}

const run = (cmd, cwd) => execSync(cmd, { cwd, env, stdio: 'inherit' });

console.log('build-site: installing frontend dependencies...');
run('npm ci --include=dev --no-audit --no-fund', frontend);

console.log('build-site: building the trading UI...');
run('npm run build', frontend);

const built = path.join(frontend, 'dist');
if (!fs.existsSync(path.join(built, 'index.html'))) {
  console.error('build-site: frontend build produced no index.html — refusing to call this a build');
  process.exit(1);
}

/* Publish the site to EVERY location a host might serve from, so the deploy
   works no matter how the pipeline is configured:

     frontend/dist/  the canonical build output
     dist/           for publishers with an "output directory" setting
     repo root       for publishers that copy the app folder itself into the
                     web root (Hostinger's git deploy does this) — index.html
                     must sit at that root or the domain 404s

   The root copy means that even with NO app configuration at all — no entry
   file, no output directory, Node not running — LiteSpeed still finds
   index.html and serves the site statically. */
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(built, out, { recursive: true });

fs.rmSync(path.join(root, 'assets'), { recursive: true, force: true });
for (const entry of fs.readdirSync(built)) {
  fs.cpSync(path.join(built, entry), path.join(root, entry), { recursive: true, force: true });
}

for (const spot of [out, root]) {
  if (!fs.existsSync(path.join(spot, 'index.html'))) {
    console.error(`build-site: no index.html at ${spot} — refusing to call this a build`);
    process.exit(1);
  }
}
console.log(`build-site: done — site published to repo root, dist/ and frontend/dist (${fs.readdirSync(built).join(', ')})`);
