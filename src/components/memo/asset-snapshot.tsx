import type { ComposedSnapshot } from "@/lib/memo/compose";
import { ReiwaLockup } from "@/components/brand/reiwa-lockup";
import { formatMoneyUnits, formatDate, currencySymbol } from "@/lib/format";
import type { Currency } from "@/types/database";
import { snapshotImageUrl } from "@/lib/memo/snapshot-images";
import { METHOD_LABEL } from "@/lib/underwriting/allocation";
import { cn } from "@/lib/utils";

// ============================================================================
// The One-Page Asset Snapshot: Reiwa Capital's bilingual (EN/JA) data sheet.
// ----------------------------------------------------------------------------
// One component for the workspace and the print view, so what an author checks is
// what a reader receives. It draws ComposedSnapshot and nothing else: no figure is
// computed here, and no sentence about the asset is written here. Every word on
// the page is a label this file owns, a recorded value, or the template's own
// disclaimer.
//
// THE RULE FOR A GAP. The template has a place for things the record does not hold
// (WAULT, build year, tenure, a map, and so on). On a PRINTED copy a missing figure
// is simply not claimed: its cell is dropped and the grid closes up. In the
// workspace the same cell shows "Not yet captured", so an author can see what is
// missing before sending. Neither surface ever shows placeholder text in brackets
// or "TBC": a template's placeholder must not reach an investor copy
// (tests/unit/asset-snapshot.test.ts).
// ============================================================================

type Surface = "workspace" | "print";

