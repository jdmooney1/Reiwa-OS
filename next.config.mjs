/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // node-postgres is a Node-native driver; keep it external to the bundle.
  experimental: {
    serverComponentsExternalPackages: ["pg"],
  },
};

export default nextConfig;
