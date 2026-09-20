/**
 * Clerque Counter — business mark (logo or initials)
 *
 * Square tile shown before the business name in the tablet top bar (36),
 * the drawer head (48) and the phone More screen (48).
 *
 *   • Logo set   → the logo, scaled to fit, on a white rounded tile with a
 *                  thin border so dark and transparent logos stay readable.
 *   • No logo, or the image fails to load → initials in a brown circle.
 *
 * Decorative for screen readers: the business name is always rendered right
 * next to it, so reading "BC" and then "Brew Co" would just be noise.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Image } from 'expo-image';

import { initialsFrom, type TenantBranding } from '@/api/branding';
import { resolveAssetUrl } from '@/api/client';
import { colors, fonts } from '@/theme';

interface Props {
  size: number;
  /** From useTenantBranding(). Undefined while loading or offline with no cache. */
  branding?: TenantBranding | null;
  /** Name to take initials from until branding arrives (e.g. tenant.name). */
  fallbackName?: string | null;
}

export default function TenantMark({ size, branding, fallbackName }: Props): React.ReactElement {
  const uri = resolveAssetUrl(branding?.logoUrl);
  // Remember WHICH link failed, so a newly uploaded logo gets a fresh try.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const showLogo = uri !== '' && failedUri !== uri;

  if (showLogo) {
    const pad = Math.max(2, Math.round(size * 0.08));
    return (
      <View
        style={[styles.tile, { width: size, height: size, borderRadius: Math.round(size * 0.25), padding: pad }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Image
          source={{ uri }}
          style={styles.fill}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
          onError={() => setFailedUri(uri)}
        />
      </View>
    );
  }

  const initials = branding?.initials || initialsFrom(branding?.businessName, branding?.name, fallbackName);
  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        style={[styles.initials, { fontSize: Math.round(size * 0.4), lineHeight: Math.round(size * 0.5) }]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
    overflow: 'hidden',
  },
  fill: { flex: 1, width: '100%', height: '100%' },
  circle: {
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: fonts.displayBold,
    fontWeight: '800',
    color: colors.primaryInk,
    letterSpacing: 0,
  },
});
