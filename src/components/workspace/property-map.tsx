"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/geo/maps-loader";
import type { MapState } from "@/lib/geo/map-state";

/**
 * One property, one pin. Rendered only inside the internal workspace, where the
 * full address is already on the page, so the pin discloses nothing new.
 *
 * The script is requested here, on mount, and nowhere else: a route without a
 * map never loads it.
 */
export function PropertyMap({ state, label, address }: {
  state: Extract<MapState, { kind: "map" }>; label: string; address: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(key)
      .then((maps) => {
        if (cancelled || !box.current) return;
        const center = { lat: state.lat, lng: state.lng };
        const map = new maps.Map(box.current, {
          center, zoom: 17, mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
        });
        new maps.Marker({ position: center, map, title: label });
      })
      .catch((e: Error) => { if (!cancelled) setFailed(e.message); });
    return () => { cancelled = true; };
  }, [key, state.lat, state.lng, label]);

  if (failed) {
    return <p role="alert" className="border-l-2 border-negative pl-3 text-xs text-negative">{failed} Check that the browser key allows this site.</p>;
  }
  return (
    <div>
      <div ref={box} role="img" aria-label={`Map showing ${label}`} className="h-72 w-full rounded border border-line bg-surface-sunken" />
      <p className="mt-2 text-2xs text-ink-faint">
        {address ? `${address} · ` : ""}
        <a className="underline-offset-2 hover:underline"
          href={`https://www.google.com/maps/search/?api=1&query=${state.lat},${state.lng}`}
          target="_blank" rel="noreferrer noopener">Open in Google Maps</a>
      </p>
    </div>
  );
}
