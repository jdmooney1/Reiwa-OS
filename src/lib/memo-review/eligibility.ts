// ============================================================================
// Which memos may be reviewed. PURE.
// ----------------------------------------------------------------------------
// One rule, kept out of the server action so it can be tested without a session,
// a cookie or a database: a review runs on a DRAFT and nowhere else.
//
// Why refuse on a final memo rather than simply allow a harmless read: a final
// memo is the document a decision was made on, and the question this feature
// exists to answer later is "was this reviewed BEFORE it went out". Letting a
// review attach to a memo after finalisation would make that question
// unanswerable from the record - a row's existence would no longer mean the
// check happened in time. Review the next version instead.
// ============================================================================

/**
 * The sentence to refuse with, or null when this memo may be reviewed.
 * A string here never reaches the model: the action stops first.
 */
export function reviewRefusalReason(status: "draft" | "final"): string | null {
  return status === "draft"
    ? null
    : "Only a draft memo can be reviewed. This memo is final: create a new version to review it.";
}
