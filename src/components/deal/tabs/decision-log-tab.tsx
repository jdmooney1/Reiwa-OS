import type { DecisionLogEntry } from "@/types/database";
import { formatDate } from "@/lib/format";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const TYPE_LABEL: Record<string, string> = {
  screening: "Screening",
  investment_committee: "IC",
  bid: "Bid",
  exclusivity: "Exclusivity",
  legal: "Legal",
  completion: "Completion",
  abort: "Abort",
  other: "Note",
};

export function DecisionLogTab({ decisions }: { decisions: DecisionLogEntry[] }) {
  if (decisions.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="py-6 text-center text-sm italic text-ink-faint">
            No decisions recorded for this deal yet.
          </p>
        </CardBody>
      </Card>
    );
  }

  const sorted = [...decisions].sort(
    (a, b) => +new Date(b.decision_date) - +new Date(a.decision_date),
  );

  return (
    <Card>
      <CardBody className="p-0">
        <ol className="relative">
          {sorted.map((d, i) => (
            <li key={d.decision_id} className="relative flex gap-4 px-6 py-5">
              {/* Timeline rail */}
              <div className="flex flex-col items-center">
                <span className="mt-1 h-2.5 w-2.5 rounded-full border-2 border-gold bg-surface-card" />
                {i < sorted.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
              </div>
              <div className="flex-1 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-2xs font-medium text-ink-faint">
                    {formatDate(d.decision_date)}
                  </span>
                  <Badge tone="gold">{TYPE_LABEL[d.decision_type] ?? d.decision_type}</Badge>
                  {d.author && <span className="text-2xs text-ink-faint">· {d.author}</span>}
                </div>
                <div className="mt-1.5 text-sm font-medium text-ink">{d.decision}</div>
                {d.rationale && (
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">{d.rationale}</p>
                )}
                {d.next_steps && (
                  <p className="mt-1.5 text-2xs text-ink-faint">
                    <span className="font-medium uppercase tracking-label">Next:</span> {d.next_steps}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
