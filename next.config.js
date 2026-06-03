/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};
module.exports = nextConfig;
