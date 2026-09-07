/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // node-postgres opens raw TCP/TLS sockets; keep it out of the server bundle so
  // it is required at runtime.
  experimental: {
    serverComponentsExternalPackages: ["pg"],
  },
  async headers() {
    return [
      {
        // The whole application: never disclose a path to another origin, and
        // never let a response be sniffed into a different content type.
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // The two flows that handle credentials — the invitation hand-off and
        // everything behind the investor session. These pages link out to a
        // signed storage URL and are reached from an emailed link, so they send
        // no referrer at all: not the origin, not the path, nothing.
        source: "/(access|portal)/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/(access|portal)",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
