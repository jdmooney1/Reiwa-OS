// Per-test-file setup: load .env.local, resolve the seeded test identities, and
// close the pool when the file is done.
//
// The identity load is a top-level await so it completes before the test file
// is collected — which is what lets orgUserSession()/viewerSession() stay
// synchronous while still returning a real seeded user.
// Each worker is a separate process with its own pool, so each one has to be
// pointed at the test database itself — a redirect applied in the global setup
// does not cross the process boundary. The reset opt-in is NOT required here:
// this process resets nothing, and demanding the destructive flag for a
// read-write worker would only encourage exporting it permanently.
import { useTestDatabase } from "./test-database-env";
import { afterAll } from "vitest";
import { closePool } from "@/lib/db/client";
import { loadSeededIdentities } from "./helpers";

useTestDatabase("connect");

await loadSeededIdentities();

afterAll(async () => {
  await closePool();
});
