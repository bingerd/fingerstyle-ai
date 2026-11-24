import type { NextConfig } from "next";

/**
 * SHOWCASE=1 builds the public, read-only tab showcase as a static site (GitHub Pages):
 * only *.showcase.tsx routes are used, so the API (generation, library, ClassTab) is left out.
 */
const showcase = process.env.SHOWCASE === "1";

const nextConfig: NextConfig = {
  ...(showcase && { output: "export", pageExtensions: ["showcase.tsx"], images: { unoptimized: true }, distDir: "showcase-out" }),
  // Partial prerendering features need a server; the static showcase export turns them off.
  cacheComponents: !showcase,
  partialPrefetching: !showcase,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
