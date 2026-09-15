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
    // e2e specs are Playwright's, not vitest's. tests/unit/** is excluded
    // because those tests must run WITHOUT a database — they are the ones that
    // prove the destructive-reset gate refuses, and a suite that reset a
    // database in order to test the guard against resetting a database would be
    // a poor joke. They have their own config: `npm run test:unit`.
    exclude: ["e2e/**", "tests/unit/**", "node_modules/**"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // One shared database: files must not interleave.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
