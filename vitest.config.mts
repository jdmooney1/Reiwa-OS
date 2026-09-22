import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// Two suites, deliberately separate.
//
//   unit        — pure logic beside the code it tests (src/**/*.test.ts). No
//                 database, no network, no setup. Milliseconds. This is where
//                 scoring, screens, tax arithmetic and formatting belong.
//   integration — the real thing against Postgres (tests/*.test.ts). Proves RLS,
//                 isolation and lifecycle behaviour, which nothing else can.
//                 Needs a database: `npm run db:local` starts one offline.
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          globals: true,
          include: ["src/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          globals: true,
          include: ["tests/**/*.test.ts"],
          // These hit a real Postgres over a connection, local or hosted.
          testTimeout: 120000,
          hookTimeout: 180000,
          globalSetup: ["tests/global-setup.ts"],
          setupFiles: ["tests/setup.ts"],
          // One shared database: files must not interleave.
          fileParallelism: false,
          sequence: { concurrent: false },
        },
      },
    ],
  },
});
