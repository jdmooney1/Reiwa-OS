// ============================================================================
// Deal file data layer — due diligence, contacts, documents, decision log.
// ----------------------------------------------------------------------------
// Every call runs under withSession, so RLS enforces org isolation and write
// scope. Nothing here takes an org_id from the caller: it is read from the
// parent opportunity inside the same transaction, so a write can never be
// attributed to an organisation the caller does not belong to.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { str } from "@/lib/data/coerce";
import type {
  DdItem, DdStatus, DealContact, DealDocument, DecisionEntry, DealFile,
  DdJurisdiction, DdPriority, DdRiskLevel, DecisionType,
} from "@/lib/data/deal-file-types";
import type { DdTemplateId } from "@/lib/dd/templates";
import { DD_TEMPLATES } from "@/lib/dd/templates";

export * from "@/lib/data/deal-file-types";

type Row = Record<string, any>;

const mapDd = (r: Row): DdItem => ({
  itemId: r.item_id, opportunityId: r.opportunity_id,
  section: r.section, item: r.item, question: str(r.question),
  jurisdiction: r.jurisdiction as DdJurisdiction,
  priority: r.priority as DdPriority,
  status: r.status as DdStatus,
  riskLevel: (str(r.risk_level) as DdRiskLevel | null) ?? null,
  owner: str(r.owner), dueDate: str(r.due_date), notes: str(r.notes),
  sortOrder: Number(r.sort_order ?? 0),
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const mapContact = (r: Row): DealContact => ({
  contactId: r.contact_id, opportunityId: r.opportunity_id ?? null,
  name: r.name, company: str(r.company), role: str(r.role),
  email: str(r.email), phone: str(r.phone), notes: str(r.notes),
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const mapDocument = (r: Row): DealDocument => ({
  documentId: r.document_id, opportunityId: r.opportunity_id,
  fileName: r.file_name, fileType: str(r.file_type), category: r.category,
  storagePath: str(r.storage_path), notes: str(r.notes),
  uploadedAt: r.uploaded_at,
});

const mapDecision = (r: Row): DecisionEntry => ({
  decisionId: r.decision_id, opportunityId: r.opportunity_id,
  decisionDate: r.decision_date, decisionType: r.decision_type as DecisionType,
  decision: r.decision, rationale: str(r.rationale), nextSteps: str(r.next_steps),
  author: str(r.author), createdAt: r.created_at,
});

/**
 * Resolve the owning organisation from the opportunity itself, inside the
 * caller's RLS-gated transaction. If the caller cannot see the opportunity,
 * this returns nothing and the write never happens.
 */
async function orgIdFor(tx: Queryable, opportunityId: string): Promise<string> {
  const { rows } = await tx.query<{ org_id: string }>(
    "select org_id from opportunities where opportunity_id = $1", [opportunityId]);
  if (!rows[0]) throw new Error("Opportunity not found or not permitted");
  return rows[0].org_id;
}

// ---- Read ------------------------------------------------------------------

/** Everything hanging off one opportunity, in one transaction. */
export async function getDealFile(session: Session, opportunityId: string): Promise<DealFile> {
  return withSession(session, async (tx) => {
    const [dd, contacts, documents, decisions] = await Promise.all([
      tx.query("select * from dd_items where opportunity_id = $1 order by sort_order, created_at", [opportunityId]),
      tx.query("select * from deal_contacts where opportunity_id = $1 order by name", [opportunityId]),
      tx.query("select * from deal_documents where opportunity_id = $1 order by uploaded_at desc", [opportunityId]),
      tx.query("select * from decision_log where opportunity_id = $1 order by decision_date desc, created_at desc", [opportunityId]),
    ]);
    return {
      ddItems: dd.rows.map(mapDd),
      contacts: contacts.rows.map(mapContact),
      documents: documents.rows.map(mapDocument),
      decisions: decisions.rows.map(mapDecision),
    };
  });
}

// ---- Due diligence ---------------------------------------------------------

/**
 * Instantiate a market framework onto an opportunity that has no due diligence
 * yet. Refuses if any workstream already exists, so a second click cannot
 * duplicate the tracker.
 */
export async function applyDdTemplate(
  session: Session, opportunityId: string, templateId: DdTemplateId,
): Promise<number> {
  const template = DD_TEMPLATES[templateId];
  if (!template) throw new Error(`Unknown due diligence framework: ${templateId}`);

  return withSession(session, async (tx) => {
    const orgId = await orgIdFor(tx, opportunityId);
    const existing = await tx.query<{ n: string }>(
      "select count(*) as n from dd_items where opportunity_id = $1", [opportunityId]);
    if (Number(existing.rows[0].n) > 0) {
      throw new Error("Due diligence has already been initiated for this opportunity");
    }

    let inserted = 0;
    for (const [i, item] of template.items.entries()) {
      await tx.query(
        `insert into dd_items(org_id, opportunity_id, section, item, question,
           jurisdiction, priority, risk_level, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orgId, opportunityId, item.section, item.item, item.question,
         item.jurisdiction, item.priority, item.riskLevel, i]);
      inserted += 1;
    }
    return inserted;
  });
}

export async function setDdStatus(
  session: Session, itemId: string, status: DdStatus,
): Promise<void> {
  await withSession(session, (tx) =>
    tx.query("update dd_items set status = $1 where item_id = $2", [status, itemId]));
}

const DD_EDITABLE: Record<string, string> = {
  owner: "owner", dueDate: "due_date", notes: "notes",
  priority: "priority", riskLevel: "risk_level",
};

export async function updateDdItem(
  session: Session, itemId: string, patch: Record<string, unknown>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(DD_EDITABLE)) {
    if (key in patch) { params.push(patch[key]); sets.push(`${column} = $${params.length}`); }
  }
  if (sets.length === 0) return;
  params.push(itemId);
  await withSession(session, (tx) =>
    tx.query(`update dd_items set ${sets.join(", ")} where item_id = $${params.length}`, params));
}

// ---- Contacts --------------------------------------------------------------

export interface NewContact {
  name: string;
  company?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export async function addContact(
  session: Session, opportunityId: string, input: NewContact,
): Promise<string> {
  return withSession(session, async (tx) => {
    const orgId = await orgIdFor(tx, opportunityId);
    const { rows } = await tx.query<{ contact_id: string }>(
      `insert into deal_contacts(org_id, opportunity_id, name, company, role, email, phone, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning contact_id`,
      [orgId, opportunityId, input.name, input.company ?? null, input.role ?? null,
       input.email ?? null, input.phone ?? null, input.notes ?? null]);
    return rows[0].contact_id;
  });
}

export async function deleteContact(session: Session, contactId: string): Promise<void> {
  await withSession(session, (tx) =>
    tx.query("delete from deal_contacts where contact_id = $1", [contactId]));
}

// ---- Documents (register) --------------------------------------------------

export interface NewDocument {
  fileName: string;
  category: string;
  fileType?: string | null;
  notes?: string | null;
}

export async function addDocument(
  session: Session, opportunityId: string, input: NewDocument,
): Promise<string> {
  return withSession(session, async (tx) => {
    const orgId = await orgIdFor(tx, opportunityId);
    const { rows } = await tx.query<{ document_id: string }>(
      `insert into deal_documents(org_id, opportunity_id, file_name, file_type, category, notes)
       values ($1,$2,$3,$4,$5,$6) returning document_id`,
      [orgId, opportunityId, input.fileName, input.fileType ?? null,
       input.category, input.notes ?? null]);
    return rows[0].document_id;
  });
}

export async function deleteDocument(session: Session, documentId: string): Promise<void> {
  await withSession(session, (tx) =>
    tx.query("delete from deal_documents where document_id = $1", [documentId]));
}

// ---- Decision log ----------------------------------------------------------

export interface NewDecision {
  decision: string;
  decisionType: DecisionType;
  decisionDate?: string | null;
  rationale?: string | null;
  nextSteps?: string | null;
  author?: string | null;
}

export async function addDecision(
  session: Session, opportunityId: string, input: NewDecision,
): Promise<string> {
  return withSession(session, async (tx) => {
    const orgId = await orgIdFor(tx, opportunityId);
    const { rows } = await tx.query<{ decision_id: string }>(
      `insert into decision_log(org_id, opportunity_id, decision_date, decision_type,
         decision, rationale, next_steps, author)
       values ($1,$2, coalesce($3::date, current_date), $4,$5,$6,$7,$8)
       returning decision_id`,
      [orgId, opportunityId, input.decisionDate ?? null, input.decisionType,
       input.decision, input.rationale ?? null, input.nextSteps ?? null,
       input.author ?? null]);
    return rows[0].decision_id;
  });
}
