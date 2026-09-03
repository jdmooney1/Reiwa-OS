// Per-test-file setup: load .env.local and close the pool when the file is done.
import "../scripts/env";
import { afterAll } from "vitest";
import { closePool } from "@/lib/db/client";

afterAll(async () => {
  await closePool();
});
