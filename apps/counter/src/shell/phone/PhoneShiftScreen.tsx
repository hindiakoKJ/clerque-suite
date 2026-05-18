/**
 * Clerque Counter — Phone Shift tab (P-13)
 *
 * Stacked 80dp action cards. Delegates to the existing ShiftCoordinator
 * which already handles the open / close / Z-read flow.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import ShiftCoordinator from '@/shift/ShiftCoordinator';
import { colors } from '@/theme';

export default function PhoneShiftScreen(): React.ReactElement {
  const [zMode, setZMode] = useState(false);

  return (
    <View style={styles.root}>
      <PhoneHeader title={zMode ? "Today's Z-read" : 'Shift'} />
      <View style={styles.body}>
        <ShiftCoordinator startInZRead={zMode} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
});
