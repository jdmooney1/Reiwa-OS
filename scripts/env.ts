// Load .env.local (then .env) for CLI scripts and integration tests. Next.js does
// this automatically for the app; standalone Node processes do not.
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { requireEnvironment } from "@/lib/env";

for (const file of [".env.local", ".env"]) {
  const path = join(process.cwd(), file);
  if (existsSync(path)) config({ path, quiet: true });
}

/**
 * Fail unless every required variable is present.
 *
 * One list, shared with the application (src/lib/env.ts), so a script and a
 * request can never disagree about what "configured" means — and neither has a
 * default to fall back on.
 */
export function requireEnv(): void {
  requireEnvironment();
}
