// ============================================================================
// Investor-facing wording that must read the same on every surface.
// ----------------------------------------------------------------------------
// Pure and import-free, so the portal, the publication preview, the memo exports
// and the prospect link all quote ONE string and a test can pin it.
//
// The figures line replaces every description of how a figure was produced
// ("based on unapproved underwriting", "working version", a committee). An
// investor is told the figure is indicative and what it is subject to; they are
// not told which internal approval state the number happens to be in.
// ============================================================================

/** The one line that sits with every figure shown to an investor. No full stop: it is a label, not a sentence. */
export const INVESTOR_FIGURES_DISCLAIMER = "Indicative, subject to final underwriting";

/** The same statement the investor portal puts under its figures. */
export const TARGETS_DISCLAIMER =
  "Targets are estimates prepared by Reiwa Capital on the assumptions set out in the investment " +
  "materials. They are not forecasts or guarantees, and capital is at risk.";
