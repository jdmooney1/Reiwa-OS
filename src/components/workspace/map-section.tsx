"use client";

import { useRef, useState, useTransition } from "react";
import { Upload, Trash2 } from "lucide-react";
import type { PropertyPhoto } from "@/lib/data/property-photos";
import { uploadPhotoAction, setPhotoVisibilityAction, deletePhotoAction } from "@/app/actions/photos";
import { PHOTO_ACCEPT, MAX_PHOTOS_PER_UPLOAD } from "@/lib/photos/constraints";
import { shrinkImage } from "@/lib/photos/client";
import { Section, Provenance, ActionError } from "@/components/workspace/primitives";
import { VisibilitySelect, IconButton } from "@/components/workspace/photos-section";
import { useFileDrop, dropZoneClass } from "@/lib/ui/use-file-drop";
import { cn } from "@/lib/utils";

/**
 * Map images - the same upload as a building photograph, as a second KIND of the
 * same row (migration 0028). A map is internal until a person clears it for
 * diligence investors, is never a headline, and never reaches an investor through
 * the portal; its only use today is the One-Page Asset Snapshot, which takes the
 * first one cleared. Delivery is the same staff-only route as a photograph.
 */
export function MapSection({
  opportunityId, propertyId, maps, canWrite,
}: {
  opportunityId: string;
  propertyId: string | null;
  maps: PropertyPhoto[];
  canWrite: boolean;
}) {
  const [error, setError] = useState<string | undefined>();
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const busy = pending || progress !== null;

  async function upload(files: File[]) {
    setError(undefined);
    if (files.length === 0) return;
    if (files.length > MAX_PHOTOS_PER_UPLOAD) { setError(`Choose at most ${MAX_PHOTOS_PER_UPLOAD} images at a time.`); return; }
    const failures: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setProgress(files.length > 1 ? `Uploading ${i + 1} of ${files.length}` : "Uploading");
      try {
        const fd = new FormData();
        fd.set("file", await shrinkImage(files[i]));
        fd.set("kind", "map");
        const res = await uploadPhotoAction(opportunityId, fd);
        if (res.error) failures.push(`${files[i].name}: ${res.error}`);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : `${files[i].name}: upload failed.`);
      }
    }
    setProgress(null);
    if (failures.length) setError(failures.join(" "));
  }

  const drop = useFileDrop((files) => {
    if (busy) { setError("Wait for the current upload to finish."); return; }
    void upload(files);
  }, { disabled: !canWrite });

  function run(fn: () => Promise<{ error?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
    });
  }

  if (!propertyId) return null;

  return (
    <Section
      eyebrow="Asset"
      title={`Map (${maps.length})`}
      action={canWrite && (
        <>
          <input
            ref={input} type="file" accept={PHOTO_ACCEPT} multiple hidden
            onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void upload(f); }}
          />
          <button
            type="button" disabled={busy} onClick={() => input.current?.click()}
            className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-line-strong disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" /> Add a map
          </button>
        </>
      )}
    >
      <p className="mb-4 text-2xs text-ink-faint">
        A map image, uploaded like a photograph. It is internal until you clear it for diligence investors, and
        the Asset Snapshot uses the first one that has been cleared. It is never shown in the Investment Portal.
      </p>
      <div {...(canWrite ? drop.bind : {})} className={cn("rounded-lg", canWrite && ["p-3", dropZoneClass(drop.over)])}>
        {maps.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-faint">
            {canWrite ? "Drag a map image here, or click Add a map" : "No map has been added to this property."}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {maps.map((m, i) => (
              <li key={m.photoId} className="overflow-hidden rounded-lg border border-line bg-surface-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/asset-photos/${m.photoId}?variant=thumb`} alt={`Map ${i + 1}`}
                  loading="lazy" className="aspect-[4/3] w-full object-cover"
                />
                {canWrite && (
                  <div className="flex items-center justify-between gap-2 p-2">
                    <VisibilitySelect
                      value={m.visibility} disabled={busy}
                      onChange={(v) => run(() => setPhotoVisibilityAction(opportunityId, m.photoId, v))}
                    />
                    <IconButton label="Delete map" disabled={busy}
                      onClick={() => {
                        if (window.confirm("Delete this map? The file is removed as well.")) {
                          run(() => deletePhotoAction(opportunityId, m.photoId));
                        }
                      }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {progress && <p className="mt-3 text-xs text-ink-muted" role="status">{progress}...</p>}
      <div className="mt-3"><ActionError message={error} /></div>
      {maps.length === 0 && !canWrite && <Provenance>No map has been added to this property.</Provenance>}
    </Section>
  );
}
