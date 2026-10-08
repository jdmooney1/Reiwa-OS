// ============================================================================
// Writes to opportunities.flags / deal_investor.flags (docs/24, review
// round 2). Every write is audited by a database trigger regardless of how
// it happens (migration 0052); this is just the one path the application
// itself uses, and the one place a reason for a gated change can be
// supplied — `update ... set flags = $1` has nowhere to carry one, so it
// travels as a transaction-local GUC the guard/audit triggers both read.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import type { DealFlags } from "@/lib/deal-gates/types";

async function setFlagChangeReason(tx: Queryable, reason: string | null): Promise<void> {
  await tx.query("select set_config('app.flag_change_reason', $1, true)", [reason ?? ""]);
}

/**
 * Replaces the opportunity's flags wholesale. `reason` is required only by
 * the database when this turns regulated_disclosure off while the platform
 * default is on (migration 0052) — passing one otherwise is harmless and
 * simply logged alongside the change.
 */
export async function updateOpportunityFlags(
  session: Session, opportunityId: string, flags: DealFlags, reason: string | null = null,
): Promise<void> {
  await withSession(session, async (tx) => {
    await setFlagChangeReason(tx, reason);
    await tx.query("update opportunities set flags = $1::jsonb where opportunity_id = $2", [JSON.stringify(flags), opportunityId]);
  });
}

/** Same contract as updateOpportunityFlags, for a specific deal_investor row. */
export async function updateDealInvestorFlags(
  session: Session, dealInvestorId: string, flags: DealFlags, reason: string | null = null,
): Promise<void> {
  await withSession(session, async (tx) => {
    await setFlagChangeReason(tx, reason);
    await tx.query("update deal_investor set flags = $1::jsonb where deal_investor_id = $2", [JSON.stringify(flags), dealInvestorId]);
  });
}
