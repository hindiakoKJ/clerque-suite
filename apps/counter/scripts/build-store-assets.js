#!/usr/bin/env node
/**
 * Build all Play Store image assets from the source SVGs.
 *
 * Run from apps/counter:
 *   node scripts/build-store-assets.js
 *
 * Outputs every PNG Google Play asks for:
 *   assets/icon.png             1024×1024  — Expo app icon
 *   assets/adaptive-icon.png    1024×1024  — Expo Android adaptive foreground
 *   assets/splash.png           1242×2436  — Expo splash
 *   play-store/icon-512.png      512× 512  — Play Console listing icon
 *   play-store/feature-1024x500.png        — Play Console feature graphic
 *
 * Re-run any time the source SVGs change.
 */
const sharp = require('sharp');
const fs    = require('node:fs');
const path  = require('node:path');

const ROOT      = path.resolve(__dirname, '..');
const ASSETS    = path.join(ROOT, 'assets');
const PLAY      = path.join(ROOT, 'play-store');

if (!fs.existsSync(PLAY)) fs.mkdirSync(PLAY, { recursive: true });

async function render(svgPath, outPath, width, height, opts = {}) {
  const svg = fs.readFileSync(svgPath);
  let img = sharp(svg, { density: 384 });   // high DPI for crisp rasterization
  img = img.resize(width, height, { fit: opts.fit ?? 'contain', background: opts.background ?? { r: 0, g: 0, b: 0, alpha: 0 } });
  await img.png().toFile(outPath);
  console.log(`  ✓ ${path.relative(ROOT, outPath)}  (${width}×${height})`);
}

/**
 * Build the 1024×500 Play Store feature graphic. It's the banner that
 * sits at the top of the listing — brand brown background, Counter mark
 * on the left, "Clerque Counter" + tagline on the right.
 */
async function buildFeatureGraphic() {
  // Embedded SVG so we don't depend on a separate file. Mirrors the Clerque
  // mark colors. Title font uses a generic system stack so it renders
  // identically on any rasterizer.
  const svg = `
<svg width="1024" height="500" viewBox="0 0 1024 500" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"  stop-color="#714A2D"/>
      <stop offset="100%" stop-color="#8B5E3C"/>
    </linearGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#A78BFA"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="500" fill="url(#bg)"/>

  <!-- Mark on the left -->
  <g transform="translate(80, 100)">
    <rect width="300" height="300" rx="60" fill="url(#mark)"/>
    <rect x="90" y="80" width="50" height="140" rx="12" fill="#F4ECFB"/>
    <text x="115" y="180" font-family="Georgia, serif" font-size="82" font-weight="700"
          fill="#5B21B6" text-anchor="middle">c</text>
    <rect x="155" y="80" width="50" height="140" rx="12" fill="#E9DCF7"/>
    <circle cx="180" cy="115" r="8" fill="#7C3AED"/>
    <circle cx="180" cy="150" r="8" fill="#7C3AED"/>
    <circle cx="180" cy="185" r="8" fill="#7C3AED"/>
    <rect x="220" y="80" width="50" height="140" rx="12" fill="#DCC8F2"/>
    <rect x="232" y="110" width="26" height="7" rx="3.5" fill="#A78BFA"/>
    <rect x="232" y="130" width="26" height="7" rx="3.5" fill="#A78BFA"/>
    <rect x="232" y="150" width="26" height="7" rx="3.5" fill="#A78BFA"/>
  </g>

  <!-- Wordmark + tagline on the right -->
  <text x="430" y="220" font-family="'Plus Jakarta Sans', system-ui, sans-serif"
        font-size="78" font-weight="800" fill="#FFFFFF" letter-spacing="-2">
    Clerque · Counter
  </text>
  <text x="430" y="280" font-family="system-ui, sans-serif"
        font-size="28" font-weight="500" fill="#EEE9DF">
    POS · BIR receipts · FEFO inventory
  </text>
  <text x="430" y="340" font-family="system-ui, sans-serif"
        font-size="22" font-weight="400" fill="#DDD4C2">
    Built for Philippine SMBs.
  </text>
</svg>`.trim();

  await sharp(Buffer.from(svg), { density: 192 })
    .resize(1024, 500)
    .png()
    .toFile(path.join(PLAY, 'feature-1024x500.png'));
  console.log(`  ✓ play-store/feature-1024x500.png  (1024×500)`);
}

(async () => {
  console.log('Building Play Store assets…');

  // Expo runtime assets
  await render(path.join(ASSETS, 'icon.svg'),          path.join(ASSETS, 'icon.png'),          1024, 1024);
  await render(path.join(ASSETS, 'adaptive-icon.svg'), path.join(ASSETS, 'adaptive-icon.png'), 1024, 1024);
  await render(path.join(ASSETS, 'splash.svg'),        path.join(ASSETS, 'splash.png'),        1242, 2436, { fit: 'contain', background: '#F8F5EE' });

  // Play Store specific
  await render(path.join(ASSETS, 'icon.svg'),          path.join(PLAY,   'icon-512.png'),       512,  512);
  await buildFeatureGraphic();

  console.log('\nDone. Upload to Play Console:');
  console.log('  • App icon          — play-store/icon-512.png');
  console.log('  • Feature graphic   — play-store/feature-1024x500.png');
  console.log('  • Screenshots       — capture from running app (see docs/play-store-listing.md)');
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
