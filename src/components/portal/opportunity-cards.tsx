import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { PortalOpportunity } from "@/lib/data/portal-feed";
import {
  headlineMetrics, opportunityMetrics, locationLabel, assetTypeLabel, strategyLabel,
} from "@/lib/portal/metrics";
import { SaveButton, CompareButton } from "@/components/portal/portal-actions";

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
          {i > 0 && <span className="px-1.5 text-line">·</span>}
          {p}
        </span>
      ))}
    </span>
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
    <article className="overflow-hidden rounded-lg border border-line bg-surface-card">
      <div className="border-b border-line bg-navy px-6 py-2.5 sm:px-8">
        <span className="text-2xs font-medium uppercase tracking-label text-gold-soft">
          Selected for your review
        </span>
      </div>

      <div className="grid gap-8 px-6 py-7 sm:px-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div>
          <h2 className="font-serif text-2xl leading-tight text-ink">
            <Link href={href(o)} className="hover:text-gold-deep">{o.title}</Link>
          </h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            {locationLabel(o)}
            <span className="px-2 text-line">|</span>
            <Attributes o={o} />
          </p>

          {o.headline && (
            <p className="mt-4 font-serif text-base leading-relaxed text-ink">{o.headline}</p>
          )}
          {o.overview && (
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">{o.overview}</p>
          )}

          {o.highlights.length > 0 && (
            <ul className="mt-5 space-y-1.5">
              {o.highlights.slice(0, 4).map((h) => (
                <li key={h} className="flex gap-2.5 text-sm leading-relaxed text-ink">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-gold" />
                  {h}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-7 flex flex-wrap items-center gap-2.5">
            <Link
              href={href(o)}
              className="inline-flex items-center gap-2 rounded bg-navy px-5 py-2.5 text-xs font-semibold text-surface transition-colors hover:bg-navy-50"
            >
              View Opportunity
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            </Link>
            <SaveButton publicationId={o.publicationId} saved={saved} size="lg" />
            <CompareButton publicationId={o.publicationId} size="lg" />
          </div>
        </div>

        <dl className="divide-y divide-line self-start rounded border border-line bg-surface-sunken/50">
          {metrics.map((m) => (
            <div key={m.key} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
              <dt className="text-2xs uppercase tracking-label text-ink-faint">{m.label}</dt>
              <dd className="font-serif text-base tabular-nums text-ink">{m.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {o.investorNote && <InvestorNote note={o.investorNote} />}
    </article>
  );
}

/** The admin's own note to this investor organisation — approved, per-investor. */
export function InvestorNote({ note }: { note: string }) {
  return (
    <div className="border-t border-line bg-gold/[0.06] px-6 py-4 sm:px-8">
      <div className="eyebrow mb-1 text-gold-deep">Note from Reiwa Capital</div>
      <p className="max-w-prose text-sm leading-relaxed text-ink">{note}</p>
    </div>
  );
}

/** A secondary opportunity: enough to screen it, not enough to overwhelm. */
export function OpportunityCard({
  opportunity: o, saved,
}: {
  opportunity: PortalOpportunity;
  saved: boolean;
}) {
  const metrics = headlineMetrics(o);
  return (
    <article className="flex flex-col rounded-lg border border-line bg-surface-card transition-colors hover:border-gold/35">
      <div className="flex-1 px-5 py-5">
        <h3 className="font-serif text-lg leading-snug text-ink">
          <Link href={href(o)} className="hover:text-gold-deep">{o.title}</Link>
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          {locationLabel(o)}
          <span className="px-1.5 text-line">|</span>
          <Attributes o={o} />
        </p>

        {(o.headline || o.overview) && (
          <p className="mt-3.5 line-clamp-3 text-sm leading-relaxed text-ink-muted">
            {o.headline ?? o.overview}
          </p>
        )}

        {metrics.length > 0 && (
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-3.5">
            {metrics.map((m) => (
              <div key={m.key}>
                <dt className="text-2xs uppercase tracking-label text-ink-faint">{m.label}</dt>
                <dd className="font-serif text-sm tabular-nums text-ink">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
        <Link
          href={href(o)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-navy hover:text-gold-deep"
        >
          View Opportunity
          <ArrowRight className="h-3 w-3" strokeWidth={2} />
        </Link>
        <div className="flex items-center gap-2">
          <SaveButton publicationId={o.publicationId} saved={saved} />
          <CompareButton publicationId={o.publicationId} />
        </div>
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
    <div className="rounded-lg border border-dashed border-line bg-surface-card px-8 py-14 text-center">
      <h2 className="font-serif text-lg text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">{body}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
