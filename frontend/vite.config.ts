import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "koindx-static-entry",
      closeBundle() {
        // A real directory works on Hostinger and any static host without rewrites.
        const out = resolve(__dirname, "dist");
        mkdirSync(resolve(out, "koindx"), { recursive: true });
        writeFileSync(
          resolve(out, "koindx/index.html"),
          readFileSync(resolve(out, "index.html"), "utf8"),
        );
      },
    },
  ],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  define: {
    // some koinos deps expect a node-style global
    global: "globalThis",
  },
});
