// ============================================================================
// Which memos may be translated, and which translations may be saved. PURE.
// ----------------------------------------------------------------------------
// One rule, kept out of the server actions so it can be tested without a session:
// a translation is drafted for, and saved into, a DRAFT and nowhere else. A final memo
// is the document that was sent, in the language it was sent; a Japanese rendering
// attached to it afterwards would be a different document wearing the same version
// number. Translate the next version instead.
// ============================================================================

export function translationRefusalReason(status: "draft" | "final"): string | null {
  return status === "draft"
    ? null
    : "Only a draft memo can be translated. This memo is final: create a new version to translate it.";
}
