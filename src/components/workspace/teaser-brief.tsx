// ============================================================================
// The Underwriting tab's "From the teaser" panel. Server component, staff only.
// ----------------------------------------------------------------------------
// What the broker's teaser said, beside the version being underwritten: the
// figures it gave, its tenancy schedule, what it left out, and the inputs the
// working version still lacks. Read-only: every figure here is the broker's,
// and becomes Reiwa's only when a person puts it in a version.
// ============================================================================
import Link from "next/link";
import { FileText } from "lucide-react";
import type { TeaserBrief } from "@/lib/data/teaser-intake";
import type { UnderwritingVersion } from "@/lib/data/underwriting-types";
import { remainingInputs } from "@/lib/teaser-intake/underwriting";
import { formatMoney, formatPct } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Section, TableWrap, Th, Td, Provenance } from "@/components/workspace/primitives";
import type { Currency } from "@/types/database";

export function TeaserBriefPanel({
  opportunityId, brief, working, currency,
}: {
  opportunityId: string;
  brief: TeaserBrief;
  working: UnderwritingVersion | null;
  currency: Currency;
}) {
  const gaps = remainingInputs(working as unknown as Record<string, unknown> | null);
  const rentRoll = Array.isArray((working?.assumptions as Record<string, unknown> | undefined)?.rentRoll);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : "—");

  return (
    <Section
      eyebrow="From the teaser"
      title="Ready to underwrite"
      action={brief.documentId ? (
        <Link href={`/opportunities/${opportunityId}/documents/${brief.documentId}`}
          className="flex items-center gap-1.5 text-xs font-medium text-purple hover:underline">
          <FileText className="h-3.5 w-3.5" /> Open the teaser
        </Link>
      ) : undefined}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="eyebrow mb-2">Still to underwrite{working ? ` in v${working.version}` : ""}</div>
          {gaps.length === 0 ? (
            <p className="text-xs text-ink-muted">Every core input has a figure. Check them against the teaser and the data room.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {gaps.map((g) => (
                <li key={g.key} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-caution" />
                  <span className="text-ink">{g.label}</span>
                  {!g.judgement && <span className="text-2xs text-ink-faint">not in the teaser</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
            Use <span className="text-ink-muted">Revise from v{working?.version ?? 1}</span> below: the teaser&apos;s figures and tenancy carry
            into the new version, and the fields above are yours to set.
          </p>
        </div>

        <div className="space-y-3">
          {brief.priceBasis && <p className="text-xs text-ink-muted">Price basis: <span className="text-ink">{brief.priceBasis}</span></p>}
          {brief.dataCompleteness && <p className="text-xs text-ink-muted">Not in the teaser: <span className="text-ink">{brief.dataCompleteness}</span></p>}
          {brief.flags.map((f) => (
            <p key={f.code} className="border-l-2 border-caution pl-3 text-xs leading-relaxed text-ink-muted">{f.message}</p>
          ))}
          {brief.highlights.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink">
              {brief.highlights.slice(0, 8).map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          )}
        </div>
      </div>

      {brief.tenancy.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="eyebrow">Tenancy schedule, as the teaser gives it</span>
            <Badge tone={rentRoll ? "positive" : "caution"}>{rentRoll ? "Loaded as rent roll" : "Incomplete: not a rent roll"}</Badge>
          </div>
          <TableWrap>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Unit</Th><Th>Tenant</Th><Th>Use</Th><Th align="right">Area (sq ft)</Th>
                  <Th align="right">Rent pa</Th><Th align="right">ERV pa</Th><Th>Expiry</Th><Th>Break</Th>
                </tr>
              </thead>
              <tbody>
                {brief.tenancy.map((t, i) => (
                  <tr key={i}>
                    <Td className="text-xs">{text(t.unit)}</Td>
                    <Td>{text(t.name)}</Td>
                    <Td className="text-xs text-ink-muted">{text(t.use)}</Td>
                    <Td align="right">{num(t.area_sq_ft)?.toLocaleString("en-GB") ?? (num(t.area_sq_m) !== null ? `${num(t.area_sq_m)!.toLocaleString("en-GB")} sq m` : "—")}</Td>
                    <Td align="right">{num(t.rent_pa) !== null ? formatMoney(num(t.rent_pa), currency) : "—"}</Td>
                    <Td align="right">{num(t.erv_pa) !== null ? formatMoney(num(t.erv_pa), currency) : "—"}</Td>
                    <Td className="text-xs">{text(t.lease_expiry)}</Td>
                    <Td className="text-xs">{text(t.break_option)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {!rentRoll && (
            <Provenance>
              A rent roll needs an area and a rent for every line. Until the full schedule is in, the assessment can only screen this deal.
            </Provenance>
          )}
        </div>
      )}

      {working && (
        <Provenance>
          v{working.version}: price {working.acquisitionPrice !== null ? formatMoney(working.acquisitionPrice, currency) : "—"},
          NIY {formatPct(working.entryYieldPct, 2)}, passing rent {working.grossRentalIncome !== null ? formatMoney(working.grossRentalIncome, currency) : "—"},
          ERV {working.erv !== null ? formatMoney(working.erv, currency) : "—"}, occupancy {formatPct(working.occupancyPct, 1)}.
          {brief.fileName ? ` Read from ${brief.fileName}.` : ""}
        </Provenance>
      )}
    </Section>
  );
}
