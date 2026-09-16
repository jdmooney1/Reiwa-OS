// ============================================================================
// Deciding what a failed workspace write means. SERVER-ONLY.
// ----------------------------------------------------------------------------
// Kept apart from ./result, which carries the shape a client component needs.
// This half reaches reportError and therefore node:crypto, so importing it from
// a client component would pull the error-reporting machinery into the browser.
// See the note in ./result.
// ============================================================================
import { AppError, assertSafeForDisplay, reportError } from "@/lib/errors";
import type { ActionResult } from "@/lib/actions/result";

/** Postgres `raise exception` — a rule in a trigger refusing the write. */
const RULE_VIOLATION = "P0001";

function sqlState(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

/**
 * Next signals `redirect()` and `notFound()` by THROWING, and the framework
 * catches them to do the navigation.
 *
 * Nothing here may touch one. Reporting it would fill the log with failures
 * that are not failures, and returning it as `{ error }` would swallow the
 * navigation entirely and leave the person on a screen that quietly did
 * nothing. None of the actions wrapped today redirect — but the next one to be
 * written might, and this is not a trap worth leaving for them.
 */
function isFrameworkControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string"
    && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

export interface RunActionOptions {
  /**
   * What to say when the DATABASE refuses the write by raising.
   *
   * Written by the caller because only the caller knows what the person was
   * trying to do: "Approved underwriting cannot be edited" reads correctly on
   * the underwriting screen and nowhere else. Omitted, a rule violation is
   * treated as a fault and reaches the boundary — which is the right default,
   * because an unanticipated rule firing is news.
   */
  ruleMessage?: string;
}

/**
 * Run a workspace write and classify whatever comes back out of it.
 *
 * `scope` is the operation, not the data — "workspace.document.upload" — and
 * `context` carries the identifiers, which are logged and never returned.
 */
export async function runAction(
  scope: string,
  context: Record<string, unknown>,
  fn: () => Promise<void>,
  options: RunActionOptions = {},
): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    // A navigation, not a failure. Straight back out, unlogged and unaltered.
    if (isFrameworkControlFlow(error)) throw error;

    // Written for a person. Shown as-is, after the same belt-and-braces check
    // every displayed message goes through.
    if (error instanceof AppError) {
      return { error: assertSafeForDisplay(error.message) };
    }

    // A rule in the database refused this, and the caller has a sentence for
    // it. Logged anyway: knowing which rule fires, and how often, is how you
    // find out the screen is letting people attempt something it should not be
    // offering them.
    if (sqlState(error) === RULE_VIOLATION && options.ruleMessage) {
      reportError(scope, error, { ...context, refusedBy: "database rule" });
      return { error: assertSafeForDisplay(options.ruleMessage) };
    }

    // A fault. Everything to the log, and on to the boundary.
    reportError(scope, error, context);
    throw error;
  }
}
