import { build } from "esbuild";

const shared = { bundle: true, target: ["es2018"], sourcemap: true, legalComments: "none" };

// 1) Browser <script> bundle — auto-booting IIFE served at cdn-1.scribe-mail.com/v1/tracking.js.
//    Minified; <3KB gzipped budget. Path mirrors the URL (v1/*; a breaking change builds v2/*).
await build({ ...shared, entryPoints: ["src/browser.ts"], format: "iife", minify: true, outfile: "dist/v1/tracking.js" });

// 2) npm module — ESM + CJS for bundler/app code (`import` / `require`). Unminified so it reads
//    well in consumers' bundles + sourcemaps; the consumer's bundler minifies.
await build({ ...shared, entryPoints: ["src/index.ts"], format: "esm", outfile: "dist/index.mjs" });
await build({ ...shared, entryPoints: ["src/index.ts"], format: "cjs", outfile: "dist/index.cjs" });

console.log("Built dist/v1/tracking.js (IIFE), dist/index.mjs (ESM), dist/index.cjs (CJS)");
