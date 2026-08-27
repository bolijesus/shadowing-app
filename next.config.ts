import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // The app shell must work offline; runtime data lives in IndexedDB/OPFS.
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  // Node server target: enables the optional app/api/captions proxy (Phase 5).
  // Everything else is client-only. No global COOP/COEP headers (see plan D1).
  output: "standalone",
  reactStrictMode: true,
  // Heavy libs (transformers.js, ffmpeg.wasm) are only ever imported from
  // workers behind a dynamic import(); keep them out of any server bundle.
  serverExternalPackages: ["@huggingface/transformers", "@ffmpeg/ffmpeg"],
};

export default withSerwist(nextConfig);
