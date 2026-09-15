// Per-test-file setup: load .env.local, resolve the seeded test identities, and
// close the pool when the file is done.
//
// The identity load is a top-level await so it completes before the test file
// is collected — which is what lets orgUserSession()/viewerSession() stay
// synchronous while still returning a real seeded user.
import "../scripts/env";
import { afterAll } from "vitest";
import { closePool } from "@/lib/db/client";
import { loadSeededIdentities } from "./helpers";

await loadSeededIdentities();

afterAll(async () => {
  await closePool();
});
