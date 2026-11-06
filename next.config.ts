import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    cpus: 2
    ,
  },
  devIndicators: false
};

export default nextConfig;
