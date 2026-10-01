import type { PortalPhoto } from "@/lib/portal/photos";
import { visiblePhotos } from "@/lib/portal/photos";

/**
 * The photographs of one opportunity, for an investor whose entitlement is at the
 * diligence tier. The page passes the database's answer, and it is filtered a
 * second time through visiblePhotos() here, so this component renders nothing
 * for any other tier even if it were handed photographs by mistake.
 *
 * Images are requested by id from /portal/photos/<id>, which the database
 * authorises on every request and answers with a 60 second signed URL. The page
 * never holds a storage path. The first photograph is shown large; the rest are
 * thumbnails that open the full image in a new tab, with no referrer.
 */
export function PhotoGallery({
  photos, tier, title,
}: {
  photos: PortalPhoto[];
  tier: string;
  title: string;
}) {
  const shown = visiblePhotos({ documentAccessLevel: tier, photos });
  if (shown.length === 0) return null;
  const [first, ...rest] = shown;
  const alt = (p: PortalPhoto, i: number) => p.caption ?? `Photograph ${i + 1} of ${title}`;

  return (
    <div>
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/portal/photos/${first.photoId}`} alt={alt(first, 0)}
          className="aspect-[16/9] w-full rounded border border-line object-cover"
        />
        {first.caption && <figcaption className="mt-2 text-2xs text-ink-faint">{first.caption}</figcaption>}
      </figure>
      {rest.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {rest.map((p, i) => (
            <li key={p.photoId}>
              <a href={`/portal/photos/${p.photoId}`} target="_blank" rel="noreferrer noopener">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/portal/photos/${p.photoId}?variant=thumb`} alt={alt(p, i + 1)} loading="lazy"
                  className="aspect-[4/3] w-full rounded border border-line object-cover"
                />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
