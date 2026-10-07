// ============================================================================
// The investor tracker (docs/24) — one row per deal_investor, with the
// gated/non-gated document progress split agreed for the wireframe and how
// the investor was introduced (direct, or via a prospect link).
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";

export interface DealInvestorRow {
  dealInvestorId: string;
  investorOrgId: string;
  investorOrgName: string;
  status: string;
  investorType: string | null;
  firstIntroducedAt: string;
  introducedVia: "direct" | "prospect_link";
  /** Gated (gate_kind <> 'none') investor-scoped documents — the primary count. */
  gatedTotal: number;
  gatedCleared: number;
  /** Non-gated investor-scoped documents — shown as a secondary count. */
  nonGatedTotal: number;
  nonGatedCleared: number;
}

export async function listDealInvestors(session: Session, opportunityId: string): Promise<DealInvestorRow[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      `select di.deal_investor_id, di.investor_org_id, io.name as investor_org_name, di.status,
              di.investor_type, di.first_introduced_at, di.originating_share_id,
              dt.gate_kind, dd.status as doc_status
         from deal_investor di
         join investor_organizations io on io.investor_org_id = di.investor_org_id
         left join deal_document dd on dd.deal_investor_id = di.deal_investor_id
         left join doc_type dt on dt.key = dd.doc_type_key
        where di.opportunity_id = $1
        order by di.first_introduced_at`,
      [opportunityId]);

    const byInvestor = new Map<string, DealInvestorRow>();
    for (const r of rows) {
      let row = byInvestor.get(r.deal_investor_id);
      if (!row) {
        row = {
          dealInvestorId: r.deal_investor_id, investorOrgId: r.investor_org_id, investorOrgName: r.investor_org_name,
          status: r.status, investorType: r.investor_type, firstIntroducedAt: r.first_introduced_at,
          introducedVia: r.originating_share_id ? "prospect_link" : "direct",
          gatedTotal: 0, gatedCleared: 0, nonGatedTotal: 0, nonGatedCleared: 0,
        };
        byInvestor.set(r.deal_investor_id, row);
      }
      if (r.gate_kind == null) continue; // the left join found no document row at all
      const cleared = r.doc_status === "final" || r.doc_status === "signed";
      if (r.gate_kind === "none") {
        row.nonGatedTotal += 1;
        if (cleared) row.nonGatedCleared += 1;
      } else {
        row.gatedTotal += 1;
        if (cleared) row.gatedCleared += 1;
      }
    }
    return Array.from(byInvestor.values());
  });
}

export async function createDealInvestor(
  session: Session, opportunityId: string, investorOrgId: string,
  input: { investorType?: string | null; originatingShareId?: string | null } = {},
): Promise<string> {
  return withSession(session, async (tx) => {
    const opp = await tx.query<{ org_id: string }>("select org_id from opportunities where opportunity_id = $1", [opportunityId]);
    if (!opp.rows[0]) throw new Error("Opportunity not found or not permitted");
    const res = await tx.query<{ deal_investor_id: string }>(
      `insert into deal_investor (org_id, opportunity_id, investor_org_id, introduced_by, investor_type, originating_share_id)
       values ($1,$2,$3,$4,$5,$6) returning deal_investor_id`,
      [opp.rows[0].org_id, opportunityId, investorOrgId, session.userId, input.investorType ?? null, input.originatingShareId ?? null]);
    return res.rows[0].deal_investor_id;
  });
}

export async function updateDealInvestorStatus(session: Session, dealInvestorId: string, status: string): Promise<void> {
  await withSession(session, (tx) =>
    tx.query("update deal_investor set status = $1 where deal_investor_id = $2", [status, dealInvestorId]));
}
