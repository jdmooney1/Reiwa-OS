// ============================================================================
// Load the Google Maps JavaScript API, once, on demand.
// ----------------------------------------------------------------------------
// NOT imported by any layout or shared module. The script tag is created only
// when a component that draws a map calls loadGoogleMaps(), so a page with no
// map pays nothing and the API is never in the global bundle. Repeated calls
// share one load; a failed load can be retried.
//
// CLIENT-ONLY, and the only key it ever sees is the browser key, which is
// public by design and protected by its HTTP-referrer restriction in Google
// Cloud. The server key has no referrer restriction and must never reach here.
// ============================================================================

// Deliberately loose: pulling in the full google.maps typings is a dependency
// for the sake of two calls.
declare global {
  interface Window {
    google?: any;
    __reiwaMapsReady?: () => void;
  }
}

let pending: Promise<any> | null = null;

export function loadGoogleMaps(browserKey: string): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("Maps can only load in the browser."));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (pending) return pending;

  pending = new Promise((resolve, reject) => {
    window.__reiwaMapsReady = () => resolve(window.google.maps);
    const script = document.createElement("script");
    script.src = "https://maps.googleapis.com/maps/api/js?" + new URLSearchParams({
      key: browserKey, v: "weekly", loading: "async", callback: "__reiwaMapsReady",
    }).toString();
    script.async = true;
    script.onerror = () => {
      pending = null; // let a later mount try again
      script.remove();
      reject(new Error("The Google Maps script could not be loaded."));
    };
    document.head.appendChild(script);
  });
  return pending;
}
