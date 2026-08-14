/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // No `remotePatterns`, which means the image optimizer will only serve files
  // from this app's own `public/` directory.
  //
  // It previously allowed `https://**` — every host on the internet. That turns
  // the optimizer into an open proxy: anyone can pass a third-party URL through
  // it and have this deployment fetch, resize and cache the result, on our
  // bandwidth and from our IP.
  //
  // Nothing here needs it. Crop photos are private and are fetched with the
  // farmer's token as a blob (see `components/crop-photo.tsx`), and every
  // `next/image` in the app points at a local file.

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      // Cache static assets aggressively — they don't change between deploys
      // and pre-caching them means the app shell loads instantly offline.
      {
        source: '/icons/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/images/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      // The manifest should be fresh but not stale for too long.
      {
        source: '/manifest.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600' },
          { key: 'Content-Type', value: 'application/manifest+json' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
