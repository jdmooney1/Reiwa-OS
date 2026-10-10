import Link from "next/link";
import type { StoredAssessment } from "@/lib/data/deal-assessments";
import { VERDICT_LABEL, TERM_KEYS, type Verdict } from "@/lib/underwrite/assessment";
import { INPUT_LABEL, type InputLine } from "@/lib/underwrite/inputs";
import { formatDate, formatMoneyUnits } from "@/lib/format";
import type { Currency } from "@/types/database";
import { Section, MetricRule, TableWrap, Th, Td, Empty, Provenance } from "@/components/workspace/primitives";
import { RunControls } from "@/components/assessment/run-controls";
import { cn } from "@/lib/utils";

/**
 * The Assessment tab. Every figure on it comes from the engine's stored report;
 * the written parts come from the model and are labelled as judgement. When a
 * run was engine-only, the written parts are simply absent, never filled in.
 */
interface HistoryItem {
  assessmentId: string; createdAt: string; createdByName: string | null;
  tier: "lease" | "screen"; verdict: Verdict | null; caseVersion: number | null; hasAssessment: boolean;
}

const pct = (x: number | null | undefined, d = 1) =>
  typeof x === "number" && Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "—";
const mult = (x: number | null | undefined) =>
  typeof x === "number" && Number.isFinite(x) ? `${x.toFixed(2)}x` : "—";

const SOURCE_LABEL: Record<InputLine["source"], string> = {
  case: "Investment case", rent_roll: "Rent roll", property: "Property record", opportunity: "Opportunity",
  fx_rates: "FX rates", derived: "Derived", default: "Default",
};

const VERDICT_TONE: Record<Verdict, string> = {
  proceed: "bg-positive/10 text-positive",
  proceed_at_price: "bg-caution/10 text-caution",
  pass: "bg-negative/10 text-negative",
};
const LEVEL_TONE: Record<string, string> = {
  high: "bg-positive/10 text-positive", medium: "bg-surface-sunken text-ink-muted", low: "bg-negative/10 text-negative",
};
const SEVERITY_TONE: Record<string, string> = {
  high: "bg-negative/10 text-negative", medium: "bg-caution/10 text-caution", low: "bg-surface-sunken text-ink-muted",
};

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("inline-block rounded px-1.5 py-px text-2xs font-semibold uppercase tracking-label", tone)}>{children}</span>;
}

function Neg({ x, children }: { x: number | null | undefined; children: React.ReactNode }) {
  return <span className={typeof x === "number" && x < 0 ? "text-negative" : undefined}>{children}</span>;
}

