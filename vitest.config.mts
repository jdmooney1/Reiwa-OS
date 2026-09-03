import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    globals: true,
    // Integration tests hit the real Supabase Postgres over the network.
    testTimeout: 120000,
    hookTimeout: 180000,
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // One shared database: files must not interleave.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
