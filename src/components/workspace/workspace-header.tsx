import Link from "next/link";
import { ChevronLeft, ArrowRight } from "lucide-react";
import type { OpportunityFile } from "@/lib/data/opportunity-file";
import type { OppStage } from "@/lib/data/opportunity-types";
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";
import { Badge } from "@/components/ui/badge";
import type { AssetType, Strategy } from "@/types/database";
import { STAGE_LABEL, STATUS_LABEL, STATUS_TONE, PRIORITY_LABEL } from "@/lib/workspace/labels";
import { WorkspaceNav } from "@/components/workspace/workspace-nav";

/**
 * The top of an investment file.
 *
 * One band, not a hero: name, where it is in the process, and where it sits in
 * the world — then the section rule. Everything else is a section's job. The
 * stage strip is a read-out here rather than a control; advancing a stage is a
 * decision taken on the Decision section, not a button you press in passing.
 */
export function WorkspaceHeader({
  file, canWrite,
}: {
  file: OpportunityFile;
  canWrite: boolean;
}) {
  const o = file.opportunity;
  const converted = o.status === "converted" || !!o.assetId;

  return (
    <div className="border-b border-line bg-surface-card">
      <div className="px-6 pt-5 sm:px-8">
        <Link href="/pipeline"
          className="mb-2 inline-flex items-center gap-1 text-2xs text-ink-faint hover:text-ink">
          <ChevronLeft className="h-3 w-3" /> Pipeline
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl leading-tight text-ink">{o.name}</h1>
              <Badge tone="neutral">{STAGE_LABEL[o.stage as OppStage]}</Badge>
              <Badge tone={STATUS_TONE[o.status]} dot>{STATUS_LABEL[o.status]}</Badge>
              {o.priority !== "medium" && (
                <Badge tone={o.priority === "high" ? "caution" : "muted"}>
                  {PRIORITY_LABEL[o.priority]} priority
                </Badge>
              )}
            </div>
            <div className="mt-1 text-sm text-ink-muted">
              {placeLine(o.city, o.market, o.submarket, [
                ASSET_TYPE_LABEL[o.assetType as AssetType] ?? o.assetType,
                o.strategy ? STRATEGY_LABEL[o.strategy as Strategy] ?? o.strategy : null,
              ])}
            </div>
          </div>

          {converted && o.assetId && (
            <Link href={`/assets/${o.assetId}`}
              className="flex shrink-0 items-center gap-1.5 rounded border border-line px-3.5 py-2 text-xs font-semibold text-ink-muted hover:text-ink">
              View asset <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      <WorkspaceNav opportunityId={o.opportunityId} counts={file.counts} />
    </div>
  );
}

/**
 * Location, without repeating itself.
 *
 * City, market and submarket are three columns that frequently hold the same
 * word — a London office in the London market reads as "London · London",
 * which makes the header look generated rather than written.
 */
function placeLine(
  city: string | null,
  market: string | null,
  submarket: string | null,
  rest: (string | null)[],
): string {
  const place: string[] = [];
  for (const part of [city, submarket ?? market]) {
    if (!part) continue;
    if (place.some((p) => p.toLowerCase() === part.toLowerCase())) continue;
    place.push(part);
  }
  return [...place, ...rest].filter(Boolean).join(" · ");
}
