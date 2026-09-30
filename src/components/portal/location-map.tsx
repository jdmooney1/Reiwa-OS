"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/geo/maps-loader";

/**
 * One pin, for an investor whose entitlement is at the diligence tier. The page
 * only renders this when the database returned coordinates, which it does for no
 * one else; this component holds no rule of its own.
 *
 * The script is requested here, on mount, so no other portal page loads it. It is
 * asked for with referrerPolicy "origin" because the portal sends no referrer and
 * the browser key is referrer-restricted (see maps-loader.ts).
 */
export function LocationMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!key) { setFailed(true); return; }
    loadGoogleMaps(key, { referrerPolicy: "origin" })
      .then((maps) => {
        if (cancelled || !box.current) return;
        const center = { lat, lng };
        const map = new maps.Map(box.current, {
          center, zoom: 16, mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
        });
        new maps.Marker({ position: center, map, title: label });
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [key, lat, lng, label]);

  // Nothing about the location is said when the map cannot load: an investor sees
  // the page as it always was, not an error about a feature they did not ask for.
  if (failed) return null;
  return (
    <div ref={box} role="img" aria-label={`Map showing the location of ${label}`}
      className="mt-6 h-80 w-full rounded border border-line bg-surface-sunken" />
  );
}
