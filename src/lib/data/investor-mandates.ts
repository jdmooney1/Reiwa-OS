// ============================================================================
// Investor mandates, and who/what they match. SERVER-ONLY, STAFF-ONLY.
// ----------------------------------------------------------------------------
// investor_mandates (0050) has one policy, Reiwa admin. Everything here runs under the caller's
// own claims through withSession, so a non-admin gets no rows from the database whatever this
// file asks for. The callers (the admin investor page, the opportunity Publication page) are
// admin-gated as well. Nothing here reaches an investor-facing surface.
//
// Until 0050 is applied the table does not exist: every reader returns `available: false` and the
// screens hide their mandate cards, rather than failing.
//
// The matching rules are in lib/mandate/match (pure). This file gathers the facts and hands them over.
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { num } from "@/lib/data/coerce";
import { listPipeline, type PipelineRow } from "@/lib/data/opportunity-file";
import {
  MANDATE_CURRENCIES, hasCriteria, type Mandate, type MandateCurrency,
} from "@/lib/mandate/mandate";
import {
  rankDealsForInvestor, rankInvestorsForDeal, type CriterionResult, type MandateDeal, type Verdict,
} from "@/lib/mandate/match";

const UNDEFINED_TABLE = "42P01";
const isMissingTable = (e: unknown) => (e as { code?: string } | null)?.code === UNDEFINED_TABLE;

const NOT_APPLIED = "Investor mandates are not available yet: the database update for them has not been applied.";

interface Row {
  investor_org_id: string; markets: string[]; asset_types: string[]; strategies: string[];
  deal_size_min: string | null; deal_size_max: string | null; currency: string;
  min_entry_yield_pct: string | null; updated_at: string;
}

function toMandate(r: Row): Mandate {
  return {
    markets: r.markets ?? [], assetTypes: r.asset_types ?? [], strategies: r.strategies ?? [],
    dealSizeMin: num(r.deal_size_min), dealSizeMax: num(r.deal_size_max),
    currency: ((MANDATE_CURRENCIES as readonly string[]).includes(r.currency) ? r.currency : "GBP") as MandateCurrency,
    minEntryYieldPct: num(r.min_entry_yield_pct),
  };
}

export interface StoredMandate { mandate: Mandate; updatedAt: string }

export async function getInvestorMandate(
  session: Session, investorOrgId: string,
): Promise<{ available: boolean; stored: StoredMandate | null }> {
  try {
    const stored = await withSession(session, async (tx) => {
      const { rows } = await tx.query<Row>("select * from investor_mandates where investor_org_id = $1", [investorOrgId]);
      return rows[0] ? { mandate: toMandate(rows[0]), updatedAt: String(rows[0].updated_at) } : null;
    });
    return { available: true, stored };
  } catch (e) {
    if (isMissingTable(e)) return { available: false, stored: null };
    throw e;
  }
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (isMissingTable(e)) throw new AppError(NOT_APPLIED);
    throw e;
  }
}

export async function saveInvestorMandate(
  session: Session, investorOrgId: string, mandate: Mandate, userId: string | null,
): Promise<void> {
  await guarded(() => withSession(session, (tx) => tx.query(
    `insert into investor_mandates(investor_org_id, markets, asset_types, strategies, deal_size_min, deal_size_max,
                                   currency, min_entry_yield_pct, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (investor_org_id) do update set
       markets = excluded.markets, asset_types = excluded.asset_types, strategies = excluded.strategies,
       deal_size_min = excluded.deal_size_min, deal_size_max = excluded.deal_size_max,
       currency = excluded.currency, min_entry_yield_pct = excluded.min_entry_yield_pct,
       updated_by = excluded.updated_by`,
    [investorOrgId, mandate.markets, mandate.assetTypes, mandate.strategies, mandate.dealSizeMin,
     mandate.dealSizeMax, mandate.currency, mandate.minEntryYieldPct, userId])));
}

export async function clearInvestorMandate(session: Session, investorOrgId: string): Promise<void> {
  await guarded(() => withSession(session, (tx) =>
    tx.query("delete from investor_mandates where investor_org_id = $1", [investorOrgId])));
}

/** The mandates of ACTIVE investor organisations that state at least one preference. */
export async function listActiveMandates(
  session: Session,
): Promise<{ available: boolean; investors: { investorOrgId: string; name: string; mandate: Mandate }[] }> {
  try {
    const investors = await withSession(session, async (tx) => {
      const { rows } = await tx.query<Row & { name: string }>(
        `select m.*, o.name from investor_mandates m
           join investor_organizations o on o.investor_org_id = m.investor_org_id
          where o.status = 'active' order by o.name`);
      return rows
        .map((r) => ({ investorOrgId: r.investor_org_id, name: r.name, mandate: toMandate(r) }))
        .filter((i) => hasCriteria(i.mandate));
    });
    return { available: true, investors };
  } catch (e) {
    if (isMissingTable(e)) return { available: false, investors: [] };
    throw e;
  }
}

// ---- Matching ---------------------------------------------------------------
/** A deal as a mandate sees it. The figures are the ones the pipeline shows (the authoritative case). */
function dealFacts(r: PipelineRow): MandateDeal {
  return {
    market: r.market, assetType: r.assetType, strategy: r.strategy, currency: r.currency,
    totalCost: r.caseTotalCost, entryYieldPct: r.caseEntryYieldPct,
  };
}

export interface MatchedDeal {
  opportunityId: string;
  name: string;
  market: string | null;
  assetType: string;
  stage: string;
  verdict: Verdict;
  passed: number;
  checks: CriterionResult[];
}

/** The live deals that suit one investor organisation, best first. Live = active and triaged live. */
export async function matchingDealsForInvestor(
  session: Session, investorOrgId: string,
): Promise<{ available: boolean; hasMandate: boolean; deals: MatchedDeal[] }> {
  const { available, stored } = await getInvestorMandate(session, investorOrgId);
  if (!available) return { available: false, hasMandate: false, deals: [] };
  if (!stored || !hasCriteria(stored.mandate)) return { available: true, hasMandate: false, deals: [] };

  const rows = (await listPipeline(session)).filter((r) => r.status === "active" && r.triageStatus === "live");
  const ranked = rankDealsForInvestor(stored.mandate, rows.map((r) => ({ ...dealFacts(r), name: r.name, row: r })));
  return {
    available: true, hasMandate: true,
    deals: ranked.map(({ item, match }) => ({
      opportunityId: item.row.opportunityId, name: item.name, market: item.row.market, assetType: item.row.assetType,
      stage: item.row.stage, verdict: match.verdict, passed: match.passed, checks: match.checks,
    })),
  };
}

export interface MatchedInvestor {
  investorOrgId: string;
  name: string;
  verdict: Verdict;
  passed: number;
  checks: CriterionResult[];
}

/** The active investor organisations whose mandate fits one deal, best first. */
export async function matchingInvestorsForOpportunity(
  session: Session, opportunityId: string,
): Promise<{ available: boolean; mandateCount: number; investors: MatchedInvestor[] }> {
  const { available, investors } = await listActiveMandates(session);
  if (!available) return { available: false, mandateCount: 0, investors: [] };
  const row = (await listPipeline(session)).find((r) => r.opportunityId === opportunityId);
  if (!row) return { available: true, mandateCount: investors.length, investors: [] };
  const ranked = rankInvestorsForDeal(dealFacts(row), investors);
  return {
    available: true, mandateCount: investors.length,
    investors: ranked.map(({ item, match }) => ({
      investorOrgId: item.investorOrgId, name: item.name, verdict: match.verdict, passed: match.passed, checks: match.checks,
    })),
  };
}
