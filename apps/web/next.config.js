/** @type {import('next').NextConfig} */
const nextConfig = {
  // The presence of a custom webpack() function causes Next.js 16 to use
  // the webpack build path instead of Turbopack.  Turbopack's sandboxed
  // PostCSS context cannot load lightningcss native binaries (required by
  // @tailwindcss/postcss v4).  Webpack loads PostCSS in the main process
  // where native modules work normally.
  webpack(config) {
    return config;
  },
};

module.exports = nextConfig;
