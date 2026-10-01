import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  reactStrictMode: true,
  // The dev-mode Next.js badge sits exactly where the console's account row
  // is; the dashboard is only ever served by `next dev` from the CLI.
  devIndicators: false
};

export default nextConfig;
