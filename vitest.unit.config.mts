// ============================================================================
// Unit tests — no database, no global setup, no reset.
// ----------------------------------------------------------------------------
// The integration config (vitest.config.mts) drops and reseeds a database in
// its global setup. Everything under tests/unit/ must be runnable without one:
// these are the tests that prove the destructive-reset gate REFUSES, and they
// have to be runnable by somebody who has not yet provisioned a test database —
// which is exactly the person most likely to trip the gate.
//
//   npm run test:unit
// ============================================================================
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    // Deliberately no globalSetup and no setupFiles: nothing here may open a
    // connection, so there is nothing to set up and nothing to tear down.
  },
});
