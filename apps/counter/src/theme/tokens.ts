/**
 * Clerque Counter — design tokens
 * Source of truth: design-source/design-tokens-v2.html + screens-styles-v2.css
 * DO NOT inline magic colors anywhere else. Always import from here.
 */

export const colors = {
  // Primary · electric blue (matches web Counter)
  primary:          '#3B82F6',
  primaryPress:     '#1D4ED8',
  primaryContainer: '#DBE8FE',
  onPrimary:        '#FFFFFF',
  primaryInk:       '#0C2A66',

  // Warm cream surfaces · daylight friendly
  cream:     '#E8E1D1',
  creamSoft: '#F2EDE2',
  creamDeep: '#D8CFBC',
  bg:        '#F8F5EE',
  surface:   '#FFFFFF',

  // Text · stays warm for contrast against cool primary
  ink:        '#1F1B16',
  muted:      '#5F564B',
  faint:      '#8A8073',
  rule:       '#DDD4C2',
  ruleStrong: '#BDB39E',

  // Semantic
  success:     '#10B981',
  successSoft: '#D7F4E7',
  successDeep: '#065F46',
  warning:     '#F59E0B',
  warningSoft: '#FCEBC9',
  warningDeep: '#92400E',
  error:       '#DC2626',
  errorSoft:   '#FBD9D9',
  errorDeep:   '#991B1B',
  info:        '#3B82F6',
  infoSoft:    '#DBE8FE',
  infoDeep:    '#1E40AF',

  // Local payment brands — never hidden under "Other"
  gcash:   '#007BFC',
  paymaya: '#00B14F',

  // Dark mode (cool, matches web Counter night surface)
  darkBg:      '#0B1220',
  darkSurface: '#131B2E',
  darkElev:    '#1A2335',
  darkInk:     '#F1F5F9',
  darkMuted:   '#94A3B8',
  darkRule:    '#28344A',
} as const;

/** 4-px grid spacing scale. */
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

export const radii = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   24,
  pill: 999,
} as const;

/** Material 3-flavored elevation tiers. Drop-shadows tuned for cream surfaces. */
export const elevation = {
  e1: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  e2: { shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  e3: { shadowColor: '#0F172A', shadowOpacity: 0.10, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  e4: { shadowColor: '#0F172A', shadowOpacity: 0.14, shadowRadius: 32, shadowOffset: { width: 0, height: 12 }, elevation: 6 },
  e5: { shadowColor: '#0F172A', shadowOpacity: 0.18, shadowRadius: 56, shadowOffset: { width: 0, height: 24 }, elevation: 12 },
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

/** Touch target heights (Material 3 + cashier ergonomics). */
export const tap = {
  cashierPrimary: 64,
  default:        48,
  compact:        36,
} as const;

/** Text style presets. */
export const text = {
  // Display — Plus Jakarta Sans
  displayLg: { fontFamily: fonts.display, fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5 },
  displayMd: { fontFamily: fonts.display, fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.3 },
  displaySm: { fontFamily: fonts.display, fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2 },

  // Body — Inter
  bodyLg: { fontFamily: fonts.body, fontSize: 18, fontWeight: '500' as const },
  body:   { fontFamily: fonts.body, fontSize: 16, fontWeight: '400' as const },
  bodySm: { fontFamily: fonts.body, fontSize: 14, fontWeight: '400' as const },
  caption:{ fontFamily: fonts.body, fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.1 },

  // Cashier buttons / numerics — Inter with tabular-nums via fontVariant
  cashierKey: { fontFamily: fonts.body, fontSize: 22, fontWeight: '700' as const },
  cashierLg:  { fontFamily: fonts.body, fontSize: 28, fontWeight: '700' as const },

  // Monospaced runs of currency / IDs
  mono:    { fontFamily: fonts.mono, fontSize: 14, fontWeight: '500' as const },
  monoLg:  { fontFamily: fonts.mono, fontSize: 20, fontWeight: '600' as const },
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
