import Link from "next/link";
import type { MatchedDeal, MatchedInvestor } from "@/lib/data/investor-mandates";
import type { CriterionResult, Verdict } from "@/lib/mandate/match";
import { assetTypeLabel } from "@/lib/mandate/mandate";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Staff-only. These cards are rendered only on admin-gated pages (the investor organisation page
// and the opportunity Publication page), and read investor_mandates, which no investor can read.

const VERDICT: Partial<Record<Verdict, { label: string; tone: "positive" | "caution" }>> = {
  fit: { label: "Fits", tone: "positive" },
  possible: { label: "Possible", tone: "caution" },
};

function Why({ checks }: { checks: CriterionResult[] }) {
  return (
    <details className="mt-1 text-2xs text-ink-faint">
      <summary className="cursor-pointer select-none hover:text-ink-muted">Why</summary>
      <ul className="mt-1 space-y-0.5">
        {checks.map((c) => (
          <li key={c.criterion} data-outcome={c.outcome}>
            <span className={c.outcome === "pass" ? "text-positive" : c.outcome === "unknown" ? "text-caution" : "text-negative"}>
              {c.outcome === "pass" ? "Yes" : c.outcome === "unknown" ? "Unknown" : "No"}
            </span>{" "}- {c.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => <p className="text-xs text-ink-faint">{children}</p>;

/** On an investor organisation's page: the live deals that suit its mandate. */
export function MatchingDealsCard({
  hasMandate, deals,
}: { hasMandate: boolean; deals: MatchedDeal[] }) {
  return (
    <Card>
      <CardHeader eyebrow="Staff only" title="Live deals that suit this mandate"
        action={hasMandate ? <span className="text-2xs text-ink-faint">{deals.length} match{deals.length === 1 ? "" : "es"}</span> : undefined} />
      <CardBody>
        {!hasMandate ? <Note>Record a mandate above to see which live deals suit it.</Note>
          : deals.length === 0 ? <Note>No live deal fits this mandate at the moment.</Note>
          : (
            <ul className="divide-y divide-line">
              {deals.map((d) => {
                const v = VERDICT[d.verdict]!;
                return (
                  <li key={d.opportunityId} className="py-2.5" data-verdict={d.verdict}>
                    <div className="flex items-center justify-between gap-3">
                      <Link href={`/opportunities/${d.opportunityId}`} className="text-sm font-medium text-ink hover:underline">{d.name}</Link>
                      <Badge tone={v.tone} dot>{v.label}</Badge>
                    </div>
                    <div className="text-2xs text-ink-faint">{[d.market, assetTypeLabel(d.assetType)].filter(Boolean).join(" · ")}</div>
                    <Why checks={d.checks} />
                  </li>
                );
              })}
            </ul>
          )}
        <p className="mt-3 text-2xs text-ink-faint">
          Live means active and triaged live. &ldquo;Possible&rdquo; means nothing contradicts the mandate but a figure is
          missing. Not the investment score.
        </p>
      </CardBody>
    </Card>
  );
}

/** On a deal's Publication page: the investor organisations whose mandate suits it. */
export function MatchingInvestorsCard({
  mandateCount, investors,
}: { mandateCount: number; investors: MatchedInvestor[] }) {
  return (
    <Card>
      <CardHeader eyebrow="Staff only" title="Investors to call about this deal"
        action={<span className="text-2xs text-ink-faint">{investors.length} of {mandateCount} mandate{mandateCount === 1 ? "" : "s"}</span>} />
      <CardBody>
        {mandateCount === 0 ? <Note>No investor organisation has recorded a mandate yet.</Note>
          : investors.length === 0 ? <Note>No active investor&rsquo;s mandate suits this deal.</Note>
          : (
            <ul className="divide-y divide-line">
              {investors.map((i) => {
                const v = VERDICT[i.verdict]!;
                return (
                  <li key={i.investorOrgId} className="py-2.5" data-verdict={i.verdict}>
                    <div className="flex items-center justify-between gap-3">
                      <Link href={`/admin/investors/${i.investorOrgId}`} className="text-sm font-medium text-ink hover:underline">{i.name}</Link>
                      <Badge tone={v.tone} dot>{v.label}</Badge>
                    </div>
                    <Why checks={i.checks} />
                  </li>
                );
              })}
            </ul>
          )}
        <p className="mt-3 text-2xs text-ink-faint">
          From each active investor&rsquo;s recorded mandate. Never shown to investors. Not the investment score.
        </p>
      </CardBody>
    </Card>
  );
}
