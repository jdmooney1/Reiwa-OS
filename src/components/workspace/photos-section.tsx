"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Upload, Trash2, ArrowLeft, ArrowRight, Star } from "lucide-react";
import type { PropertyPhoto } from "@/lib/data/property-photos";
import {
  uploadPhotoAction, makeHeadlinePhotoAction, setPhotoVisibilityAction,
  reorderPhotosAction, deletePhotoAction,
} from "@/app/actions/photos";
import {
  PHOTO_ACCEPT, MAX_PHOTOS_PER_UPLOAD, PHOTO_VISIBILITIES, type PhotoVisibility,
} from "@/lib/photos/constraints";
import { moveItem, shrinkImage } from "@/lib/photos/client";
import { Section, Empty, Provenance, ActionError } from "@/components/workspace/primitives";
import { cn } from "@/lib/utils";

const VISIBILITY_LABEL: Record<PhotoVisibility, string> = {
  internal: "Internal only",
  diligence: "Diligence investors",
};

/**
 * Asset photographs - Phase 1, staff only.
 *
 * One headline slot, shown large, and a gallery below it. Every upload is
 * INTERNAL. The visibility control records an intended audience and nothing
 * more: no investor-facing screen reads photographs yet, and the section says
 * so rather than letting "Standard investors" imply otherwise.
 *
 * Photographs are shown through /api/asset-photos/<id>, which re-checks the
 * session on every request. The browser never holds a storage path.
 */
