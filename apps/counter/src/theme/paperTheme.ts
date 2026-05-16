import { MD3LightTheme, configureFonts, type MD3Theme } from 'react-native-paper';
import { colors, fonts } from './tokens';

/**
 * react-native-paper MD3 theme bound to our Clerque tokens.
 * We override the MD3 palette so Paper components inherit our cream/blue
 * surfaces by default — no styling overrides needed per-component.
 */
const fontConfig = {
  default:    { fontFamily: fonts.body,    fontWeight: '400' as const },
  bodyLarge:  { fontFamily: fonts.body,    fontWeight: '500' as const },
  bodyMedium: { fontFamily: fonts.body,    fontWeight: '400' as const },
  labelLarge: { fontFamily: fonts.body,    fontWeight: '600' as const },
  titleLarge: { fontFamily: fonts.display, fontWeight: '700' as const },
  titleMedium:{ fontFamily: fonts.display, fontWeight: '700' as const },
  headlineSmall:{ fontFamily: fonts.display, fontWeight: '700' as const },
  headlineMedium:{ fontFamily: fonts.display, fontWeight: '800' as const },
  headlineLarge:{ fontFamily: fonts.display, fontWeight: '800' as const },
};

export const paperTheme: MD3Theme = {
  ...MD3LightTheme,
  roundness: 12,
  colors: {
    ...MD3LightTheme.colors,
    primary:           colors.primary,
    onPrimary:         colors.onPrimary,
    primaryContainer:  colors.primaryContainer,
    onPrimaryContainer:colors.primaryInk,
    secondary:         colors.cream,
    onSecondary:       colors.ink,
    secondaryContainer:colors.creamSoft,
    onSecondaryContainer: colors.ink,
    tertiary:          colors.success,
    error:             colors.error,
    onError:           colors.onPrimary,
    errorContainer:    colors.errorSoft,
    onErrorContainer:  colors.errorDeep,
    background:        colors.bg,
    onBackground:      colors.ink,
    surface:           colors.surface,
    onSurface:         colors.ink,
    surfaceVariant:    colors.creamSoft,
    onSurfaceVariant:  colors.muted,
    outline:           colors.rule,
    outlineVariant:    colors.ruleStrong,
  },
  fonts: configureFonts({ config: fontConfig }),
};
