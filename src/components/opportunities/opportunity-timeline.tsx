"use client";

// ============================================================================
// Opportunity timeline — this campaign, or the whole property's history.
// ----------------------------------------------------------------------------
// The toggle is the product. "This opportunity" is what a CRM shows. "All
// campaigns" is what makes the database proprietary: when the asset first came
// to market, who marketed it, how the pricing moved, what happened to the sale,
// and whether it came back.
// ============================================================================
import { useState } from "react";
import {
  Clock, TrendingDown, TrendingUp, FileText, Mail, Gavel, XCircle,
  RotateCcw, CheckCircle2, Flag, PenLine, Landmark, Users,
} from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type { PropertyEvent, PropertyEventType } from "@/lib/data/property-events";

const ICON: Record<PropertyEventType, typeof Clock> = {
  first_seen: Flag,
  price_quoted: Landmark,
  price_changed: TrendingDown,
  income_revised: TrendingUp,
  broker_changed: Users,
  brochure_received: FileText,
  email_received: Mail,
  tenancy_revised: FileText,
  market_status_changed: Clock,
  withdrawn: XCircle,
  relaunched: RotateCcw,
  sold: CheckCircle2,
  failed_sale: XCircle,
  bid_submitted: Gavel,
  reiwa_passed: XCircle,
  reiwa_stage_changed: Clock,
  investor_approached: Users,
  published: Landmark,
  imported: FileText,
  note: PenLine,
};

const TONE: Partial<Record<PropertyEventType, string>> = {
  price_changed: "text-caution",
  withdrawn: "text-ink-faint",
  sold: "text-ink-faint",
  failed_sale: "text-negative",
  reiwa_passed: "text-ink-faint",
  relaunched: "text-gold-deep",
  bid_submitted: "text-positive",
};

const SOURCE_LABEL: Record<string, string> = {
  broker_email: "Broker email",
  brochure: "Brochure",
  spreadsheet: "Spreadsheet import",
  reiwa_manual: "Reiwa",
  reiwa_assumption: "Reiwa assumption",
  underwriting: "Underwriting",
  public_record: "Public record",
};

export function OpportunityTimeline({
  opportunityEvents,
  propertyEvents,
}: {
  opportunityEvents: PropertyEvent[];
  propertyEvents: PropertyEvent[];
}) {
  const [scope, setScope] = useState<"opportunity" | "property">("opportunity");
  const events = scope === "opportunity" ? opportunityEvents : propertyEvents;

  // How many earlier campaigns this property has been through.
  const campaigns = new Set(
    propertyEvents.map((e) => e.opportunityId).filter(Boolean) as string[]);
  const hasHistory = propertyEvents.length > opportunityEvents.length;

  return (
    <Card>
      <CardHeader
        eyebrow="History"
        title="Timeline"
        action={
          <div className="flex items-center rounded border border-line bg-surface p-0.5">
            {([
              ["opportunity", "This opportunity"],
              ["property", campaigns.size > 1 ? `All ${campaigns.size} campaigns` : "Whole property"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setScope(key)}
                className={cn(
                  "rounded px-2.5 py-1 text-2xs font-medium transition-colors",
                  scope === key ? "bg-navy text-surface" : "text-ink-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />
      <CardBody className="p-0">
        {scope === "opportunity" && hasHistory && (
          <div className="border-b border-line bg-gold/[0.04] px-5 py-2 text-2xs text-ink-muted">
            Reiwa has seen this property before.{" "}
            <button onClick={() => setScope("property")} className="font-medium text-gold-deep hover:underline">
              Show the full property history
            </button>
          </div>
        )}

        {events.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-muted">No events recorded yet.</div>
        ) : (
          <ol className="relative px-5 py-4">
            {events.map((event, i) => {
              const Icon = ICON[event.eventType] ?? Clock;
              const otherCampaign =
                scope === "property" &&
                opportunityEvents.length > 0 &&
                event.opportunityId !== opportunityEvents[0].opportunityId;
              return (
                <li key={event.eventId} className="relative flex gap-3 pb-4 last:pb-0">
                  {/* Connector */}
                  {i < events.length - 1 && (
                    <span className="absolute left-[11px] top-6 h-full w-px bg-line" aria-hidden />
                  )}
                  <span className={cn(
                    "relative z-10 mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-line bg-surface-card",
                    TONE[event.eventType] ?? "text-ink-muted",
                  )}>
                    <Icon className="h-3 w-3" strokeWidth={2} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className={cn("text-xs font-medium text-ink", otherCampaign && "text-ink-muted")}>
                        {event.headline}
                      </span>
                      {otherCampaign && (
                        <span className="rounded border border-line px-1 text-[10px] text-ink-faint">
                          earlier campaign
                        </span>
                      )}
                    </div>
                    {event.detail && (
                      <div className="mt-0.5 text-2xs text-ink-muted">{event.detail}</div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-ink-faint">
                      <span className="tabular">{formatDate(event.occurredAt)}</span>
                      {event.sourceKind && (
                        <>
                          <span>·</span>
                          <span>{SOURCE_LABEL[event.sourceKind] ?? event.sourceKind}</span>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
