/**
 * Clerque Counter — design tokens
 * Source of truth: apps/counter/design-source/screens-styles.css
 *   Every value here is a 1:1 mirror of a CSS custom property in that file.
 *   When the CSS changes, this file changes — never invent values.
 *
 * Brand: Counter is BROWN-primary on cream surfaces. (Earlier blue values
 * were a temporary experiment; the locked brand is the brown earth-tone
 * palette below.)
 */

export const colors = {
  // ── Brand · brown earth-tones ─────────────────────────────────────
  primary:          '#8B5E3C',
  primaryPress:     '#714A2D',
  primaryContainer: '#E7D5C2',
  onPrimary:        '#FFFFFF',
  /** Deep brown ink for text on primaryContainer. */
  primaryInk:       '#714A2D',

  // ── Surfaces · warm cream ─────────────────────────────────────────
  cream:     '#EEE9DF',
  creamSoft: '#F5F1E8',
  creamDeep: '#DDD4C2',
  bg:        '#FAFAF7',
  surface:   '#FFFFFF',

  // ── Text ──────────────────────────────────────────────────────────
  ink:        '#1F1B16',
  muted:      '#5C5650',
  faint:      '#8A847C',
  rule:       '#D4CFC4',
  ruleStrong: '#BAB3A6',

  // ── Semantic ──────────────────────────────────────────────────────
  success:     '#10B981',
  successSoft: '#D7F4E7',
  successDeep: '#065F46',
  warning:     '#F59E0B',
  warningSoft: '#FCEBC9',
  warningDeep: '#92400E',
  error:       '#DC2626',
  errorSoft:   '#FBD9D9',
  errorDeep:   '#991B1B',
  info:        '#2563EB',
  infoSoft:    '#DBE8FE',
  infoDeep:    '#1E40AF',

  // ── Local payment brands ──────────────────────────────────────────
  gcash:   '#007BFC',
  gcashSoft: '#E1EEFE',
  gcashDeep: '#0048A1',
  paymaya: '#00B14F',

  // ── Dark mode (kept for parity, not exercised yet) ────────────────
  darkBg:      '#0B1220',
  darkSurface: '#131B2E',
  darkElev:    '#1A2335',
  darkInk:     '#F1F5F9',
  darkMuted:   '#94A3B8',
  darkRule:    '#28344A',
} as const;

/** 4-px grid spacing scale — matches --s-1..--s-8 in screens-styles.css. */
export const spacing = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 24,
  s6: 32,
  s7: 48,
  s8: 64,
} as const;

/** Corner radii — matches --r-xs..--r-pill. */
export const radii = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   24,
  pill: 999,
} as const;

/** Elevation tiers — matches --e-1..--e-5. RN approximation of the CSS
 *  drop-shadows. iOS reads shadow*, Android reads `elevation`. */
export const elevation = {
  e1: { shadowColor: '#1F1B16', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  e2: { shadowColor: '#1F1B16', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  e3: { shadowColor: '#1F1B16', shadowOpacity: 0.10, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  e4: { shadowColor: '#1F1B16', shadowOpacity: 0.14, shadowRadius: 32, shadowOffset: { width: 0, height: 12 }, elevation: 6 },
  e5: { shadowColor: '#1F1B16', shadowOpacity: 0.18, shadowRadius: 56, shadowOffset: { width: 0, height: 24 }, elevation: 12 },
} as const;

/** Font family aliases — names match the @expo-google-fonts/* bundled
 *  font keys, which are loaded once at app boot in App.tsx. RN's text
 *  engine matches on the exact key string. */
export const fonts = {
  display:        'PlusJakartaSans_700Bold',
  displayBold:    'PlusJakartaSans_800ExtraBold',
  body:           'Inter_400Regular',
  bodyMedium:     'Inter_500Medium',
  bodySemibold:   'Inter_600SemiBold',
  bodyBold:       'Inter_700Bold',
  mono:           'JetBrainsMono_500Medium',
  monoSemibold:   'JetBrainsMono_600SemiBold',
} as const;

/** Touch target heights. */
export const tap = {
  cashierPrimary: 64,
  default:        48,
  compact:        36,
} as const;

/** Text style presets. Sizes calibrated against the design CSS. */
export const text = {
  // Display — Plus Jakarta Sans (matches --font-display)
  displayLg: { fontFamily: fonts.displayBold, fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.6 },
  displayMd: { fontFamily: fonts.display,     fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.3 },
  displaySm: { fontFamily: fonts.display,     fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2 },

  // Body — Inter (matches --font-body)
  bodyLg: { fontFamily: fonts.bodyMedium, fontSize: 18, fontWeight: '500' as const },
  body:   { fontFamily: fonts.body,       fontSize: 16, fontWeight: '400' as const },
  bodySm: { fontFamily: fonts.body,       fontSize: 14, fontWeight: '400' as const },
  caption:{ fontFamily: fonts.bodyMedium, fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.2 },

  // Cashier buttons / numerics
  cashierKey: { fontFamily: fonts.body, fontSize: 22, fontWeight: '700' as const },
  cashierLg:  { fontFamily: fonts.body, fontSize: 28, fontWeight: '700' as const },

  // Monospaced runs — currency, OR#, lot numbers (matches --font-mono)
  mono:    { fontFamily: fonts.mono,         fontSize: 14, fontWeight: '500' as const },
  monoLg:  { fontFamily: fonts.monoSemibold, fontSize: 20, fontWeight: '600' as const },
} as const;

/** Tabular-nums style helper for currency. Use on every ₱ amount. */
export const tnum = { fontVariant: ['tabular-nums' as const] };

export type Tokens = {
  colors: typeof colors;
  spacing: typeof spacing;
  radii: typeof radii;
  elevation: typeof elevation;
  fonts: typeof fonts;
  tap: typeof tap;
  text: typeof text;
};

export const tokens: Tokens = { colors, spacing, radii, elevation, fonts, tap, text };
