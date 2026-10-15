import { fileURLToPath } from 'node:url';

// The repository keeps one .env at its root, shared with the mission server and the devnet scripts.
// Next only reads apps/web/.env*, so load the root file here; variables already set win.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // No root .env: the defaults in config/*.json apply.
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // `NEXT_OUTPUT=standalone` builds a self-contained server folder, as a container deployment would use.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,

  /**
   * `@bas/config` and the `@bas/content` server entry read the repository
   * file system (`node:fs`, `node:path`, `createRequire`). They are compiled
   * packages that must run in Node, so webpack must not bundle them.
   */
  serverExternalPackages: ['@bas/config', '@bas/content'],

  /**
   * Server rendering reads `content/` and `config/` from the repository at run time and finds the
   * repository by its `pnpm-workspace.yaml`. A deployment bundle only holds files the build could
   * trace, so these are listed to keep them with it (a dynamic page failed without them).
   */
  outputFileTracingIncludes: {
    '/**/*': ['../../pnpm-workspace.yaml', '../../content/en/*.json', '../../config/*.json'],
  },

  images: {
    // Pixel art must never be resampled; sprites are served exactly as authored.
    unoptimized: true,
  },

  // The dev-only route badge sat on top of the My citizens panel.
  devIndicators: {
    appIsrStatus: false,
    buildActivityPosition: 'top-right',
  },

  eslint: {
    dirs: ['src'],
  },

  /**
   * NFT metadata under `/templates/<id>/` is fetched by wallets and marketplaces from other
   * origins, so it is open to any origin and may be cached briefly (D-0013, D-0024).
   */
  async headers() {
    return [
      {
        source: '/templates/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300' },
        ],
      },
    ];
  },
};

export default nextConfig;