const pctShort = (n: number) => (Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`);
const int = (n: number) => Math.round(n).toLocaleString("en-GB");
const asCurrency = (c: string) => c as Currency;

/** Cell content, or null when the record has nothing to put in it. */
function Cell({
  en, ja, value, surface, className, valueClassName,
}: {
  en: string; ja: string; value: React.ReactNode | null; surface: Surface; className?: string; valueClassName?: string;
}) {
  if (value === null && surface === "print") return null;
  return (
    <div className={cn("min-w-0 px-4 py-3", className)} data-cell={en}>
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">{en}</div>
      <div className="text-[9px] text-ink-faint" lang="ja">{ja}</div>
      {value === null ? (
        <div className="mt-1.5 text-[11px] text-ink-faint">Not yet captured</div>
      ) : (
        <div className={cn("mt-1 text-[22px] leading-tight tracking-[-0.01em] text-ink", valueClassName)}>{value}</div>
      )}
    </div>
  );
}

export function AssetSnapshot({
  data, surface, memoId = null,
}: {
  data: ComposedSnapshot; surface: Surface;
  /** The stored memo this is drawn from. A FROZEN picture is fetched through it. */
  memoId?: string | null;
}) {
  const photoUrl = snapshotImageUrl(data.photo, memoId, "photo");
  const mapUrl = snapshotImageUrl(data.map, memoId, "map");
  const cur = asCurrency(data.currency);
  const money = (n: number | null) => (n === null ? null : formatMoneyUnits(n, cur));
  const place = [data.city, data.country].filter(Boolean).join(", ");
  const jpy = data.priceJpy === null ? null : formatMoneyUnits(data.priceJpy, "JPY");
  const showGaps = surface === "workspace";

  const row1 = [
    { en: "PRICE GUIDANCE", ja: "想定価格", v: money(data.price) },
    { en: "JPY EQUIVALENT", ja: "円換算", v: jpy },
    { en: "NIY", ja: "純初期利回り", v: data.niyPct === null ? null : `${data.niyPct.toFixed(2)}%` },
    { en: "PASSING RENT", ja: "現行賃料", v: money(data.passingRent) },
  ];
  const row2 = [
    { en: "ERV", ja: "想定賃料", v: money(data.erv) },
    { en: "OCCUPANCY", ja: "稼働率", v: data.occupancyPct === null ? null : pctShort(data.occupancyPct) },
    { en: "CAPEX", ja: "資本的支出", v: money(data.capex) },
  ];

  return (
    <div className="asset-snapshot text-ink" data-surface={surface}>
      <header className="flex items-start justify-between">
        <div>
          <ReiwaLockup size="header" />
          <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.3em] text-ink-muted">Asset Snapshot</div>
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
          {data.ref ? `Ref ${data.ref} · ` : ""}Prepared {formatDate(data.preparedOn)}
        </div>
      </header>
      <hr className="mt-3 border-0 border-t border-line-strong" />

      <div className="mt-4">
        <h1 className="inline-block border-b-2 border-[#EBC4DA] pb-1 text-[34px] leading-none tracking-[-0.02em]">{data.name}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-muted">
          {place && <span>{place}</span>}
          {data.submarket && <><span className="text-line-strong">·</span><span>{data.submarket}</span></>}
          <span className="text-line-strong">·</span>
          <span className="rounded bg-purple px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-surface">{data.assetType}</span>
        </p>
      </div>

      <div className="mt-4 grid gap-6 [grid-template-columns:minmax(0,5fr)_minmax(0,6fr)]">
        {/* Left: photograph, map, address (the template's order). */}
        <div className="space-y-3">
          {(photoUrl || showGaps) && (
            <Picture url={photoUrl} label="Asset" ja="物件" alt={data.name} block="photo" height={205} />
          )}
          {(mapUrl || showGaps) && (
            <Picture url={mapUrl} label="Map" ja="地図" alt={`Map of ${data.name}`} block="map" height={150} />
          )}
          {data.addressLine ? (
            <div className="rounded border border-line px-4 py-3" data-block="address">
              <div className="flex items-baseline justify-between gap-4">
                <div className="text-[12px] text-ink">Address <span className="ml-1 text-[9px] text-ink-faint" lang="ja">所在地</span></div>
                <div className="text-right text-[12px] font-medium text-ink">{data.addressLine}</div>
              </div>
            </div>
          ) : showGaps && (
            <div className="rounded border border-dashed border-line px-4 py-3 text-[11px] text-ink-faint" data-block="address">
              Address <span lang="ja">所在地</span>: not yet captured
            </div>
          )}
        </div>

        {/* Right: the figures. */}
        <div className="min-w-0">
          <div className="border-t-2 border-ink">
            <div className="grid divide-x divide-line [grid-template-columns:repeat(auto-fit,minmax(0,1fr))]" data-row="headline">
              {row1.map((c) => <Cell key={c.en} en={c.en} ja={c.ja} value={c.v} surface={surface} />)}
              {(data.area || surface === "workspace") && (
                data.area ? (
                  <div className="min-w-0 px-4 py-3" data-cell="TOTAL AREA">
                    <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">TOTAL AREA</div>
                    <div className="text-[9px] text-ink-faint" lang="ja">総面積</div>
                    <div className="mt-1.5 flex gap-3">
                      {([["sqft", "SQ FT", data.area.sqft], ["sqm", "SQM", data.area.sqm], ["tsubo", "TSUBO", data.area.tsubo]] as const).map(([k, label, n]) => (
                        <div key={k}>
                          <div className="text-[13px] font-semibold tabular-nums text-ink">{n === null ? "" : int(n)}</div>
                          <div className="font-mono text-[8px] uppercase tracking-[0.1em] text-ink-faint">{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Cell en="TOTAL AREA" ja="総面積" value={null} surface={surface} />
                )
              )}
            </div>
          </div>

          <div className="mt-3 grid divide-x divide-line border border-line [grid-template-columns:repeat(auto-fit,minmax(0,1fr))]" data-row="secondary">
            {row2.map((c) => <Cell key={c.en} en={c.en} ja={c.ja} value={c.v} surface={surface} valueClassName="text-[18px]" />)}
          </div>

          {(data.allocation ?? null) && <Allocation data={data} />}

          {data.fx && <FxLine data={data} />}
          {!data.fx && data.basisLabel && (
            <p className="mt-3 text-right font-mono text-[9px] text-ink-faint" data-line="source">
              Figures as at {formatDate(data.preparedOn)} · Source: {data.basisLabel}
            </p>
          )}

          {showGaps && data.gaps.length > 0 && (
            <div className="mt-5 rounded border border-dashed border-line px-4 py-3" data-block="gaps">
              <div className="text-2xs font-medium uppercase tracking-label text-ink-faint">Not yet captured</div>
              <p className="mt-1 text-2xs text-ink-faint">These appear on the template but the record holds nothing for them, so a printed copy leaves them out.</p>
              <ul className="mt-2 space-y-1">
                {data.gaps.map((g) => (
                  <li key={g.key} className="text-2xs text-ink-muted"><span className="font-medium text-ink">{g.label}.</span> {g.why}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <footer className="mt-4 flex items-end justify-between gap-6 border-t border-line pt-3">
        <p className="max-w-[60%] text-[8.5px] leading-snug text-ink-faint">
          This document is for preliminary discussion purposes only. Figures are based on information available at the time of
          preparation and remain subject to verification, due diligence, tax advice and legal review. Reiwa Capital does not
          provide tax or legal advice.
        </p>
        <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
          <span className="font-semibold text-ink">Reiwa Capital</span> · Confidential · {formatDate(data.preparedOn)}{data.ref ? ` · ${data.ref}` : ""}
        </p>
      </footer>
    </div>
  );
}

/** A picture slot: the image when there is one, a dashed "not yet captured" box in the workspace when not. */
function Picture({
  url, label, ja, alt, block, height,
}: { url: string | null; label: string; ja: string; alt: string; block: string; height: number }) {
  return (
    <div
      className={cn("relative overflow-hidden rounded border", url ? "border-line bg-surface-sunken" : "border-dashed border-line bg-surface-sunken")}
      style={{ height }} data-block={block}
    >
      <span className="absolute left-2 top-2 z-10 rounded bg-purple px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-surface">
        {label} <span lang="ja">{ja}</span>
      </span>
      {url ? (
        // A plain <img>: the routes answer with a short-lived redirect, which the
        // optimiser would try to cache and which a printed page must not rewrite.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-ink-faint">Not yet captured</div>
      )}
    </div>
  );
}

/** Value allocation: land, building and the straight-line charge, all derived on read. */
function Allocation({ data }: { data: ComposedSnapshot }) {
  const a = data.allocation!;
  const cur = asCurrency(data.currency);
  const yen = (n: number | null) => (n === null ? null : formatMoneyUnits(n, "JPY"));
  const cell = "min-w-0 px-4 py-3";
  const label = "font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted";
  return (
    <div className="mt-4" data-block="allocation">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">Value allocation <span lang="ja" className="ml-1 normal-case tracking-normal">価格内訳</span></span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="mt-2 grid divide-x divide-line border border-line [grid-template-columns:repeat(auto-fit,minmax(0,1fr))]">
        <div className={cell} data-cell="LAND VALUE">
          <div className={label}>Land value</div>
          <div className="text-[9px] text-ink-faint" lang="ja">土地価格</div>
          <div className="mt-1 text-[18px] leading-tight text-ink">
            {formatMoneyUnits(a.land, cur)} <span className="text-[11px] text-ink-muted">{pctShort(Math.round(a.landPct))}</span>
          </div>
          {a.landJpy !== null && <div className="mt-0.5 font-mono text-[9px] text-ink-faint">{yen(a.landJpy)}</div>}
        </div>
        <div className={cn(cell, "bg-surface-sunken")} data-cell="BUILDING VALUE">
          <div className={label}>Building value</div>
          <div className="text-[9px] text-ink-faint" lang="ja">建物価格</div>
          <div className="mt-1 text-[18px] leading-tight text-ink">
            {formatMoneyUnits(a.building, cur)} <span className="text-[11px] text-ink-muted">{pctShort(Math.round(a.buildingPct))}</span>
          </div>
          <div className="mt-0.5 font-mono text-[9px] text-ink-faint">{a.buildingJpy !== null ? `${yen(a.buildingJpy)} · ` : ""}depreciable base</div>
        </div>
        {a.depreciation && (
          <div className={cell} data-cell="DEPRECIATION BASIS">
            <div className={label}>Depreciation basis</div>
            <div className="text-[9px] text-ink-faint" lang="ja">減価償却基準</div>
            <div className="mt-1 text-[18px] leading-tight text-ink">
              {a.depreciation.years} yrs <span className="text-[11px] text-ink-muted">{METHOD_LABEL[a.depreciation.method]}</span>
            </div>
            <div className="mt-0.5 font-mono text-[9px] text-ink-faint">
              ≈ {a.depreciation.annualJpy !== null ? yen(a.depreciation.annualJpy) : formatMoneyUnits(a.depreciation.annual, cur)} / yr · est.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The one line that says which exchange rates the yen figures use, and how old they are. */
function FxLine({ data }: { data: ComposedSnapshot }) {
  const fx = data.fx!;
  const cur = asCurrency(data.currency);
  return (
    <p className="mt-3 text-right font-mono text-[9px] leading-snug text-ink-faint" data-line="fx">
      Figures as at {formatDate(data.preparedOn)}
      {fx.dealRateToGbp !== null && fx.dealAsOf && <> · {currencySymbol(cur)}1.00 = £{fx.dealRateToGbp.toFixed(4)} ({fx.dealSource}, {formatDate(fx.dealAsOf)})</>}
      {" "}· FX ¥{fx.jpyPerGbp.toFixed(1)} / £1.00 ({fx.jpySource}, {formatDate(fx.jpyAsOf)})
      {data.basisLabel && <> · Source: {data.basisLabel}</>}
      {fx.staleNote && <> · <span className="font-semibold text-caution" data-flag="fx-stale">{fx.staleNote}</span></>}
    </p>
  );
}
