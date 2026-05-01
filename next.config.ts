import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  outputFileTracingIncludes: {
    '/api/**': ['./wasm/**'],
  },
};

export default nextConfig;
