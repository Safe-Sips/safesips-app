import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Bundle the shared package from its TypeScript source so Vite/Rollup can
// resolve its named exports directly (the CommonJS dist build trips up
// Rollup's static `export *` analysis). Types still resolve from dist.
const sharedSrc = fileURLToPath(
  new URL("../shared/src/index.ts", import.meta.url)
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@safesips/shared": sharedSrc,
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [fileURLToPath(new URL("..", import.meta.url))],
    },
  },
});
