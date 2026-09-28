// ============================================================================
// Broker email threads and their links to opportunities.
// ----------------------------------------------------------------------------
// The relationship is many-to-many in both directions: one firm-level thread
// covers several deals, and a deal that came back to market has the original
// approach and the relaunch. Neither side owns the other.
//
// This module stores identifiers and subject lines only. The Gmail deep link is
// COMPOSED at render time rather than stored, so changing mailbox or account
// does not leave a table of stale URLs behind.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { str } from "@/lib/data/coerce";
import type { ThreadClassification } from "@/lib/ingestion/pipeline-workbook";

export type LinkConfidence = "high" | "review";

export interface EmailThread {
  emailThreadId: string;
  gmailThreadId: string;
  subject: string | null;
  market: string | null;
  classification: ThreadClassification;
  note: string | null;
}

export interface OpportunityThread extends EmailThread {
  confidence: LinkConfidence;
  matchedSubject: string | null;
  /** Null while the link is offered as evidence rather than asserted as fact. */
  confirmedAt: string | null;
  /** Ready-to-use deep link into Gmail. Composed, never stored. */
  gmailUrl: string;
}

/**
 * The Gmail deep link for a thread.
 *
 * `#all` rather than `#inbox` so a thread that has been archived — which most
 * of a year-old broker corpus has been — still resolves.
 */
export function gmailThreadUrl(gmailThreadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(gmailThreadId)}`;
}

export interface UpsertThread {
  orgId: string;
  gmailThreadId: string;
  subject?: string | null;
  market?: string | null;
  classification?: ThreadClassification;
  note?: string | null;
  createdBy: string;
}

/** Idempotent on (org, gmail thread id). */
export async function upsertThread(tx: Queryable, input: UpsertThread): Promise<string> {
  const { rows } = await tx.query<{ email_thread_id: string }>(
    `insert into email_threads(org_id, gmail_thread_id, subject, market,
       classification, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (org_id, gmail_thread_id) do update
       set subject        = coalesce(excluded.subject, email_threads.subject),
           market         = coalesce(excluded.market, email_threads.market),
           classification = excluded.classification,
           note           = coalesce(excluded.note, email_threads.note)
     returning email_thread_id`,
    [input.orgId, input.gmailThreadId, str(input.subject ?? null), str(input.market ?? null),
     input.classification ?? "deal", str(input.note ?? null), input.createdBy]);
  return rows[0].email_thread_id;
}

export interface LinkThread {
  orgId: string;
  opportunityId: string;
  emailThreadId: string;
  confidence: LinkConfidence;
  matchedSubject?: string | null;
  linkedBy: string;
}

/**
 * Link a thread to an opportunity.
 *
 * Re-running never duplicates and never silently un-confirms: a link somebody
 * has confirmed keeps its confirmation even if the source still calls it
 * `review`. A person's decision outranks the matcher that proposed it.
 *
 * Linking a thread classified `not_a_deal` is refused by trigger (0015), not
 * here — the rule belongs where every writer meets it.
 */
export async function linkThread(tx: Queryable, input: LinkThread): Promise<void> {
  await tx.query(
    `insert into opportunity_email_threads(
       org_id, opportunity_id, email_thread_id, confidence, matched_subject, linked_by)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (opportunity_id, email_thread_id) do update
       set confidence      = excluded.confidence,
           matched_subject = coalesce(excluded.matched_subject,
                                      opportunity_email_threads.matched_subject)`,
    [input.orgId, input.opportunityId, input.emailThreadId, input.confidence,
     str(input.matchedSubject ?? null), input.linkedBy]);
}

/** Threads for one opportunity, confirmed first, then high confidence. */
export async function listOpportunityThreadsOn(
  tx: Queryable, opportunityId: string,
): Promise<OpportunityThread[]> {
  const { rows } = await tx.query<Record<string, unknown>>(
    `select t.email_thread_id, t.gmail_thread_id, t.subject, t.market,
            t.classification, t.note,
            l.confidence, l.matched_subject, l.confirmed_at
       from opportunity_email_threads l
       join email_threads t on t.email_thread_id = l.email_thread_id
      where l.opportunity_id = $1
      order by (l.confirmed_at is null), l.confidence, t.subject`,
    [opportunityId]);
  return rows.map((r) => ({
    emailThreadId: r.email_thread_id as string,
    gmailThreadId: r.gmail_thread_id as string,
    subject: str(r.subject),
    market: str(r.market),
    classification: r.classification as ThreadClassification,
    note: str(r.note),
    confidence: r.confidence as LinkConfidence,
    matchedSubject: str(r.matched_subject),
    confirmedAt: str(r.confirmed_at),
    gmailUrl: gmailThreadUrl(r.gmail_thread_id as string),
  }));
}

export async function listOpportunityThreads(
  session: Session, opportunityId: string,
): Promise<OpportunityThread[]> {
  return withSession(session, (tx) => listOpportunityThreadsOn(tx, opportunityId));
}

/** Confirm a `review` link, or withdraw a confirmation. */
export async function setThreadConfirmed(
  session: Session, opportunityId: string, emailThreadId: string, confirmed: boolean,
): Promise<void> {
  await withSession(session, (tx) =>
    tx.query(
      `update opportunity_email_threads
          set confirmed_at = case when $3 then now() else null end,
              confirmed_by = case when $3 then $4::uuid else null end
        where opportunity_id = $1 and email_thread_id = $2`,
      [opportunityId, emailThreadId, confirmed, session.userId]));
}

/**
 * Threads carrying no opportunity link: firm-level dumps to be assigned by
 * hand, correspondence that is not a deal, and properties that are not among
 * the loaded set. Kept rather than deleted — an unmatched thread names a deal
 * the sheet is missing, which is worth knowing.
 */
export async function listUnlinkedThreads(session: Session): Promise<EmailThread[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `select t.* from email_threads t
        where not exists (select 1 from opportunity_email_threads l
                           where l.email_thread_id = t.email_thread_id)
        order by t.classification, t.subject`);
    return rows.map((r) => ({
      emailThreadId: r.email_thread_id as string,
      gmailThreadId: r.gmail_thread_id as string,
      subject: str(r.subject),
      market: str(r.market),
      classification: r.classification as ThreadClassification,
      note: str(r.note),
    }));
  });
}
