import { Flag } from "lucide-react";
import type { DueDiligenceItem } from "@/types/database";
import {
  DD_STATUS_LABEL, DD_STATUS_TONE, PRIORITY_LABEL, PRIORITY_TONE,
} from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function DueDiligenceTab({ items }: { items: DueDiligenceItem[] }) {
  if (items.length === 0) {
    return <EmptyCard text="No due diligence items have been opened for this deal yet." />;
  }

  const total = items.length;
  const complete = items.filter((i) => i.status === "complete").length;
  const inProgress = items.filter((i) => i.status === "in_progress").length;
  const blocked = items.filter((i) => i.status === "blocked").length;
  const pct = Math.round((complete / total) * 100);

  // Priority items: critical / high and not complete.
  const priorityItems = items
    .filter((i) => (i.priority === "critical" || i.priority === "high") && i.status !== "complete")
    .sort((a, b) => (a.priority === "critical" ? -1 : 1));

  // Group by category (only categories that have items).
  const grouped = new Map<string, DueDiligenceItem[]>();
  for (const item of items) {
    const arr = grouped.get(item.category) ?? [];
    arr.push(item);
    grouped.set(item.category, arr);
  }

  return (
    <div className="space-y-6">
      {/* Status tracker */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Workstreams" value={total} />
        <StatTile label="Complete" value={complete} tone="positive" />
        <StatTile label="In Progress" value={inProgress} tone="caution" />
        <StatTile label="Blocked" value={blocked} tone="negative" />
      </div>

      <Card>
        <CardBody className="py-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink">Overall completion</span>
            <span className="tabular text-ink-muted">{complete} / {total} · {pct}%</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-surface-sunken">
            <div className="h-full rounded-full bg-positive" style={{ width: `${pct}%` }} />
          </div>
        </CardBody>
      </Card>

      {/* Priority items */}
      {priorityItems.length > 0 && (
        <Card className="border-caution/30 bg-caution/[0.03]">
          <CardHeader
            eyebrow="Attention"
            title="Priority Items"
            action={<Flag className="h-4 w-4 text-caution" strokeWidth={1.75} />}
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {priorityItems.map((item) => (
                <li key={item.item_id} className="flex items-center justify-between gap-4 px-5 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{item.item}</div>
                    <div className="text-2xs text-ink-faint">{item.category} · {item.owner ?? "Unassigned"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={PRIORITY_TONE[item.priority]}>{PRIORITY_LABEL[item.priority]}</Badge>
                    <Badge tone={DD_STATUS_TONE[item.status]} dot>{DD_STATUS_LABEL[item.status]}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Checklist grouped by category */}
      <div className="space-y-5">
        {Array.from(grouped.entries()).map(([category, catItems]) => {
          const done = catItems.filter((i) => i.status === "complete").length;
          return (
            <Card key={category}>
              <CardHeader
                eyebrow="Category"
                title={category}
                action={
                  <span className="tabular text-2xs text-ink-faint">{done}/{catItems.length} complete</span>
                }
              />
              <CardBody className="p-0">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {catItems.map((item) => (
                      <tr key={item.item_id} className="align-top">
                        <td className="px-5 py-3">
                          <div className="font-medium text-ink">{item.item}</div>
                          {item.description && (
                            <div className="mt-0.5 max-w-xl text-xs text-ink-muted">{item.description}</div>
                          )}
                          {item.notes && (
                            <div className="mt-1 text-2xs italic text-ink-faint">Note: {item.notes}</div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-muted">{item.owner ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right text-xs text-ink-muted">{formatDate(item.due_date)}</td>
                        <td className="px-3 py-3 text-right">
                          <Badge tone={PRIORITY_TONE[item.priority]}>{PRIORITY_LABEL[item.priority]}</Badge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Badge tone={DD_STATUS_TONE[item.status]} dot>{DD_STATUS_LABEL[item.status]}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function StatTile({
  label, value, tone,
}: {
  label: string; value: number; tone?: "positive" | "caution" | "negative";
}) {
  const color =
    tone === "positive" ? "text-positive" :
    tone === "caution" ? "text-caution" :
    tone === "negative" ? "text-negative" : "text-ink";
  return (
    <Card>
      <CardBody className="py-3">
        <div className="text-2xs uppercase tracking-label text-ink-faint">{label}</div>
        <div className={`tabular mt-1 text-2xl font-semibold ${color}`}>{value}</div>
      </CardBody>
    </Card>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <Card>
      <CardBody>
        <p className="py-6 text-center text-sm italic text-ink-faint">{text}</p>
      </CardBody>
    </Card>
  );
}
