/**
 * Next.js config — security-hardened.
 *
 * SecAudit 2026-05 findings remediated here:
 *   • I4 (High)  — Edge security headers (HSTS, X-Frame-Options, CSP,
 *                  Referrer-Policy, X-Content-Type-Options,
 *                  Permissions-Policy)
 *   • I15 (Low)  — poweredByHeader off (don't leak Next.js version)
 *   • T5 (Med)   — image domain allowlist for product photos
 *
 * The API has its own helmet middleware so this is the WEB edge only.
 *
 * CSP rationale:
 *   • script-src 'self' 'unsafe-inline' 'unsafe-eval' — required by Next.js
 *     React hydration + dev tools; remove 'unsafe-eval' once Next.js
 *     supports nonce-based hydration in your version.
 *   • connect-src 'self' + your API origin — keeps the page from
 *     speaking to arbitrary backends.
 *   • frame-ancestors 'none' — blocks iframe embedding (clickjacking).
 *   • upgrade-insecure-requests — force HTTPS on any nested resources.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  // I15 — don't leak Next.js version in HTTP response headers.
  poweredByHeader: false,

  reactStrictMode: true,

  // T5 — allow product photos from R2 / Railway and our own domains.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: '**.up.railway.app' },
      { protocol: 'https', hostname: 'clerque.hnscorpph.com' },
      { protocol: 'https', hostname: 'console.hnscorpph.com' },
      { protocol: 'https', hostname: 'cdn.clerque.app' },
    ],
  },

  // I4 — global security headers. Applied to every route.
  async headers() {
    const apiOrigin =
      process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://*.up.railway.app';
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src 'self' ${apiOrigin} https://*.up.railway.app https://api.posthog.com`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      'upgrade-insecure-requests',
    ];

    return [
      {
        source: '/:path*',
        headers: [
          // HSTS — 180 days. Subdomains forced to HTTPS too.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=15552000; includeSubDomains',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Disable opt-in browser features the app doesn't use.
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          { key: 'Content-Security-Policy', value: cspDirectives.join('; ') },
          // Block IE from sniffing types (legacy but cheap to ship).
          { key: 'X-XSS-Protection', value: '0' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
