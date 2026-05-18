/**
 * Clerque Counter — Phone Displays (P-16)
 *
 * Pairing-code generator stacked vertically. The phone itself never RUNS as
 * a display (no KDS / customer-display mode on phone), but the owner can
 * still mint codes for tablets / TVs from their phone. We reuse the existing
 * tablet DisplaysScreen which already stacks well at narrow widths.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import DisplaysScreen from '@/shell/DisplaysScreen';
import { colors } from '@/theme';

interface Props {
  onBack?: () => void;
}

export default function PhoneDisplaysCodegen({ onBack }: Props): React.ReactElement {
  return (
    <View style={styles.root}>
      {/* DisplaysScreen renders its own TopBar — pass `onMenuPress` so the
          back arrow returns to PhoneMore. */}
      <DisplaysScreen onMenuPress={onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
