// ============================================================================
// The deal document checklist (docs/24) — catalogue-driven rows, grouped by
// stage for the screen. Status changes here are plain writes; the gate and
// invariant consequences (DD-item projection, post-close override guard,
// scope enforcement) are all database-enforced (0039-0048), not re-checked
// in this file.
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";
import { staffNamesOn, nameOf } from "@/lib/data/directory";

export interface DealDocumentRow {
  dealDocumentId: string;
  docTypeKey: string;
  nameEn: string;
  nameJa: string | null;
  stage: 0 | 1 | 2 | 3 | 4;
  origin: "produce" | "commission" | "receive";
  scope: "deal" | "investor" | "counterparty";
  gateKind: "none" | "transition" | "action";
  status: string;
  dealInvestorId: string | null;
  investorOrgName: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  provider: string | null;
  notes: string | null;
  updatedAt: string;
}

export async function listDealDocuments(session: Session, opportunityId: string): Promise<DealDocumentRow[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      `select dd.deal_document_id, dd.doc_type_key, dt.name_en, dt.name_ja, dt.stage, dt.origin, dt.scope, dt.gate_kind,
              dd.status, dd.deal_investor_id, io.name as investor_org_name,
              dd.owner_user_id, dd.due_date, dd.provider, dd.notes, dd.updated_at
         from deal_document dd
         join doc_type dt on dt.key = dd.doc_type_key
         left join deal_investor di on di.deal_investor_id = dd.deal_investor_id
         left join investor_organizations io on io.investor_org_id = di.investor_org_id
        where dd.opportunity_id = $1
        order by dt.stage, dt.sort_order`,
      [opportunityId]);

    const directory = await staffNamesOn(tx, rows.map((r) => r.owner_user_id));
    return rows.map((r) => ({
      dealDocumentId: r.deal_document_id, docTypeKey: r.doc_type_key, nameEn: r.name_en, nameJa: r.name_ja,
      stage: Number(r.stage) as 0 | 1 | 2 | 3 | 4, origin: r.origin, scope: r.scope, gateKind: r.gate_kind, status: r.status,
      dealInvestorId: r.deal_investor_id, investorOrgName: r.investor_org_name,
      ownerUserId: r.owner_user_id, ownerName: nameOf(directory, r.owner_user_id),
      dueDate: r.due_date, provider: r.provider, notes: r.notes, updatedAt: r.updated_at,
    }));
  });
}

export interface DealDocumentPatch {
  status?: string;
  ownerUserId?: string | null;
  dueDate?: string | null;
  provider?: string | null;
  notes?: string | null;
}

const PATCH_COLUMNS: Record<keyof DealDocumentPatch, string> = {
  status: "status", ownerUserId: "owner_user_id", dueDate: "due_date",
  provider: "provider", notes: "notes",
};

export async function updateDealDocument(
  session: Session, dealDocumentId: string, patch: DealDocumentPatch,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(PATCH_COLUMNS) as [keyof DealDocumentPatch, string][]) {
    if (key in patch) { params.push(patch[key]); sets.push(`${col} = $${params.length}`); }
  }
  if (sets.length === 0) return;
  params.push(dealDocumentId);
  await withSession(session, (tx) =>
    tx.query(`update deal_document set ${sets.join(", ")} where deal_document_id = $${params.length}`, params));
}
