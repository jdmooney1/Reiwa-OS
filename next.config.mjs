/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // node-postgres opens raw TCP/TLS sockets; keep it out of the server bundle so
  // it is required at runtime.
  experimental: {
    serverComponentsExternalPackages: ["pg", "sharp"],
    // Next's default for a server action's request body is 1 MB. A photograph
    // is shrunk in the browser to about 3.5 MB at most before it is sent
    // (lib/photos/client.ts), and the hosting platform caps a request near
    // 4.5 MB, so this is set just above that: it lifts the framework's own
    // limit without pretending the platform's does not exist.
    serverActions: { bodySizeLimit: "5mb" },
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
