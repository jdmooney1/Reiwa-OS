import Link from "next/link";
import type { UnderwritingVersion } from "@/lib/data/underwriting-types";
import type { VersionComparison } from "@/lib/underwriting/compare";
import { formatMoneyCompact, formatPct, formatMultiple, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Section, TableWrap, Th, Td, Empty, Provenance, FactList,
} from "@/components/workspace/primitives";
import { CASE_STATUS_LABEL, CASE_STATUS_TONE } from "@/lib/workspace/labels";
import { NewVersionForm } from "@/components/workspace/new-version-form";
import type { Currency } from "@/types/database";

/**
 * Underwriting: every version, what changed, and which one counts.
 *
 * The history is the point. An approved version is immutable in the database,
 * so this screen offers no way to edit one — not because the button is hidden,
 * but because there is nothing it could call. Revising approved underwriting
 * means creating the next version, which is what the form does.
 */
export function UnderwritingSection({
  opportunityId, versions, comparison, canWrite, currency,
}: {
  opportunityId: string;
  versions: UnderwritingVersion[];
  comparison: VersionComparison | null;
  canWrite: boolean;
  currency: Currency;
}) {
  const working = versions.find((v) => v.status === "current") ?? null;
  const approved = versions.find((v) => v.status === "approved") ?? null;
  const seed = working ?? approved ?? versions[0] ?? null;

  return (
    <div>
      <Section eyebrow="History" title="Underwriting versions">
        {versions.length === 0 ? (
          <Empty
            title="No underwriting yet."
            hint="The first version establishes the figures this opportunity is judged on."
          />
        ) : (
          <TableWrap>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th className="w-12">v</Th>
                  <Th>Status</Th>
                  <Th>Author</Th>
                  <Th>Date</Th>
                  <Th align="right">Acquisition</Th>
                  <Th align="right">Total cost</Th>
                  <Th align="right">Target IRR</Th>
                  <Th>Change rationale</Th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.caseId} className={cn(v.status === "superseded" && "text-ink-faint")}>
                    <Td className="tabular">{v.version}</Td>
                    <Td>
                      <Badge tone={CASE_STATUS_TONE[v.status]}>{CASE_STATUS_LABEL[v.status]}</Badge>
                    </Td>
                    <Td className="text-xs text-ink-muted">{v.createdByName ?? "—"}</Td>
                    <Td className="text-xs text-ink-muted">{formatDate(v.createdAt)}</Td>
                    <Td align="right">{formatMoneyCompact(v.acquisitionPrice, currency)}</Td>
                    <Td align="right">{formatMoneyCompact(v.totalCost, currency)}</Td>
                    <Td align="right">{formatPct(v.targetIrr, 1)}</Td>
                    <Td className="max-w-xs text-xs text-ink-muted">{v.changeRationale ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}

        {approved && (
          <Provenance>
            Version {approved.version} was approved on {formatDate(approved.approvedAt)} and cannot be
            altered. Revising it means creating the next version.
          </Provenance>
        )}
      </Section>

      {comparison && (
        <Section
          eyebrow="Movement"
          title={`What changed from v${comparison.from.version} to v${comparison.to.version}`}
        >
          {comparison.changes.length === 0 && comparison.assumptionChanges.length === 0 ? (
            <Empty title="Nothing moved between these two versions." />
          ) : (
            <TableWrap>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Line</Th>
                    <Th align="right">v{comparison.from.version}</Th>
                    <Th align="right">v{comparison.to.version}</Th>
                    <Th align="right">Change</Th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.changes.map((c) => (
                    <tr key={String(c.field.key)}>
                      <Td>
                        <span className="text-ink">{c.field.label}</span>
                        <span className="ml-2 text-2xs text-ink-faint">{c.field.group}</span>
                      </Td>
                      <Td align="right" className="text-ink-muted">
                        {renderValue(c.from, c.field.kind, currency)}
                      </Td>
                      <Td align="right">{renderValue(c.to, c.field.kind, currency)}</Td>
                      <Td align="right">
                        {c.delta === null ? (
                          <span className="text-2xs text-ink-faint">revised</span>
                        ) : (
                          <span className={cn(
                            "tabular",
                            c.direction === "better" && "text-positive",
                            c.direction === "worse" && "text-negative",
                            c.direction === null && "text-ink-muted",
                          )}>
                            {/* Sign before the symbol: "-£2.3m", never "£-2.3m". */}
                            {c.delta > 0 ? "+" : c.delta < 0 ? "−" : ""}
                            {renderValue(Math.abs(c.delta), c.field.kind, currency)}
                            {c.deltaPct != null && (
                              <span className="ml-1.5 text-2xs text-ink-faint">
                                {c.deltaPct > 0 ? "+" : ""}{(c.deltaPct * 100).toFixed(1)}%
                              </span>
                            )}
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}

          {comparison.assumptionChanges.length > 0 && (
            <div className="mt-5">
              <div className="eyebrow mb-2">Assumptions</div>
              <FactList items={comparison.assumptionChanges.map((a) => ({
                k: a.key,
                v: (
                  <span className="tabular text-xs">
                    <span className="text-ink-faint">{String(a.from ?? "—")}</span>
                    <span className="mx-2 text-ink-faint">→</span>
                    <span className="text-ink">{String(a.to ?? "—")}</span>
                  </span>
                ),
              }))} />
            </div>
          )}

          <Provenance>
            {comparison.unchangedCount} line{comparison.unchangedCount === 1 ? "" : "s"} unchanged and not listed.
          </Provenance>
        </Section>
      )}

      {versions.length > 1 && (
        <Section eyebrow="Compare" title="Choose two versions">
          <div className="flex flex-wrap gap-2">
            {versions.map((a) =>
              versions
                .filter((b) => b.version > a.version)
                .map((b) => (
                  <Link
                    key={`${a.caseId}-${b.caseId}`}
                    href={`/opportunities/${opportunityId}/underwriting?from=${a.version}&to=${b.version}`}
                    className={cn(
                      "rounded border px-2.5 py-1.5 text-2xs font-medium transition-colors",
                      comparison?.from.version === a.version && comparison?.to.version === b.version
                        ? "border-line-strong bg-purple text-surface"
                        : "border-line text-ink-muted hover:text-ink",
                    )}
                  >
                    v{a.version} → v{b.version}
                  </Link>
                )),
            )}
          </div>
        </Section>
      )}

      {canWrite && (
        <Section
          eyebrow="Revise"
          title="New underwriting version"
        >
          <p className="mb-4 max-w-2xl text-xs leading-relaxed text-ink-muted">
            A new version starts from
            {seed ? ` version ${seed.version}` : " an empty case"} and becomes the working
            version. Nothing that has been approved is altered.
          </p>
          <NewVersionForm opportunityId={opportunityId} seed={seed} currency={currency} />
        </Section>
      )}
    </div>
  );
}

function renderValue(v: string | number | null, kind: string, cur: Currency): string {
  if (v === null) return "—";
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 60)}…` : v;
  switch (kind) {
    case "money": return formatMoneyCompact(v, cur);
    case "percent": return formatPct(v, 2);
    case "multiple": return formatMultiple(v);
    case "years": return `${v} yrs`;
    default: return String(v);
  }
}
