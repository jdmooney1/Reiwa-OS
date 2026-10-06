import { ReiwaLockup } from "@/components/brand/reiwa-lockup";
import { AssetSnapshot } from "@/components/memo/asset-snapshot";
import { SectionBody } from "@/components/memo/memo-blocks";
import { TARGETS_DISCLAIMER } from "@/lib/memo/render";
import { PROSPECT_DISCLAIMER } from "@/lib/deal-share/policy";
import type { ProspectDocument as Doc } from "@/lib/deal-share/document";
import { formatDate } from "@/lib/format";

// ============================================================================
// What a prospect sees: the two frozen documents, a disclaimer, and nothing else.
// ----------------------------------------------------------------------------
// No navigation, no account, no link to any other page, no control that changes
// anything. It draws the cut-down document from src/lib/deal-share/document.ts, never a
// stored memo, with the same renderers staff print from (AssetSnapshot, SectionBody) on
// their print surface, so what a prospect reads is what staff approved.
//
// The disclaimer is ON SCREEN, above the documents and again below them: this is the one
// reader with no other relationship with Reiwa to put what they are looking at in context.
// ============================================================================

function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={className} data-block="disclaimer">{PROSPECT_DISCLAIMER}</p>
  );
}

export function ProspectDocument({ view, token }: { view: Doc & { prospectName: string }; token: string }) {
  const { snapshot, teaser } = view;
  return (
    <main className="mx-auto max-w-[297mm] px-4 py-8 sm:px-6" data-surface="prospect">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <ReiwaLockup size="header" />
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">Prepared for {view.prospectName}. Confidential.</p>
      </header>

      <Disclaimer className="mt-6 rounded border border-line bg-surface-card px-4 py-3 text-xs leading-relaxed text-ink-muted" />

      {snapshot && (
        <section className="mt-8" data-document="snapshot" aria-label="Asset Snapshot">
          <div className="overflow-x-auto">
            <article className="min-w-[760px] bg-white px-[8mm] py-[8mm] shadow-sm">
              <AssetSnapshot
                data={snapshot.data} surface="print"
                imageUrl={(slot) => `/deal/${token}/image/${slot}`}
              />
            </article>
          </div>
        </section>
      )}

      {teaser && (
        <section className="mt-10" data-document="teaser" aria-label="Investor Teaser">
          <article className="bg-white px-6 py-8 text-ink shadow-sm sm:px-[15mm]">
            <div className="border-b border-line-strong pb-6">
              <div className="eyebrow">Reiwa Capital</div>
              <h1 className="mt-3 text-3xl leading-tight tracking-[-0.02em]">{teaser.assetName}</h1>
              <p className="mt-2 text-sm text-ink-muted">
                Investor Teaser{teaser.finalizedAt ? `, finalised ${formatDate(teaser.finalizedAt)}` : ""}
              </p>
            </div>
            {teaser.sections.map((s) => (
              <section key={s.key} className="mt-8">
                <h2 className="section-rule text-2xs font-medium uppercase tracking-eyebrow">{s.label}</h2>
                <div className="mt-3">
                  <SectionBody resolved={s.resolved} currency={teaser.currency} format="teaser" surface="print" />
                </div>
                {s.resolved.flags.map((f) => (
                  <p key={f} className="mt-2 text-2xs text-ink-faint">{f}.</p>
                ))}
              </section>
            ))}
            <p className="mt-10 border-t border-line pt-4 text-2xs leading-relaxed text-ink-faint">{TARGETS_DISCLAIMER}</p>
          </article>
        </section>
      )}

      <footer className="mt-8 border-t border-line pt-4">
        <Disclaimer className="text-2xs leading-relaxed text-ink-faint" />
        <p className="mt-1.5 text-2xs text-ink-faint">Prepared by Reiwa Capital. Confidential.</p>
      </footer>
    </main>
  );
}
