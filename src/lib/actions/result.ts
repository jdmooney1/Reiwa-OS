// ============================================================================
// One shape for every workspace write, and one place that decides what the
// person is told.
// ----------------------------------------------------------------------------
// The workspace actions threw. Next caught that at the route boundary, so an
// oversized upload, a duplicate click or a missing title replaced the whole
// investment file with "This screen could not be loaded" — and the message that
// had been carefully written for that exact case ("The file is larger than the
// 50 MB limit") reached nobody. Recoverable and catastrophic were the same
// thing to the UI because they were the same thing to the action.
//
// They are separated here, once:
//
//   RECOVERABLE  something the person can see and fix from this screen. Comes
//                back as { error }, is rendered next to the control that caused
//                it, and the page stays exactly where it was.
//   UNEXPECTED   a fault. Logged with full context through reportError, then
//                RETHROWN so the route boundary still handles it and Next still
//                assigns its digest. Nothing about it is shown.
//
// Three kinds of thing count as recoverable, and nothing else does:
//
//   * An AppError. That class already means "a message written FOR the person
//     reading it", so it is the existing signal rather than a new one.
//   * A business rule the DATABASE refused — Postgres `raise exception`, which
//     arrives as SQLSTATE P0001. The trigger's own text is never shown: it
//     embeds row ids ("Approved investment case <uuid> is immutable") and
//     naming a real identifier to whoever is probing is precisely what
//     errors.ts exists to prevent. The caller supplies the sentence instead.
//   * Nothing else. A permission denial, a connection failure, a constraint
//     violation the app did not anticipate — all faults, all the boundary's.
//
// This file is the SHAPE ONLY, and imports nothing.
//
// That is not tidiness. The classifier reaches reportError, which reaches
// node:crypto, and a client component importing ACTION_IDLE from here would
// drag all of it into the browser bundle — which is how server logic ends up
// shipped. The classifier lives next door in ./run-action, which only the
// server ever imports.
// ============================================================================

/**
 * What every workspace write returns.
 *
 * Deliberately the same shape the portal and admin forms already use with
 * `useFormState`, so this is one convention rather than a second one.
 */
export interface ActionResult {
  ok?: boolean;
  /** Safe to display, always. Never a database message, never a stack. */
  error?: string;
}

/** The initial state for a form that has not been submitted yet. */
export const ACTION_IDLE: ActionResult = {};
