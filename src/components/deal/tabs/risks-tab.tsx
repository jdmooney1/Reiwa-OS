import type { Risk } from "@/types/database";
import {
  RISK_STATUS_LABEL, RISK_STATUS_TONE, riskScoreTone,
} from "@/lib/domain";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const IMPACTS = [5, 4, 3, 2, 1]; // rows, top = highest impact
const PROBS = [1, 2, 3, 4, 5]; // columns

// Background tone for a matrix cell by its product (1..25).
function cellTone(product: number): string {
  if (product >= 15) return "bg-negative/15";
  if (product >= 9) return "bg-caution/15";
  if (product >= 4) return "bg-surface-sunken";
  return "bg-positive/10";
}

export function RisksTab({ risks }: { risks: Risk[] }) {
  if (risks.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="py-6 text-center text-sm italic text-ink-faint">
            No risks have been registered for this deal yet.
          </p>
        </CardBody>
      </Card>
    );
  }

  // Bucket risks by their (probability, impact) cell.
  const cellMap = new Map<string, Risk[]>();
  for (const r of risks) {
    if (r.probability && r.impact) {
      const key = `${r.probability}-${r.impact}`;
      const arr = cellMap.get(key) ?? [];
      arr.push(r);
      cellMap.set(key, arr);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* Risk matrix */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader eyebrow="Exposure" title="Risk Matrix" />
          <CardBody>
            <div className="flex gap-2">
              {/* Y axis label */}
              <div className="flex items-center">
                <span className="-rotate-90 whitespace-nowrap text-2xs uppercase tracking-label text-ink-faint">
                  Impact →
                </span>
              </div>
              <div className="flex-1">
                <div className="grid grid-cols-5 gap-1">
                  {IMPACTS.map((impact) =>
                    PROBS.map((prob) => {
                      const key = `${prob}-${impact}`;
                      const inCell = cellMap.get(key) ?? [];
                      return (
                        <div
                          key={key}
                          className={cn(
                            "relative flex aspect-square items-center justify-center rounded",
                            cellTone(prob * impact),
                          )}
                          title={`P${prob} × I${impact} = ${prob * impact}`}
                        >
                          {inCell.length > 0 && (
                            <span className="tabular flex h-6 w-6 items-center justify-center rounded-full bg-purple text-2xs font-semibold text-surface">
                              {inCell.length}
                            </span>
                          )}
                        </div>
                      );
                    }),
                  )}
                </div>
                <div className="mt-1.5 text-center text-2xs uppercase tracking-label text-ink-faint">
                  Probability →
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-center gap-3 text-2xs text-ink-muted">
              <Legend className="bg-positive/30" label="Low" />
              <Legend className="bg-surface-sunken" label="Moderate" />
              <Legend className="bg-caution/40" label="High" />
              <Legend className="bg-negative/40" label="Severe" />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Mitigation table */}
      <div className="lg:col-span-3">
        <Card>
          <CardHeader eyebrow="Register" title="Risks & Mitigation" />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Risk", "Score", "Mitigation", "Owner", "Status"].map((h) => (
                    <th key={h} className="px-4 py-2 text-2xs font-medium uppercase tracking-label text-ink-faint">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {[...risks].sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0)).map((r) => (
                  <tr key={r.risk_id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{r.risk_title}</div>
                      <div className="text-2xs capitalize text-ink-faint">{r.risk_category}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "tabular inline-flex h-6 w-6 items-center justify-center rounded text-2xs font-semibold",
                          riskScoreTone(r.risk_score) === "negative" && "bg-negative/10 text-negative",
                          riskScoreTone(r.risk_score) === "caution" && "bg-caution/10 text-caution",
                          riskScoreTone(r.risk_score) === "positive" && "bg-positive/10 text-positive",
                        )}
                      >
                        {r.risk_score ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-xs text-xs text-ink-muted">{r.mitigation ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-ink-muted">{r.owner ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone={RISK_STATUS_TONE[r.status]} dot>{RISK_STATUS_LABEL[r.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("h-2.5 w-2.5 rounded-sm", className)} />
      {label}
    </span>
  );
}
