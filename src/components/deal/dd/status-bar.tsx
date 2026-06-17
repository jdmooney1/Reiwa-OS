import type { DdStatus } from "@/types/database";
import { DD_STATUS_LABEL, DD_STATUS_ORDER } from "@/lib/domain";

const SEGMENT_COLOR: Record<DdStatus, string> = {
  not_started: "#D8D0C0",
  requested: "#B9C2CB",
  in_progress: "#B98427",
  received: "#C2A14E",
  reviewed: "#3E7C5A",
  issue_identified: "#A6483D",
  resolved: "#2F6B4C",
  not_applicable: "#E2DBCD",
};

/** Proportional segmented bar across DD statuses. */
export function StatusBar({
  byStatus,
  height = 6,
}: {
  byStatus: Record<DdStatus, number>;
  height?: number;
}) {
  const total = DD_STATUS_ORDER.reduce((s, k) => s + byStatus[k], 0);
  if (total === 0) {
    return <div className="rounded-full bg-surface-sunken" style={{ height }} />;
  }
  return (
    <div className="flex overflow-hidden rounded-full bg-surface-sunken" style={{ height }}>
      {DD_STATUS_ORDER.map((s) => {
        const n = byStatus[s];
        if (n === 0) return null;
        return (
          <div
            key={s}
            title={`${DD_STATUS_LABEL[s]}: ${n}`}
            style={{ width: `${(n / total) * 100}%`, backgroundColor: SEGMENT_COLOR[s] }}
          />
        );
      })}
    </div>
  );
}