export function AssessmentView({
  opportunityId, run, history, canRun, modelConfigured,
}: {
  opportunityId: string;
  run: StoredAssessment | null;
  history: HistoryItem[];
  canRun: boolean;
  modelConfigured: boolean;
}) {
  const controls = canRun ? <RunControls opportunityId={opportunityId} modelConfigured={modelConfigured} /> : undefined;

  if (!run || !run.report) {
    return (
      <div>
        <Section title="Deal assessment" eyebrow="Engine and judgement" action={controls}>
          <Empty
            title="This deal has not been assessed."
            hint="The model needs a price and an income (gross rent, NOI, passing rent or a quoted NIY). Add a rent roll to the investment case for the lease-by-lease model."
          />
        </Section>
      </div>
    );
  }

  const r = run.report;
  const a = run.assessment;
  const ccy = (r.currency as Currency) ?? "GBP";
  const money = (x: number | null | undefined) => formatMoneyUnits(typeof x === "number" ? x : null, ccy);
  const evidence = new Map((a?.evidence ?? []).map((e) => [e.key, e]));
  const b = r.base;

  return (
    <div>
      <Section
        title="Deal assessment"
        eyebrow={`${formatDate(run.createdAt)}${run.createdByName ? ` · ${run.createdByName}` : ""}${run.caseVersion ? ` · underwriting v${run.caseVersion}` : " · no underwriting version"}`}
        action={controls}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={r.tier === "lease" ? "bg-positive/10 text-positive" : "bg-caution/10 text-caution"}>
            {r.tier === "lease" ? `Lease by lease · ${r.units} units` : "Screening model"}
          </Chip>
          {a && run.verdict && <Chip tone={VERDICT_TONE[run.verdict]}>{VERDICT_LABEL[run.verdict]}</Chip>}
          {!a && <Chip tone="bg-surface-sunken text-ink-muted">Engine only · no written assessment</Chip>}
        </div>
        {r.tier === "screen" && (
          <p className="mt-2 text-xs text-ink-muted">
            No rent roll on the investment case, so the income is modelled as three tranches around the WAULT. Good for ranking deals;
            not a basis for a bid. Add a rent roll when revising the underwriting.
          </p>
        )}
        {a && (
          <div className="mt-4 max-w-3xl">
            <p className="text-base font-medium text-ink">{a.headline}</p>
            <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">{a.rationale}</p>
            <Provenance>Written by {run.model} from the figures below. Judgement, not a figure: every number on this page is the engine&apos;s.</Provenance>
          </div>
        )}
        {r.gaps.length > 0 && (
          <ul className="mt-4 space-y-1" role="status">
            {r.gaps.map((g) => (
              <li key={g} className="rounded border border-caution/40 bg-caution/10 px-3 py-1.5 text-xs text-ink">{g}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Base case" eyebrow={`${r.annual.length}-year hold at the asking price, ${money(r.price)}`}>
        <MetricRule items={[
          { label: `Investor IRR (${ccy})`, value: pct(b.irrNet), sub: "after tax and fees" },
          { label: "Investor IRR (yen)", value: pct(b.irrYenHedged), sub: "hedged" },
          { label: "Deal IRR", value: pct(b.irrDeal), sub: `before tax and fees · unlevered ${pct(b.irrUnlevered)}` },
          { label: "Equity multiple", value: mult(b.multipleNet), sub: `cash yield ${pct(b.cashYieldAvg)} a year` },
          { label: "Sale value", value: money(b.exit.gross), sub: `${b.exit.year} · ${pct(b.exit.exitYield, 2)}${b.exit.unexpiredYears != null ? ` · ${b.exit.unexpiredYears.toFixed(0)} yrs lease left` : ""}` },
          { label: "Equity", value: money(b.equity), sub: `debt ${money(b.debt)}` },
          { label: "Interest cover", value: b.icrMin == null ? "No debt" : mult(b.icrMin), sub: "minimum, NOI to interest" },
          { label: "Tax", value: money(b.taxTotal), sub: "over the hold" },
          { label: "Reiwa fees", value: money(b.feesTotal), sub: "over the hold" },
          { label: "Yen, unhedged", value: pct(b.irrYenUnhedged), sub: "at a flat rate" },
        ]} />
      </Section>

      <Section title="Scenarios and stress" eyebrow="The same shocks for every deal">
        <TableWrap>
          <table className="w-full">
            <thead><tr><Th>Scenario</Th><Th align="right">IRR ({ccy})</Th><Th align="right">IRR (yen, hedged)</Th><Th align="right">Multiple</Th><Th align="right">Min interest cover</Th><Th align="right">Sale value</Th></tr></thead>
            <tbody>
              {r.scenarios.map((s) => (
                <tr key={s.key}>
                  <Td>{s.label}</Td>
                  <Td align="right"><Neg x={s.irrNet}>{pct(s.irrNet)}</Neg></Td>
                  <Td align="right"><Neg x={s.irrYenHedged}>{pct(s.irrYenHedged)}</Neg></Td>
                  <Td align="right">{mult(s.multipleNet)}</Td>
                  <Td align="right">{s.icrMin == null ? "—" : mult(s.icrMin)}</Td>
                  <Td align="right">{money(s.exitValue)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <Provenance>
          Downside: exit yield +0.50%, market rents −10%, growth −2% a year, voids +6 and incentives +3 months. Upside: exit −0.25%,
          rents +5%, growth +1%. Severe: exit +0.75%, rents −15%, growth −3%, voids +9, incentives +3, debt +1%, every break exercised.
          Deferred consideration is not paid in the downside or severe case.
        </Provenance>
        <div className="mt-5" />
        <TableWrap>
          <table className="w-full">
            <thead><tr><Th>One thing changes</Th><Th align="right">IRR ({ccy})</Th><Th align="right">IRR (yen, hedged)</Th><Th align="right">IRR (yen, unhedged)</Th></tr></thead>
            <tbody>
              {r.sensitivities.map((s) => (
                <tr key={s.key}>
                  <Td>{s.label}</Td>
                  <Td align="right"><Neg x={s.irrNet}>{pct(s.irrNet)}</Neg></Td>
                  <Td align="right"><Neg x={s.irrYenHedged}>{pct(s.irrYenHedged)}</Neg></Td>
                  <Td align="right"><Neg x={s.irrYenUnhedged}>{pct(s.irrYenUnhedged)}</Neg></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="eyebrow mb-1">Break points</div>
            <ul className="space-y-1 text-sm text-ink">
              <li>Yen IRR reaches zero at an exit yield of <b>{pct(r.reverse.exitYieldYenZero, 2)}</b></li>
              <li>…or if market rents fall <b>{r.reverse.ervShockYenZero == null ? "—" : pct(-r.reverse.ervShockYenZero, 0)}</b></li>
            </ul>
          </div>
          <div>
            <div className="eyebrow mb-1">Price for a hedged yen return of</div>
            <ul className="space-y-1 text-sm text-ink">
              {r.reverse.priceForYen.map((t) => (
                <li key={t.target}>{pct(t.target, 0)}: <b>{t.price == null ? "outside range" : money(t.price)}</b>{t.price != null && <span className="text-ink-faint"> ({pct(t.price / r.price - 1, 1)} vs asking)</span>}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {a && r.terms && (
        <Section title="Proposed terms" eyebrow="Levers chosen by the assessment, priced by the engine">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <ul className="divide-y divide-line border-y border-line text-sm">
                <li className="flex justify-between py-2"><span className="text-ink-muted">Upfront price</span><span className="tabular">{money(r.terms.upfrontPrice)} <span className="text-ink-faint">({pct(r.terms.terms.priceFactor - 1, 1)})</span></span></li>
                <li className="flex justify-between py-2"><span className="text-ink-muted">Deferred, if rents hold up</span><span className="tabular">{r.terms.terms.deferredShare > 0 ? money(r.price * r.terms.terms.deferredShare) : "None"}</span></li>
                <li className="flex justify-between py-2"><span className="text-ink-muted">Headline price</span><span className="tabular">{money(r.terms.headlinePrice)}</span></li>
                <li className="flex justify-between py-2"><span className="text-ink-muted">Extra vendor guarantee</span><span className="tabular">{r.terms.terms.extraGuaranteeMonths} months</span></li>
                <li className="flex justify-between py-2"><span className="text-ink-muted">Vendor rent top-up</span><span className="tabular">{r.terms.terms.topUpMonths} months</span></li>
                <li className="flex justify-between py-2"><span className="text-ink-muted">Acquisition fee</span><span className="tabular">{pct(r.terms.terms.acqFeePct, 2)}</span></li>
              </ul>
              {a.proposedTerms.rationale.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-xs text-ink-muted">
                  {a.proposedTerms.rationale.slice().sort((x, y) => TERM_KEYS.indexOf(x.term) - TERM_KEYS.indexOf(y.term)).map((t) => (
                    <li key={t.term}><span className="font-medium text-ink">{t.term.replace("_", " ")}:</span> {t.why}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <TableWrap>
                <table className="w-full">
                  <thead><tr><Th>Scenario</Th><Th align="right">Asking (yen)</Th><Th align="right">Proposed (yen)</Th><Th align="right">Proposed ({ccy})</Th></tr></thead>
                  <tbody>
                    {r.terms.rows.map((x) => (
                      <tr key={x.key}>
                        <Td>{x.label}</Td>
                        <Td align="right"><Neg x={x.asking.irrYenHedged}>{pct(x.asking.irrYenHedged)}</Neg></Td>
                        <Td align="right" className="font-medium"><Neg x={x.proposed.irrYenHedged}>{pct(x.proposed.irrYenHedged)}</Neg></Td>
                        <Td align="right"><Neg x={x.proposed.irrNet}>{pct(x.proposed.irrNet)}</Neg></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              {a.proposedTerms.otherTerms.length > 0 && (
                <>
                  <div className="eyebrow mb-1 mt-4">Other terms to ask for (not modelled)</div>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
                    {a.proposedTerms.otherTerms.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                </>
              )}
            </div>
          </div>
        </Section>
      )}

      {a && (
        <Section title="Strengths and concerns" eyebrow="Judgement">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <div className="eyebrow mb-1">Strengths</div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink">{a.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            <div>
              <div className="eyebrow mb-1">Concerns</div>
              <ul className="space-y-1.5 text-sm text-ink">
                {a.concerns.map((c) => <li key={c.text}><Chip tone={SEVERITY_TONE[c.severity]}>{c.severity}</Chip> {c.text}</li>)}
              </ul>
              <p className="mt-3 text-sm text-ink"><span className="text-ink-muted">Most exposed to:</span> <b>{INPUT_LABEL[a.mostExposedTo]}</b>. {a.exposureReason}</p>
            </div>
          </div>
        </Section>
      )}

      <Section title="Assumptions and evidence" eyebrow={a ? "Every input, where it came from, and how far to trust it" : "Every input and where it came from"}>
        <TableWrap>
          <table className="w-full">
            <thead><tr><Th>Input</Th><Th>Value used</Th><Th>Source</Th>{a && <><Th>Confidence</Th><Th>Evidence</Th><Th>How to confirm</Th></>}</tr></thead>
            <tbody>
              {run.inputs.map((l) => {
                const e = evidence.get(l.key);
                return (
                  <tr key={l.key}>
                    <Td className="whitespace-nowrap">{INPUT_LABEL[l.key]}</Td>
                    <Td>{l.value}<div className="text-2xs text-ink-faint">{l.basis}</div></Td>
                    <Td className={l.source === "default" ? "text-caution" : undefined}>{SOURCE_LABEL[l.source]}</Td>
                    {a && <>
                      <Td>{e ? <Chip tone={LEVEL_TONE[e.confidence]}>{e.confidence}</Chip> : <span className="text-ink-faint">—</span>}</Td>
                      <Td className="text-xs">{e?.evidence ?? ""}</Td>
                      <Td className="text-xs">{e?.howToConfirm ?? ""}</Td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        <Provenance>Precedence: investment case, then rent roll, property record, opportunity, FX table, and finally a dated market default. Defaults are a starting point for screening, not a market view.</Provenance>
      </Section>

      <Section title="Hold periods" eyebrow="Same inputs, different sale dates">
        <TableWrap>
          <table className="w-full">
            <thead><tr><Th>Hold</Th><Th>Sale</Th><Th align="right">Lease left</Th><Th align="right">Exit yield</Th><Th align="right">Sale value</Th><Th align="right">IRR ({ccy})</Th><Th align="right">IRR (yen)</Th><Th align="right">Multiple</Th><Th align="right">Cash yield</Th></tr></thead>
            <tbody>
              {r.horizons.map((h) => (
                <tr key={h.years}>
                  <Td>{h.years} years</Td><Td>{h.saleYear}</Td>
                  <Td align="right">{h.unexpiredYears == null ? "Freehold" : `${h.unexpiredYears.toFixed(0)} yrs`}</Td>
                  <Td align="right">{pct(h.exitYield, 2)}</Td><Td align="right">{money(h.exitValue)}</Td>
                  <Td align="right"><Neg x={h.irrNet}>{pct(h.irrNet)}</Neg></Td>
                  <Td align="right"><Neg x={h.irrYenHedged}>{pct(h.irrYenHedged)}</Neg></Td>
                  <Td align="right">{mult(h.multipleNet)}</Td><Td align="right">{pct(h.cashYieldAvg)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <Provenance>From year 6: lifecycle capex (1% of rent, office refresh every 10 years, a full refurbishment every 25 years from year 20), refinancing every five years, and for a leasehold an exit-yield add-on and value factor once fewer than 80 years remain. Judgement, for direction only.</Provenance>
      </Section>

      <Section title="Cash flow" eyebrow={`Annual, ${ccy}, base case`}>
        <TableWrap>
          <table className="w-full">
            <thead><tr><Th>Year</Th><Th align="right">Gross rent</Th><Th align="right">Ground rent</Th><Th align="right">Running costs</Th><Th align="right">NOI</Th><Th align="right">Capex</Th><Th align="right">Interest</Th><Th align="right">AM fee</Th><Th align="right">Tax</Th><Th align="right">To investors</Th></tr></thead>
            <tbody>
              {r.annual.map((y) => (
                <tr key={y.year}>
                  <Td>{y.year}</Td><Td align="right">{money(y.gross)}</Td><Td align="right">{money(-y.groundRent)}</Td>
                  <Td align="right">{money(-y.opex)}</Td><Td align="right">{money(y.noi)}</Td><Td align="right">{money(-y.capex)}</Td>
                  <Td align="right">{money(-y.interest)}</Td><Td align="right">{money(-y.amFee)}</Td><Td align="right">{money(-y.tax)}</Td>
                  <Td align="right"><Neg x={y.distribution}>{money(y.distribution)}</Neg></Td>
                </tr>
              ))}
              <tr>
                <Td className="font-medium">Sale</Td>
                <Td align="right" className="font-medium">{money(b.exit.gross)}</Td>
                <Td align="right" className="text-ink-faint" >—</Td><Td align="right" className="text-ink-faint">—</Td><Td align="right" className="text-ink-faint">—</Td><Td align="right" className="text-ink-faint">—</Td>
                <Td align="right">{money(-b.debt)}</Td><Td align="right">{money(-b.exit.promote)}</Td><Td align="right">{money(-b.exit.taxOnGain)}</Td>
                <Td align="right" className="font-medium">{money(b.exit.proceeds)}</Td>
              </tr>
            </tbody>
          </table>
        </TableWrap>
      </Section>

      {a && (a.icQuestions.length > 0 || a.dataGaps.length > 0) && (
        <Section title="For the committee" eyebrow="Judgement">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <div className="eyebrow mb-1">Questions the committee should ask</div>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">{a.icQuestions.map((q) => <li key={q}>{q}</li>)}</ol>
            </div>
            <div>
              <div className="eyebrow mb-1">Data still missing</div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink">{a.dataGaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
          </div>
        </Section>
      )}

      {history.length > 1 && (
        <Section title="Earlier runs" eyebrow="Stored as recorded; never recomputed">
          <ul className="divide-y divide-line border-y border-line text-sm">
            {history.map((h) => (
              <li key={h.assessmentId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/opportunities/${opportunityId}/assessment?run=${h.assessmentId}`} className={cn("hover:underline", h.assessmentId === run.assessmentId && "font-semibold")}>
                  {formatDate(h.createdAt)}{h.createdByName ? ` · ${h.createdByName}` : ""}{h.caseVersion ? ` · v${h.caseVersion}` : ""}
                </Link>
                <span className="flex gap-1.5">
                  <Chip tone="bg-surface-sunken text-ink-muted">{h.tier === "lease" ? "Lease" : "Screen"}</Chip>
                  {h.verdict ? <Chip tone={VERDICT_TONE[h.verdict]}>{VERDICT_LABEL[h.verdict]}</Chip> : <Chip tone="bg-surface-sunken text-ink-muted">Engine only</Chip>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