export function PhotosSection({
  opportunityId, propertyId, photos, canWrite,
}: {
  opportunityId: string;
  propertyId: string | null;
  photos: PropertyPhoto[];
  canWrite: boolean;
}) {
  const headline = photos.find((p) => p.isHeadline) ?? null;
  const gallery = photos.filter((p) => !p.isHeadline);

  const [error, setError] = useState<string | undefined>();
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The gallery order as the person is arranging it, until the server confirms.
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const headlineInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  // A fresh list from the server is the truth: drop the optimistic order, which
  // would otherwise leave a newly demoted headline stranded at the end.
  useEffect(() => { setOrder(null); }, [photos]);

  if (!propertyId) {
    return (
      <Section eyebrow="Asset" title="Photos">
        <Empty
          title="This opportunity is not linked to a property."
          hint="Photographs belong to the property, so they cannot be added until it is."
        />
      </Section>
    );
  }

  const shown = order
    ? order.map((id) => gallery.find((p) => p.photoId === id)).filter((p): p is PropertyPhoto => !!p)
        .concat(gallery.filter((p) => !order.includes(p.photoId)))
    : gallery;

  async function upload(files: File[], asHeadline: boolean) {
    setError(undefined);
    if (files.length === 0) return;
    if (asHeadline && files.length > 1) { setError("The headline slot takes one photograph."); return; }
    if (files.length > MAX_PHOTOS_PER_UPLOAD) {
      setError(`Choose at most ${MAX_PHOTOS_PER_UPLOAD} photographs at a time.`);
      return;
    }
    const failures: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setProgress(files.length > 1 ? `Uploading ${i + 1} of ${files.length}` : "Uploading");
      try {
        const small = await shrinkImage(files[i]);
        const fd = new FormData();
        fd.set("file", small);
        if (asHeadline) fd.set("headline", "1");
        const res = await uploadPhotoAction(opportunityId, fd);
        if (res.error) failures.push(`${files[i].name}: ${res.error}`);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : `${files[i].name}: upload failed.`);
      }
    }
    setProgress(null);
    if (failures.length) setError(failures.join(" "));
  }

  function run(fn: () => Promise<{ error?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
    });
  }

  function reorder(next: string[]) {
    setOrder(next);
    startTransition(async () => {
      const res = await reorderPhotosAction(opportunityId, next);
      if (res.error) { setError(res.error); setOrder(null); }
    });
  }

  function drop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = shown.map((p) => p.photoId);
    reorder(moveItem(ids, ids.indexOf(dragId), ids.indexOf(targetId)));
    setDragId(null);
  }

  const busy = pending || progress !== null;

  return (
    <Section
      eyebrow="Asset"
      title={`Photos (${photos.length})`}
      action={canWrite && (
        <div className="flex items-center gap-2">
          <input
            ref={galleryInput} type="file" accept={PHOTO_ACCEPT} multiple hidden
            onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void upload(f, false); }}
          />
          <button
            type="button" disabled={busy} onClick={() => galleryInput.current?.click()}
            className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-line-strong disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" /> Add to gallery
          </button>
        </div>
      )}
    >
      <p className="mb-4 text-2xs text-ink-faint">
        Every photograph is internal when uploaded. Investors cannot see any photograph yet: the
        visibility setting only records who it is intended for.
      </p>

      <div className="relative overflow-hidden rounded-lg border border-line bg-surface-sunken">
        {headline ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/asset-photos/${headline.photoId}`} alt="Headline photograph"
            className="aspect-[16/9] w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[16/9] w-full items-center justify-center text-xs text-ink-faint">
            No headline photograph
          </div>
        )}
        {canWrite && (
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            {headline && (
              <VisibilitySelect
                value={headline.visibility} disabled={busy}
                onChange={(v) => run(() => setPhotoVisibilityAction(opportunityId, headline.photoId, v))}
              />
            )}
            <input
              ref={headlineInput} type="file" accept={PHOTO_ACCEPT} hidden
              onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void upload(f, true); }}
            />
            <button
              type="button" disabled={busy} onClick={() => headlineInput.current?.click()}
              className="rounded bg-purple px-3 py-1.5 text-xs font-semibold text-surface hover:bg-purple-70 disabled:opacity-50"
            >
              {headline ? "Replace headline" : "Upload headline"}
            </button>
          </div>
        )}
      </div>

      {shown.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((p, i) => (
            <li
              key={p.photoId}
              draggable={canWrite}
              onDragStart={() => setDragId(p.photoId)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => { if (canWrite && dragId) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); drop(p.photoId); }}
              className={cn(
                "overflow-hidden rounded-lg border border-line bg-surface-card",
                canWrite && "cursor-grab active:cursor-grabbing",
                dragId === p.photoId && "opacity-50",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/asset-photos/${p.photoId}?variant=thumb`} alt={`Gallery photograph ${i + 1}`}
                loading="lazy" draggable={false}
                className="aspect-[4/3] w-full object-cover"
              />
              {canWrite && (
                <div className="space-y-1.5 p-2">
                  <VisibilitySelect
                    value={p.visibility} disabled={busy} full
                    onChange={(v) => run(() => setPhotoVisibilityAction(opportunityId, p.photoId, v))}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <IconButton label="Move earlier" disabled={busy || i === 0}
                        onClick={() => { const ids = shown.map((x) => x.photoId); reorder(moveItem(ids, i, i - 1)); }}>
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton label="Move later" disabled={busy || i === shown.length - 1}
                        onClick={() => { const ids = shown.map((x) => x.photoId); reorder(moveItem(ids, i, i + 1)); }}>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton label="Make headline" disabled={busy}
                        onClick={() => run(() => makeHeadlinePhotoAction(opportunityId, p.photoId))}>
                        <Star className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton label="Delete photograph" disabled={busy}
                        onClick={() => {
                          if (window.confirm("Delete this photograph? The file is removed as well.")) {
                            run(() => deletePhotoAction(opportunityId, p.photoId));
                          }
                        }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && headline && (
        <div className="mt-3">
          <button
            type="button" disabled={busy}
            onClick={() => {
              if (window.confirm("Delete the headline photograph? The file is removed as well.")) {
                run(() => deletePhotoAction(opportunityId, headline.photoId));
              }
            }}
            className="text-2xs text-ink-faint underline-offset-2 hover:text-negative hover:underline disabled:opacity-50"
          >
            Delete headline photograph
          </button>
        </div>
      )}

      {progress && <p className="mt-3 text-xs text-ink-muted" role="status">{progress}...</p>}
      <div className="mt-3"><ActionError message={error} /></div>
      {photos.length === 0 && !canWrite && (
        <Provenance>No photographs have been added to this property.</Provenance>
      )}
    </Section>
  );
}

function VisibilitySelect({
  value, onChange, disabled, full,
}: { value: PhotoVisibility; onChange: (v: PhotoVisibility) => void; disabled?: boolean; full?: boolean }) {
  return (
    <select
      aria-label="Photograph visibility" value={value} disabled={disabled}
      onChange={(e) => onChange(e.target.value as PhotoVisibility)}
      className={cn(
        "rounded border border-line bg-surface-card px-2 py-1 text-2xs text-ink focus:border-line-strong focus:outline-none",
        full && "w-full",
      )}
    >
      {PHOTO_VISIBILITIES.map((v) => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
    </select>
  );
}

function IconButton({
  label, onClick, disabled, children,
}: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="rounded p-1 text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}
