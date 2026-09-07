// Operator-facing failure reporting for the CLI scripts (P6).
//
// A dropped pooler socket can surface as an uncaught 'error' event on a client
// rather than a rejected promise, which Node prints as a bare stack ending in
// `at TCP.<anonymous>`. That tells an operator nothing. This turns it into a
// sentence that says what happened and what to do — without swallowing it: the
// exit code is still non-zero, and the underlying detail is still printed.
const TRANSIENT = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN|Connection terminated|57P01|57P03|08006|08001|08004/i;

export function reportFailure(label: string, e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string })?.code;

  if (TRANSIENT.test(message) || (code && TRANSIENT.test(code))) {
    console.error(
      `\n${label} failed on a transient database connection error` +
      (code ? ` [${code}]` : "") + `: ${message}\n` +
      `The Supabase pooler dropped the connection. Nothing was half-applied — each\n` +
      `migration runs in its own transaction and rolls back on failure. Re-run the\n` +
      `same command; if it keeps happening, check Supabase → Database → Health.`);
  } else {
    console.error(`\n${label} failed: ${message}`);
    if (e instanceof Error && e.stack) console.error(e.stack);
  }
  process.exitCode = 1;
}

/** Catch the socket errors that arrive outside the promise chain. */
export function installFailureHandlers(label: string): void {
  process.on("uncaughtException", (e) => { reportFailure(label, e); process.exit(1); });
  process.on("unhandledRejection", (e) => { reportFailure(label, e); process.exit(1); });
}
