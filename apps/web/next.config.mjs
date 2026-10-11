/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * `@bas/config` and the `@bas/content` server entry read the repository
   * file system (`node:fs`, `node:path`, `createRequire`). They are compiled
   * packages that must run in Node, so webpack must not bundle them.
   */
  serverExternalPackages: ['@bas/config', '@bas/content'],

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
};

export default nextConfig;
