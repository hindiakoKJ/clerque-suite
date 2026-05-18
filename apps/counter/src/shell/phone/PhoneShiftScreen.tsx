/**
 * Clerque Counter — Phone Shift tab (P-13)
 *
 * Delegates to the existing ShiftCoordinator which already handles the
 * open / status / close / Z-read flow with big stacked cards. ShiftCoordinator
 * paints its own TopBar, so we don't add a PhoneHeader here (would double up).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import ShiftCoordinator from '@/shift/ShiftCoordinator';
import { colors } from '@/theme';

export default function PhoneShiftScreen(): React.ReactElement {
  return (
    <View style={styles.root}>
      <ShiftCoordinator />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
