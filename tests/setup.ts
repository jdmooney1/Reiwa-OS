// Per-test-file setup: load .env.local, resolve the seeded test identities, and
// close the pool when the file is done.
//
// The identity load is a top-level await so it completes before the test file
// is collected — which is what lets orgUserSession()/viewerSession() stay
// synchronous while still returning a real seeded user.
// Each worker is a separate process with its own pool AND its own Supabase
// clients, so each one has to be pointed at the test environment itself — an
// arming applied in the global setup does not cross the process boundary. That
// matters for both halves here: document-delivery.test.ts uploads real bytes to
// a Storage bucket from a worker, so a worker that had only its database
// redirected would put those objects in the application's project.
//
// The reset opt-in is NOT required: this process resets nothing, and demanding
// the destructive flag for a read-write worker would only encourage exporting it
// permanently.
import { useTestEnvironment } from "./test-environment";
import { afterAll } from "vitest";
import { closePool } from "@/lib/db/client";
import { loadSeededIdentities } from "./helpers";

useTestEnvironment("connect");

await loadSeededIdentities();

afterAll(async () => {
  await closePool();
});
