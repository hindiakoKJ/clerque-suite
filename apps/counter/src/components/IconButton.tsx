import React from 'react';
import { Pressable, View, StyleSheet, ViewStyle, StyleProp, GestureResponderEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radii, tap } from '@/theme/tokens';

interface IconButtonProps {
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  size?: 'default' | 'cashier' | 'compact';
  variant?: 'ghost' | 'filled' | 'tonal';
  disabled?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  haptic?: boolean;
}

export default function IconButton({
  onPress,
  onLongPress,
  size = 'default',
  variant = 'ghost',
  disabled,
  children,
  style,
  accessibilityLabel,
  haptic = true,
}: IconButtonProps) {
  const dim = size === 'cashier' ? tap.cashierPrimary : size === 'compact' ? tap.compact : tap.default;

  const bg =
    variant === 'filled' ? colors.primary :
    variant === 'tonal' ? colors.primaryContainer :
    'transparent';

  const handlePress = (e: GestureResponderEvent) => {
    if (haptic) Haptics.selectionAsync().catch(() => {});
    onPress?.(e);
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: colors.creamDeep, borderless: variant === 'ghost' }}
      style={({ pressed }) => [
        styles.base,
        { width: dim, height: dim, backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <View style={styles.inner}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
