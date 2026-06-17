import { FileDown, ScrollText } from "lucide-react";
import type { DealFile } from "@/types/database";
import { Card, CardBody } from "@/components/ui/card";

/**
 * Investment memo — assembles the deal file into a committee-ready document.
 * The PDF export engine is a later phase; this previews the section structure.
 */
export function MemoTab({ file }: { file: DealFile }) {
  const sections = [
    { title: "1. Executive Summary", ready: true },
    { title: "2. Asset Snapshot", ready: true },
    { title: "3. Investment Thesis & Strategy", ready: true },
    { title: "4. Financial Analysis & Returns", ready: !!file.metrics },
    { title: "5. Due Diligence Summary", ready: file.dueDiligence.length > 0 },
    { title: "6. Risk Register", ready: file.risks.length > 0 },
    { title: "7. Investment Score & Recommendation", ready: !!file.score },
    { title: "8. Decision Log & Next Steps", ready: file.decisions.length > 0 },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card className="border-gold/30 bg-gold/[0.03]">
        <CardBody className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gold/15 text-gold-deep">
            <ScrollText className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-ink">Investment Memo</div>
            <div className="text-xs text-ink-muted">
              One-click assembly of the full deal file into a Japanese investor–grade
              PDF memorandum. Export engine arrives in a later phase.
            </div>
          </div>
          <button
            disabled
            className="flex items-center gap-1.5 rounded bg-navy/40 px-3.5 py-2 text-xs font-medium text-surface/80"
          >
            <FileDown className="h-3.5 w-3.5" /> Export PDF
          </button>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-line">
            {sections.map((s) => (
              <li key={s.title} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-ink">{s.title}</span>
                <span
                  className={
                    s.ready
                      ? "text-2xs font-medium uppercase tracking-label text-positive"
                      : "text-2xs font-medium uppercase tracking-label text-ink-faint"
                  }
                >
                  {s.ready ? "Ready" : "Pending data"}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
