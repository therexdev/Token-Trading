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

console.log("1/6 generating ABI...");
run(bin("protoc"), [
  `--plugin=protoc-gen-abi=${bin("koinos-abi-proto-gen")}`,
  "--abi_out=abi/",
  "assembly/proto/orderbook.proto",
]);

console.log("2/6 generating proto serializers...");
run(bin("protoc"), [
  `--plugin=protoc-gen-as=${bin("as-proto-gen")}`,
  "--as_out=.",
  "assembly/proto/orderbook.proto",
]);

console.log("3/6 generating index.ts...");
run(bin("protoc"), [
  `--plugin=protoc-gen-as=${bin("koinos-as-gen")}`,
  "--as_out=assembly/",
  "assembly/proto/orderbook.proto",
]);

console.log(`4/6 compiling contract (${mode})...`);
// The Koinos node instantiates the module and then calls its exported
// _start function (which must contain static initialization plus the
// generated top-level main() call). --exportStart produces exactly that
// instead of a wasm start section, which would wrongly execute the
// contract during instantiation.
// The VM also only implements WebAssembly MVP, so every post-MVP feature
// AssemblyScript enables by default must be disabled (and what asc cannot
// disable is lowered by wasm-opt in the next step).
run("node", [
  path.join(root, "node_modules", "assemblyscript", "bin", "asc"),
  "assembly/index.ts",
  "--target", mode,
  "--use", "abort=",
  "--use", "BUILD_FOR_TESTING=0",
  "--exportStart", "_start",
  "--disable", "sign-extension,bulk-memory,nontrapping-f2i,multi-value",
  "--config", "asconfig.json",
], 1);

const wasm = path.join(root, "build", mode, "contract.wasm");
const wat = path.join(root, "build", mode, "contract.wat");
if (!fs.existsSync(wasm)) {
  console.error("build failed: contract.wasm was not produced");
  process.exit(1);
}

// asc 0.27 ignores `--disable bulk-memory` for stdlib memory.copy/fill,
// so lower every post-MVP instruction with binaryen and strip metadata
console.log("5/6 lowering to WebAssembly MVP (Koinos VM compatibility)...");
run(bin("wasm-opt"), [
  wasm,
  "-all",
  "--llvm-memory-copy-fill-lowering",
  "--signext-lowering",
  "--llvm-nontrapping-fptoint-lowering",
  "-O1",
  "--mvp-features",
  "--strip-debug",
  "--strip-producers",
  "-o", wasm,
], 1);
run(bin("wasm-dis"), [wasm, "-o", wat], 1);

console.log("6/6 verifying MVP compatibility...");

// verify the module stays within WebAssembly MVP (what Fizzy parses):
// no section id above 11 (12 = DataCount from bulk memory) and no
// post-MVP instructions in the text output
function verifyMvp(wasmPath, watPath) {
  const buffer = fs.readFileSync(wasmPath);
  let offset = 8; // magic + version
  while (offset < buffer.length) {
    const id = buffer[offset];
    offset += 1;
    let size = 0;
    let shift = 0;
    for (;;) {
      const byte = buffer[offset];
      offset += 1;
      size |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    if (id > 11) {
      throw new Error(
        `contract.wasm contains section id ${id}, which the Koinos VM cannot parse`
      );
    }
    offset += size;
  }
  if (fs.existsSync(watPath)) {
    const wat = fs.readFileSync(watPath, "utf8");
    const forbidden = wat.match(
      /memory\.(copy|fill|init)|data\.drop|table\.(copy|init)|extend8_s|extend16_s|extend32_s|trunc_sat/
    );
    if (forbidden) {
      throw new Error(
        `contract.wat contains post-MVP instruction "${forbidden[0]}", which the Koinos VM cannot run`
      );
    }
  }
}
verifyMvp(wasm, wat);

console.log(`done: ${wasm} (${fs.statSync(wasm).size} bytes, MVP-verified)`);
console.log(`      abi/orderbook.abi + abi/orderbook-abi.json`);
