#!/usr/bin/env node

/**
 * Build script for esbuild bundling
 *
 * This script bundles the Node.js CLI application using esbuild.
 * Version information is handled via the auto-generated version.ts file.
 */

import { build } from "esbuild";

// Build with esbuild
await build({
  entryPoints: ["cli/node.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  banner: {
    js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);",
  },
  outfile: "dist/cli/node.js",
  external: [
    "@anthropic-ai/claude-code",
    "@hono/node-server",
    "hono",
    "commander",
  ],
  sourcemap: true,
});

console.log("✅ Bundle created successfully");
