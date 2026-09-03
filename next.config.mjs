/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // node-postgres opens raw TCP/TLS sockets; keep it out of the server bundle so
  // it is required at runtime.
  experimental: {
    serverComponentsExternalPackages: ["pg"],
  },
};

export default nextConfig;
