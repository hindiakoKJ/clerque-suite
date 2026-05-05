import type { MetadataRoute } from 'next';

/**
 * PWA manifest — drives "Add to home screen" on Android Chrome / iOS Safari
 * and any "install as app" prompts. The icons referenced here must match
 * the auto-generated paths from app/icon.tsx, app/icon1.tsx, app/icon2.tsx.
 *
 * Brand: warm earth-tone palette (#8B5E3C primary). The theme_color drives
 * the Android task-switcher tint and the standalone-mode title bar.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name:        'Clerque',
    short_name:  'Clerque',
    description: 'Clerque — Counter, Ledger, and Sync for Philippine MSMEs.',
    start_url:   '/',
    display:     'standalone',
    background_color: '#F4ECFB', // light lavender (matches the inner cards)
    theme_color:      '#7C3AED', // deep purple (matches the icon gradient end)
    orientation: 'any',
    icons: [
      { src: '/icon',  sizes: '32x32',   type: 'image/png' },
      { src: '/icon1', sizes: '192x192', type: 'image/png' },
      { src: '/icon2', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon2', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
