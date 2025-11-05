import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbo: {
      root: process.cwd(), // Explicitly set the root to prevent workspace confusion
    },
  },
};

export default nextConfig;
