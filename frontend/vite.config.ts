import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  define: {
    // some koinos deps expect a node-style global
    global: "globalThis",
  },
});
