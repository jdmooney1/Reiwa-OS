"use client";

// The last resort: a failure in the root layout itself, where no other boundary
// is mounted. It replaces the whole document, so it carries its own <html> and
// <body> and cannot rely on the application's stylesheet having loaded.
//
// Same rule as every other boundary: the digest, never the message.

export default function GlobalError({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf9f7",
          color: "#1c1c1a",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          padding: "2rem",
        }}
      >
        <main style={{ maxWidth: "32rem" }}>
          <p style={{ margin: 0, fontSize: "0.6875rem", letterSpacing: "0.12em",
            textTransform: "uppercase", color: "#8a8378" }}>
            Reiwa Capital
          </p>
          <h1 style={{ margin: "0.5rem 0 0", fontSize: "1.375rem", fontWeight: 500 }}>
            This page could not be loaded
          </h1>
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.875rem", lineHeight: 1.7, color: "#57534e" }}>
            Something went wrong at our end. Please try again in a moment, or contact Reiwa Capital
            if it continues.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1.5rem", padding: "0.5rem 1rem", fontSize: "0.75rem", fontWeight: 600,
              color: "#faf9f7", background: "#1f2937", border: 0, borderRadius: "0.25rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ margin: "1.5rem 0 0", fontSize: "0.6875rem", color: "#8a8378" }}>
              Reference <span style={{ fontFamily: "ui-monospace, monospace" }}>{error.digest}</span>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
