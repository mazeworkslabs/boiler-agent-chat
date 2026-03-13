import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ws", "express"],
  reactStrictMode: false,
};

export default nextConfig;
