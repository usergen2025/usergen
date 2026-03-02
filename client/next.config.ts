import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Note: experimental.turbo is not a valid option in Next.js 16.0.1
  // The workspace warning can be safely ignored - it won't affect the build
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3002',
        pathname: '/uploads/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3003',
        pathname: '/uploads/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
