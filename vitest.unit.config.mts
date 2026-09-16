// ============================================================================
// Unit suite — no database, no network.
// ----------------------------------------------------------------------------
// Everything under tests/unit exercises pure logic: header mapping, value
// parsing, address normalisation, match scoring, status derivation. These run
// anywhere in milliseconds, which is what makes them useful in CI where the
// integration suite's Supabase credentials are not available.
//
// The integration suite (vitest.config.mts) is unchanged: it still drops,
// migrates and seeds the real database once per run.
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
    // Deliberately no globalSetup and no setupFiles: a unit test that needs a
    // database is a unit test in the wrong directory.
  },
});
