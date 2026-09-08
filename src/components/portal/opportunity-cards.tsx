import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { PortalOpportunity } from "@/lib/data/portal-feed";
import {
  headlineMetrics, opportunityMetrics, locationLabel, assetTypeLabel, strategyLabel,
} from "@/lib/portal/metrics";
import { SaveButton, CompareButton } from "@/components/portal/portal-actions";

// ============================================================================
// The investor feed, set as a memorandum rather than a dashboard.
//
// Nothing here is a card. An opportunity is a heading, a line of provenance,
// the approved copy and a ruled column of figures — the containers that used to
// hold each one added weight without adding meaning, and the navy "Selected for
// your review" banner implied a recommendation Reiwa had not made.
// ============================================================================

function href(o: PortalOpportunity): string {
  return `/portal/opportunities/${o.publicationId}`;
}

/** Asset type · strategy, as quiet running text rather than a row of chips. */
function Attributes({ o }: { o: PortalOpportunity }) {
  const parts = [assetTypeLabel(o.assetType), strategyLabel(o.strategy)].filter((p) => p !== "—");
  if (parts.length === 0) return null;
  return (
    <span className="text-ink-faint">
      {parts.map((p, i) => (
        <span key={p}>
          {i > 0 && <span className="px-1.5 text-line-strong">·</span>}
          {p}
        </span>
      ))}
    </span>
  );
}

/** The ruled figure column. The same data the box used to hold. */
function FigureList({
  metrics,
}: {
  metrics: { key: string; label: string; value: string }[];
}) {
  return (
    <dl className="self-start border-t border-line">
      {metrics.map((m) => (
        <div
          key={m.key}
          className="flex items-baseline justify-between gap-6 border-b border-line py-3"
        >
          <dt className="text-2xs uppercase tracking-label text-ink-faint">{m.label}</dt>
          <dd className="figure text-base text-ink">{m.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The one opportunity Reiwa has put in front of this investor. Presented as the
 * opening page of a memorandum would be: name, place, the approved summary, and
 * the numbers set apart in their own column.
 */
export function FeaturedOpportunity({
  opportunity: o, saved,
}: {
  opportunity: PortalOpportunity;
  saved: boolean;
}) {
  const metrics = opportunityMetrics(o, { compact: true });
  return (
    <article>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div>
          <h2 className="text-3xl leading-tight tracking-[-0.02em] text-ink">
            <Link href={href(o)} className="hover:text-purple">{o.title}</Link>
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            {locationLabel(o)}
            <span className="px-2 text-line-strong">|</span>
            <Attributes o={o} />
          </p>

          {o.headline && (
            <p className="mt-6 max-w-measure text-base leading-relaxed text-ink">{o.headline}</p>
          )}
          {o.overview && (
            <p className="mt-3 max-w-measure text-sm leading-relaxed text-ink-muted">{o.overview}</p>
          )}

          {o.highlights.length > 0 && (
            <ul className="mt-6 space-y-2">
              {o.highlights.slice(0, 4).map((h) => (
                <li key={h} className="flex gap-3 text-sm leading-relaxed text-ink">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-1 w-1 shrink-0 rounded-full bg-line-strong"
                  />
                  {h}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={href(o)}
              className="inline-flex items-center gap-2 rounded bg-purple px-5 py-2.5 text-xs font-medium text-surface transition-colors hover:bg-purple-70"
            >
              View opportunity
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            </Link>
            <SaveButton publicationId={o.publicationId} saved={saved} size="lg" />
            <CompareButton publicationId={o.publicationId} size="lg" />
          </div>
        </div>

        <FigureList metrics={metrics} />
      </div>

      {o.investorNote && <InvestorNote note={o.investorNote} className="mt-10" />}
    </article>
  );
}

/**
 * The admin's own note to this investor organisation — approved, per-investor.
 * A purple rule rather than a tinted panel: this is the one place the brand
 * colour appears inside the body of a page, and it marks the one piece of copy
 * addressed to this reader personally.
 */
export function InvestorNote({ note, className }: { note: string; className?: string }) {
  return (
    <div className={`border-l-2 border-purple py-1 pl-5 ${className ?? ""}`}>
      <div className="eyebrow">Note from Reiwa Capital</div>
      <p className="mt-1.5 max-w-measure text-sm leading-relaxed text-ink">{note}</p>
    </div>
  );
}

/**
 * A secondary opportunity: a ruled entry in a list, with enough to screen it
 * and no more.
 */
export function OpportunityCard({
  opportunity: o, saved,
}: {
  opportunity: PortalOpportunity;
  saved: boolean;
}) {
  const metrics = headlineMetrics(o);
  return (
    <article className="border-b border-line py-7">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div>
          <h3 className="text-xl leading-snug tracking-[-0.01em] text-ink">
            <Link href={href(o)} className="hover:text-purple">{o.title}</Link>
          </h3>
          <p className="mt-1.5 text-xs text-ink-muted">
            {locationLabel(o)}
            <span className="px-1.5 text-line-strong">|</span>
            <Attributes o={o} />
          </p>

          {(o.headline || o.overview) && (
            <p className="mt-3 max-w-measure text-sm leading-relaxed text-ink-muted">
              {o.headline ?? o.overview}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-5">
            <Link
              href={href(o)}
              className="inline-flex items-center gap-1.5 border-b border-purple pb-0.5 text-xs font-medium text-purple transition-colors hover:border-purple-70 hover:text-purple-70"
            >
              View opportunity
              <ArrowRight className="h-3 w-3" strokeWidth={2} />
            </Link>
            <div className="flex items-center gap-3">
              <SaveButton publicationId={o.publicationId} saved={saved} />
              <CompareButton publicationId={o.publicationId} />
            </div>
          </div>
        </div>

        {/* items-end so the figures share a baseline even when one label wraps
            to two lines and its neighbour does not. */}
        {metrics.length > 0 && (
          <dl className="grid grid-cols-2 items-end gap-x-6 gap-y-4 self-start sm:grid-cols-3">
            {metrics.map((m) => (
              <div key={m.key} className="min-w-0">
                <dt className="text-2xs uppercase leading-snug tracking-label text-ink-faint">
                  {m.label}
                </dt>
                <dd className="figure mt-1 text-sm text-ink">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </article>
  );
}

/** A calm, explanatory state — never a raw error, never an empty screen. */
export function PortalEmptyState({
  title, body, action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-10">
      <h2 className="text-lg text-ink">{title}</h2>
      <p className="mt-2 max-w-measure text-sm leading-relaxed text-ink-muted">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
