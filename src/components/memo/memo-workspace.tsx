import Link from "next/link";
import type { StoredMemo } from "@/lib/data/memos";
import {
  resolveSection, sectionsFor, emptySectionsFor, unreviewedExternalText, finaliseNotices, sameContent, JAPANESE_KEY,
  type ComposedMemo, type MemoOverrides,
} from "@/lib/memo/compose";
import { OUTPUT_FORMATS, FORMAT_BY_KEY, SECTION_LABEL, type OutputFormat } from "@/lib/memo/sections";
import { Section, Provenance } from "@/components/workspace/primitives";
import { SectionBody } from "@/components/memo/memo-blocks";
import { AssetSnapshot } from "@/components/memo/asset-snapshot";
import {
  StartMemoButton, RecomposeButton, FinalizeForm, PrintLink, OverrideEditor,
} from "@/components/memo/memo-controls";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The Memo tab: one composed record, read through four formats.
 *
 * With no saved memo it shows a live PREVIEW composed from today's rows and
 * nothing can be edited until a draft is started. A draft is a snapshot: it does
 * not change under the person editing it, and says when today's records have
 * moved on. A final memo is read-only and is never recomposed.
 */
export function MemoWorkspace({
  opportunityId, memo, live, format, canWrite,
}: {
  opportunityId: string;
  /** The stored memo (latest version), or null when none has been started. */
  memo: StoredMemo | null;
  /** The memo composed from today's rows. */
  live: ComposedMemo;
  format: OutputFormat;
  canWrite: boolean;
}) {
  const shown: ComposedMemo = memo ? memo.content : live;
  const overrides: MemoOverrides = memo ? memo.overrides : {};
  const isDraft = memo?.status === "draft";
  const isFinal = memo?.status === "final";
  const editable = canWrite && isDraft;
  const fmt = FORMAT_BY_KEY[format];
  const base = `/opportunities/${opportunityId}/memo`;

  const stale = isDraft && !sameContent(live, memo!.content);
  const basis = shown.basis;
  const empties = emptySectionsFor(shown, overrides, format);
  const unreviewed = unreviewedExternalText(shown, overrides, format);
  const notices = finaliseNotices(shown, format);

  return (
    <div>
      <Section
        eyebrow="Memo"
        title={memo ? `Investment memo, version ${memo.version} (${memo.status})` : "Investment memo (preview, not saved)"}
        action={canWrite && (
          <div className="flex flex-wrap items-start gap-2">
            {!memo && <StartMemoButton opportunityId={opportunityId} label="Start a memo from these records" />}
            {isFinal && <StartMemoButton opportunityId={opportunityId} label={`Create version ${memo!.version + 1}`} />}
            {isDraft && <RecomposeButton opportunityId={opportunityId} memoId={memo!.memoId} />}
            {memo && <PrintLink href={`${base}/print?format=${format}`} />}
          </div>
        )}
      >
        <MemoStatus memo={memo} basisText={basisText(basis)} stale={stale} />

        <nav className="mt-5 flex flex-wrap gap-1" aria-label="Output format">
          {OUTPUT_FORMATS.map((f) => (
            <Link
              key={f.key} href={`${base}?format=${f.key}`} aria-current={f.key === format ? "page" : undefined}
              className={cn(
                "rounded border px-3 py-1.5 text-xs font-medium transition-colors",
                f.key === format ? "border-purple bg-purple text-surface" : "border-line text-ink-muted hover:text-ink",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <p className="mt-2 text-2xs text-ink-faint">{fmt.description} The same record is shown through each format; choosing one only changes which sections appear.</p>

        {basis.kind === "working" && (
          <p className="mt-4 border-l-2 border-caution pl-3 text-xs text-caution" role="status">
            Based on unapproved underwriting: version {basis.version} is the working version and has not been through committee.
          </p>
        )}
        {basis.kind === "none" && (
          <p className="mt-4 border-l-2 border-line-strong pl-3 text-xs text-ink-muted" role="status">
            This opportunity has no underwriting version yet, so the sections that need figures are empty.
          </p>
        )}
      </Section>

      {format === "snapshot" ? (
        <Section title="One-page Asset Snapshot" action={<StateTag state={shown.snapshot ? "composed" : "empty"} />}>
          {shown.snapshot ? (
            <div className="overflow-x-auto">
              <div className="mx-auto min-w-[860px] max-w-[297mm] rounded border border-line bg-white p-8">
                <AssetSnapshot data={shown.snapshot} surface="workspace" />
              </div>
            </div>
          ) : (
            <div className="border border-dashed border-line px-4 py-4">
              <p className="text-sm text-ink-muted">No data recorded</p>
              <p className="mt-1 text-2xs text-ink-faint">
                This memo was composed before the Asset Snapshot existed. Recompose the draft, or create a new version, to compose it.
              </p>
            </div>
          )}
        </Section>
      ) : format === "japanese" ? (
        <JapaneseSummary
          opportunityId={opportunityId} memo={memo} live={shown} overrides={overrides} editable={editable}
        />
      ) : (
        sectionsFor(format).map((key) => {
          const composed = shown.sections[key];
          const resolved = resolveSection(composed, overrides[key], format);
          return (
            <Section key={key} title={SECTION_LABEL[key]} action={<StateTag state={resolved.state} />}>
              {resolved.flags.map((f) => (
                <p key={f} className="mb-3 border-l-2 border-caution pl-3 text-xs text-caution">{f}</p>
              ))}
              <SectionBody resolved={resolved} currency={shown.currency} format={format} surface="workspace" />
              {resolved.state === "composed" && resolved.withheld > 0 && (
                <Provenance>
                  {resolved.withheld} internal block{resolved.withheld === 1 ? "" : "s"} for this section appear{resolved.withheld === 1 ? "s" : ""} in the Internal IC Memo only.
                </Provenance>
              )}
              {resolved.state === "edited" && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-2xs text-ink-faint hover:text-ink">Show the composed version this text replaces</summary>
                  <div className="mt-3 opacity-80">
                    <SectionBody resolved={resolveSection(composed, null, format)} currency={shown.currency} format={format} surface="workspace" />
                  </div>
                </details>
              )}
              {editable && (
                <OverrideEditor
                  opportunityId={opportunityId} memoId={memo!.memoId} sectionKey={key}
                  initial={overrides[key] ?? ""}
                />
              )}
            </Section>
          );
        })
      )}

      {editable && (
        <Section eyebrow="Finalise" title="Lock this memo">
          <p className="mb-4 max-w-measure text-sm leading-relaxed text-ink-muted">
            Finalising is permanent. The memo keeps its own copy of every figure, so a later change to the underwriting
            will not alter it; to change it afterwards, create a new version.
          </p>
          <FinalizeForm
            opportunityId={opportunityId} memoId={memo!.memoId} formatLabel={fmt.label}
            empty={empties} unreviewed={unreviewed} notices={notices}
          />
        </Section>
      )}
    </div>
  );
}

function basisText(b: ComposedMemo["basis"]): string {
  if (b.kind === "none" || b.version == null) return "no underwriting version";
  return `underwriting v${b.version} (${b.kind === "approved" ? "approved" : "working version, not approved"})`;
}

function MemoStatus({ memo, basisText, stale }: { memo: StoredMemo | null; basisText: string; stale: boolean }) {
  if (!memo) {
    return (
      <Provenance>
        Composed just now from the records, based on {basisText}. Nothing is saved: start a memo to keep a draft and to write any section by hand.
      </Provenance>
    );
  }
  return (
    <div className="space-y-1">
      <Provenance>
        Composed {formatDate(memo.composedAt)} from {basisText}. Started by {memo.createdByName ?? "a colleague"}.
        {memo.status === "final" && memo.finalizedAt && ` Finalised ${formatDate(memo.finalizedAt)}${memo.finalizedByName ? ` by ${memo.finalizedByName}` : ""}. This version is permanent.`}
      </Provenance>
      {stale && (
        <p className="border-l-2 border-caution pl-3 text-xs text-caution" role="status">
          The records have changed since this draft was composed. Use Recompose to bring it up to date; the text you wrote is kept.
        </p>
      )}
    </div>
  );
}

function StateTag({ state }: { state: "edited" | "composed" | "empty" }) {
  const label = state === "edited" ? "Edited by hand" : state === "composed" ? "Composed from records" : "Empty";
  const tone = state === "edited" ? "bg-purple/10 text-purple" : state === "composed" ? "bg-surface-sunken text-ink-muted" : "border border-dashed border-line text-ink-faint";
  return <span className={cn("rounded px-1.5 py-0.5 text-2xs font-medium", tone)}>{label}</span>;
}

/**
 * The Japanese-language summary: one hand-written text, not a grid of sections.
 * There is NO machine translation. A wrong translation of an investment term is
 * a worse failure than no translation, so the English figures are shown beside
 * the box for the author to work from, and nothing is filled in.
 */
function JapaneseSummary({
  opportunityId, memo, live, overrides, editable,
}: {
  opportunityId: string;
  memo: StoredMemo | null;
  live: ComposedMemo;
  overrides: MemoOverrides;
  editable: boolean;
}) {
  const text = overrides[JAPANESE_KEY] ?? "";
  const metrics = resolveSection(live.sections.key_metrics, null, "teaser");
  return (
    <Section title="日本語の投資サマリー" action={<StateTag state={text ? "edited" : "empty"} />}>
      {text ? (
        <p lang="ja" className="memo-text max-w-measure whitespace-pre-line text-sm leading-relaxed text-ink">{text}</p>
      ) : (
        <div className="border border-dashed border-line px-4 py-4">
          <p className="text-sm text-ink-muted">No data recorded</p>
          <p className="mt-1 text-2xs text-ink-faint">
            No Japanese summary has been written. It is never translated automatically; write it in the box below.
          </p>
        </div>
      )}
      <div className="mt-6">
        <div className="mb-1.5 text-2xs font-medium uppercase tracking-label text-ink-faint">English figures to work from</div>
        <SectionBody resolved={metrics} currency={live.currency} format="teaser" surface="workspace" />
      </div>
      {editable && memo && (
        <OverrideEditor
          opportunityId={opportunityId} memoId={memo.memoId} sectionKey={JAPANESE_KEY} initial={text}
        />
      )}
      {!memo && (
        <Provenance>Start a memo to write the Japanese summary.</Provenance>
      )}
    </Section>
  );
}
