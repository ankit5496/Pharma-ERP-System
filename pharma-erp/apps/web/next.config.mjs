import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

import { config as loadEnv } from 'dotenv';

// This app's env vars live in the single root .env, but Next only looks in its
// own directory. Load the root file first so NEXT_PUBLIC_API_URL is inlined at
// build time; `override: false` means a real environment variable (CI, Docker)
// still wins over the file.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const file of ['.env.local', '.env']) {
  const path = resolve(repoRoot, file);
  if (existsSync(path)) loadEnv({ path, override: false });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source (see their "exports" maps), so
  // Next has to run them through its own compiler rather than expecting
  // pre-built JS.
  transpilePackages: ['@pharma-erp/types'],
  eslint: {
    // Linting is a separate pipeline step (`turbo run lint`); running it again
    // inside the build just slows the build down and duplicates the failure.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Never skip type errors in a build — a broken contract with the API should
    // fail here rather than in a browser.
    ignoreBuildErrors: false,
  },
  // Do not advertise the framework version to the internet.
  poweredByHeader: false,
};

/**
 * THE DEV SERVER AND THE PRODUCTION BUILD GET SEPARATE OUTPUT DIRECTORIES.
 *
 * They both default to `.next`, so running `pnpm build` while `pnpm dev` is up
 * — which happens constantly, since the build is part of the check pipeline —
 * has the production compiler overwrite the manifests the running dev server is
 * serving from. The dev server then hands the browser a client-reference id
 * that no longer matches any chunk, and the page dies with "Element type is
 * invalid. Received a promise that resolves to: undefined" pointing at whatever
 * client component happened to be first in the tree. Nothing is wrong with that
 * component, which is what makes it such a bad hour to debug.
 *
 * Production keeps `.next` so nothing about deployment changes.
 */
export default (phase) => ({
  ...nextConfig,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
});
