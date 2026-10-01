import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { listMemos } from "@/lib/data/memos";
import { resolveSection, sectionsFor, JAPANESE_KEY } from "@/lib/memo/compose";
import { FORMAT_BY_KEY, SECTION_LABEL, type OutputFormat } from "@/lib/memo/sections";
import { TARGETS_DISCLAIMER, isExternalFormat } from "@/lib/memo/render";
import { SectionBody } from "@/components/memo/memo-blocks";
import { PrintNowButton } from "@/components/memo/memo-controls";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

function parseFormat(raw: string | string[] | undefined): OutputFormat {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v in FORMAT_BY_KEY ? (v as OutputFormat) : "teaser";
}

/**
 * The memo as a document: what leaves the building.
 *
 * Built from the STORED memo, never from today's rows, so a printed version is
 * exactly what was saved. A draft prints with a DRAFT banner that cannot be
 * missed; only a final memo prints clean. There is no print for an unsaved
 * preview, because a document needs a version to refer to.
 */
export default async function MemoPrintPage({
  params, searchParams,
}: {
  params: { opportunityId: string };
  searchParams: { format?: string | string[]; v?: string };
}) {
  const auth = await requireAuth();
  const memos = await listMemos(toDbSession(auth), params.opportunityId);
  const wanted = searchParams.v ? Number(searchParams.v) : null;
  const memo = wanted ? memos.find((m) => m.version === wanted) : memos[0];
  const back = `/opportunities/${params.opportunityId}/memo`;

  if (!memo) {
    if (memos.length === 0 && wanted === null) {
      return (
        <div className="mx-auto max-w-xl px-6 py-16">
          <p className="text-sm text-ink-muted">No memo has been started for this opportunity, so there is nothing to print.</p>
          <Link href={back} className="mt-4 inline-block text-xs text-purple underline">Back to the memo tab</Link>
        </div>
      );
    }
    notFound();
  }

  const format = parseFormat(searchParams.format);
  const fmt = FORMAT_BY_KEY[format];
  const c = memo.content;
  const external = isExternalFormat(format);
  const isDraft = memo.status === "draft";
  const jp = memo.overrides[JAPANESE_KEY];

  return (
    <>
      <div className="print:hidden border-b border-line bg-surface px-6 py-3">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
          <Link href={`${back}?format=${format}`} className="text-xs text-ink-muted hover:text-ink">Back to the memo</Link>
          <div className="flex items-center gap-4">
            <span className="text-2xs text-ink-faint">Choose Save as PDF in the print dialog. Turn off headers and footers for a clean page.</span>
            <PrintNowButton />
          </div>
        </div>
      </div>

      <article className="memo-sheet mx-auto my-8 max-w-[210mm] bg-white px-[15mm] py-[14mm] text-ink shadow-sm print:my-0">
        {isDraft && (
          <div className="mb-6 border border-negative px-4 py-2 text-center text-xs font-semibold uppercase tracking-label text-negative">
            Draft, version {memo.version}. Not for distribution.
          </div>
        )}

        <header className="memo-block border-b border-line-strong pb-6">
          <div className="eyebrow">Reiwa Capital</div>
          <h1 className="mt-3 text-3xl leading-tight tracking-[-0.02em]">{c.assetName}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {fmt.label}
            <span className="px-2 text-line-strong">|</span>
            Version {memo.version}{memo.status === "final" && memo.finalizedAt ? `, finalised ${formatDate(memo.finalizedAt)}` : `, draft composed ${formatDate(memo.composedAt)}`}
          </p>
        </header>

        {format === "japanese" ? (
          <section className="memo-block mt-8">
            <h2 className="memo-heading text-2xs font-medium uppercase tracking-eyebrow">日本語の投資サマリー</h2>
            {jp ? (
              <p lang="ja" className="mt-3 whitespace-pre-line text-sm leading-relaxed">{jp}</p>
            ) : (
              <div className="mt-3 border border-dashed border-line px-4 py-4"><p className="text-sm text-ink-muted">No data recorded</p></div>
            )}
          </section>
        ) : (
          sectionsFor(format).map((key) => (
            <section key={key} className="mt-8">
              <h2 className="memo-heading section-rule text-2xs font-medium uppercase tracking-eyebrow">{SECTION_LABEL[key]}</h2>
              <div className="mt-3">
                <SectionBody
                  resolved={resolveSection(c.sections[key], memo.overrides[key], format)}
                  currency={c.currency} format={format} surface="print"
                />
              </div>
              {resolveSection(c.sections[key], memo.overrides[key], format).flags.map((f) => (
                <p key={f} className="mt-2 text-2xs text-ink-faint">{f}.</p>
              ))}
            </section>
          ))
        )}

        <footer className="memo-block mt-10 border-t border-line pt-4 text-2xs leading-relaxed text-ink-faint">
          {external ? (
            <>
              <p>{TARGETS_DISCLAIMER}</p>
              <p className="mt-1.5">Prepared by Reiwa Capital. Confidential.</p>
            </>
          ) : (
            <p>Internal document. Not for distribution outside Reiwa Capital.</p>
          )}
        </footer>
      </article>
    </>
  );
}
