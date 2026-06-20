import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // Emit .d.ts (ESM) and .d.cts (CJS) so the condition-split `exports`
  // map in package.json resolves correct types for both module systems.
  dts: true,
  // Critical for are-the-types-wrong: makes the CJS output interoperate so
  // `require("mcp-cache-kit")` exposes named exports correctly.
  cjsInterop: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  target: "node20",
  outDir: "dist",
});
