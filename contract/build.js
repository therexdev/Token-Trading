#!/usr/bin/env node
/**
 * Build script for the orderbook contract.
 *
 * Runs the same steps as `koinos-sdk-as-cli build-all` but invokes each
 * protoc plugin directly with retries, which is more reliable in CI and
 * sandboxed environments.
 *
 * Usage: node build.js [debug|release]
 */
const { execFileSync, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const isWindows = process.platform === "win32";

const mode = process.argv[2] === "debug" ? "debug" : "release";
const root = __dirname;
const bin = (name) =>
  path.join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);

// the protoc plugins expect node_modules/.bin on PATH (they shell out to
// `protoc` themselves), which `yarn run` normally provides
const env = {
  ...process.env,
  PATH: `${path.join(root, "node_modules", ".bin")}${path.delimiter}${process.env.PATH}`,
};

function run(cmd, args, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      if (isWindows) {
        // Node 20+ refuses to spawn .cmd shims directly (CVE-2024-27980),
        // so on Windows the command goes through the shell with each part
        // quoted to survive paths containing spaces
        const command = [cmd, ...args]
          .map((part) => (/[\s]/.test(part) ? `"${part}"` : part))
          .join(" ");
        execSync(command, { cwd: root, stdio: "inherit", env });
      } else {
        execFileSync(cmd, args, { cwd: root, stdio: "inherit", env });
      }
      return;
    } catch (error) {
      if (i === attempts) throw error;
      console.log(`step failed (attempt ${i}/${attempts}), retrying...`);
      execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]);
    }
  }
}

console.log("1/4 generating ABI...");
run(bin("protoc"), [
  `--plugin=protoc-gen-abi=${bin("koinos-abi-proto-gen")}`,
  "--abi_out=abi/",
  "assembly/proto/orderbook.proto",
]);

console.log("2/4 generating proto serializers...");
run(bin("protoc"), [
  `--plugin=protoc-gen-as=${bin("as-proto-gen")}`,
  "--as_out=.",
  "assembly/proto/orderbook.proto",
]);

console.log("3/4 generating index.ts...");
run(bin("protoc"), [
  `--plugin=protoc-gen-as=${bin("koinos-as-gen")}`,
  "--as_out=assembly/",
  "assembly/proto/orderbook.proto",
]);

console.log(`4/4 compiling contract (${mode})...`);
run("node", [
  path.join(root, "node_modules", "assemblyscript", "bin", "asc"),
  "assembly/index.ts",
  "--target", mode,
  "--use", "abort=",
  "--use", "BUILD_FOR_TESTING=0",
  "--disable", "sign-extension",
  "--config", "asconfig.json",
], 1);

const wasm = path.join(root, "build", mode, "contract.wasm");
if (!fs.existsSync(wasm)) {
  console.error("build failed: contract.wasm was not produced");
  process.exit(1);
}
console.log(`done: ${wasm} (${fs.statSync(wasm).size} bytes)`);
console.log(`      abi/orderbook.abi + abi/orderbook-abi.json`);
