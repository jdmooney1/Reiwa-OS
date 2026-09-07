// ============================================================================
// Failure handling (P6) — what an operator sees, and what a visitor never does.
// ----------------------------------------------------------------------------
// A failure has two audiences with opposite needs.
//
// The server log needs everything: the SQLSTATE, the constraint, the table, the
// stack, the identifiers involved. Without those a production incident is
// guesswork.
//
// The screen needs almost nothing. A database message is a map of the schema:
// `duplicate key value violates unique constraint
// "investor_contacts_email_key"` names a table, a column and a rule, and
// `permission denied for table publication_documents` confirms a table exists
// and that the caller was refused by policy — which is exactly what somebody
// probing the boundary wants to learn. None of it helps the person reading it,
// because none of it is anything they can act on.
//
// So: everything to the log, a neutral sentence and a reference to the screen.
// The reference is what ties one to the other when an investor emails to say
// something broke.
//
// SERVER-ONLY for the reporting half; publicMessage() is safe anywhere.
// ============================================================================
import { randomUUID } from "node:crypto";

/**
 * A failure whose message was written FOR the person reading it: "The file is
 * larger than the 50 MB limit", not "value too long for type character
 * varying". Only these messages are ever displayed.
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

/** What is shown when there is nothing safe to say. */
export const NEUTRAL_MESSAGE =
  "Something went wrong at our end. Please try again, or contact Reiwa Capital if it persists.";

/**
 * The message to display for a failure.
 *
 * An AppError speaks for itself. Everything else — a pg error, a fetch failure,
 * a TypeError, anything thrown by a dependency — collapses to the neutral
 * sentence, whatever it happens to contain.
 */
export function publicMessage(error: unknown): string {
  return error instanceof AppError ? error.message : NEUTRAL_MESSAGE;
}

/**
 * True if a string looks like it carries internals: a SQLSTATE, a stack frame,
 * a schema-qualified name, a constraint, or a uuid. Used by the tests that pin
 * this rule, and by assertSafeForDisplay below.
 */
export function looksInternal(text: string): boolean {
  return (
    /\b\d{2}[A-Z0-9]{3}\b/.test(text) ||                       // SQLSTATE, e.g. 42501, 23505
    /\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(text) ||                // stack frame
    /\b(public|app|auth|storage)\.[a-z_]+/.test(text) ||       // schema-qualified name
    /\bconstraint\b|\bviolates\b|\brelation\b|\bpg_[a-z]+\b/i.test(text) ||
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)
  );
}

/**
 * Belt and braces for a message about to be displayed. An AppError whose text
 * was accidentally built from a database message is downgraded to the neutral
 * sentence rather than shown.
 */
export function assertSafeForDisplay(message: string): string {
  return looksInternal(message) ? NEUTRAL_MESSAGE : message;
}

interface ReportedError {
  reference: string;
  message: string;
}

/**
 * Log a failure with everything an operator needs, and return the neutral
 * message plus a short reference to show.
 *
 * `scope` is the operation, not the data: "portal.document.download", not the
 * document id. The identifiers go in `context`, which is logged and never
 * returned.
 */
export function reportError(
  scope: string, error: unknown, context: Record<string, unknown> = {},
): ReportedError {
  const reference = randomUUID().slice(0, 8);
  const err = error as { code?: string; detail?: string; constraint?: string; table?: string };

  console.error(
    `[reiwa] ${scope} failed (ref ${reference})`,
    {
      ...context,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      // pg attaches these; they are the useful half of a database failure.
      code: err?.code,
      detail: err?.detail,
      constraint: err?.constraint,
      table: err?.table,
    },
    error instanceof Error ? error.stack : undefined,
  );

  return {
    reference,
    message: error instanceof AppError
      ? assertSafeForDisplay(error.message)
      : NEUTRAL_MESSAGE,
  };
}
