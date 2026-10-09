// Run with npm run testnet:setup (works in Windows PowerShell, WSL and Linux).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Install Node.js 22 or newer before setup');
if (!process.env.npm_execpath) throw new Error('Run this script with npm run testnet:setup');
for (const folder of ['scripts', 'contract', 'launchpad']) {
  console.log(`Installing locked dependencies: ${folder}`);
  execFileSync(process.execPath, [process.env.npm_execpath, 'ci', '--ignore-scripts', '--prefix', folder], { cwd: root, stdio: 'inherit' });
}
const cli = path.join(__dirname, 'testnet-rehearsal.js');
if (!fs.existsSync(path.join(root, '.testnet-rehearsal/state.json'))) execFileSync(process.execPath, [cli, 'init'], { cwd: root, stdio: 'inherit' });
if (!fs.existsSync(path.join(root, '.testnet-rehearsal/build/manifest.json'))) execFileSync(process.execPath, [cli, 'build'], { cwd: root, stdio: 'inherit' });
console.log('Setup complete. Run npm run testnet:check to verify the Foundation Harbinger RPC. No transaction has been sent.');
