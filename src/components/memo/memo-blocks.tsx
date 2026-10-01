import type { Block, ResolvedSection } from "@/lib/memo/compose";
import { formatMetric, visibleMetrics, NOT_RECORDED } from "@/lib/memo/render";
import type { OutputFormat } from "@/lib/memo/sections";
import { cn } from "@/lib/utils";

/**
 * How a resolved memo section reads. One component for the workspace and the
 * print view, so what an author checks is what a reader receives.
 *
 * The three states are never confusable:
 *   edited   a person's own text, tagged as theirs
 *   composed figures and records, each block naming where it came from
 *   empty    a dashed box that says "No data recorded" and what would create it
 * Nothing here writes a sentence about the deal. Every word on screen is a label
 * this file owns, a value from a record, or text a person wrote.
 */
export function SectionBody({
  resolved, currency, format, surface,
}: {
  resolved: ResolvedSection;
  currency: string;
  format: OutputFormat;
  surface: "workspace" | "print";
}) {
  if (resolved.state === "edited") {
    return <p className="memo-text max-w-measure whitespace-pre-line text-sm leading-relaxed text-ink">{resolved.overrideText}</p>;
  }
  if (resolved.state === "empty") {
    return (
      <div className="border border-dashed border-line px-4 py-4">
        <p className="text-sm text-ink-muted">No data recorded</p>
        {surface === "workspace" && resolved.emptyReason && (
          <p className="mt-1 text-2xs leading-relaxed text-ink-faint">{resolved.emptyReason}</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {resolved.blocks.map((b, i) => (
        <BlockView key={i} block={b} currency={currency} format={format} surface={surface} />
      ))}
    </div>
  );
}

function BlockView({
  block: b, currency, format, surface,
}: { block: Block; currency: string; format: OutputFormat; surface: "workspace" | "print" }) {
  return (
    <div className="memo-block">
      {b.kind !== "facts" && b.label && (
        <div className="mb-1.5 text-2xs font-medium uppercase tracking-label text-ink-faint">{b.label}</div>
      )}
      {b.kind === "metrics" && (
        <dl className="divide-y divide-line border-y border-line">
          {visibleMetrics(b.items, format, surface).map((m) => (
            <div key={m.key} className="flex items-baseline justify-between gap-6 py-2">
              <dt className="text-2xs uppercase tracking-label text-ink-faint">{m.label}</dt>
              <dd className={cn("tabular text-sm", m.value === null ? "text-ink-faint" : "text-ink")}>
                {formatMetric(m, currency)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {b.kind === "facts" && (
        <dl className="divide-y divide-line border-y border-line">
          {b.items.map((i) => (
            <div key={i.label} className="flex items-baseline justify-between gap-6 py-2">
              <dt className="text-2xs uppercase tracking-label text-ink-faint">{i.label}</dt>
              <dd className="text-right text-sm text-ink">{i.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {b.kind === "text" && (
        <p className="memo-text max-w-measure whitespace-pre-line text-sm leading-relaxed text-ink">{b.text}</p>
      )}
      {b.kind === "list" && (
        <ul className="divide-y divide-line border-y border-line">
          {b.items.map((it, i) => (
            <li key={i} className="py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-ink">{it.title}</span>
                {it.tags.map((t) => (
                  <span key={t} className="text-2xs uppercase tracking-label text-ink-faint">{t}</span>
                ))}
              </div>
              {it.detail && <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-ink-muted">{it.detail}</p>}
            </li>
          ))}
        </ul>
      )}
      {surface === "workspace" && (
        <p className="mt-1.5 text-2xs text-ink-faint">
          Source: {b.source}{b.audience === "internal" ? " (internal)" : ""}
        </p>
      )}
    </div>
  );
}

export { NOT_RECORDED };
