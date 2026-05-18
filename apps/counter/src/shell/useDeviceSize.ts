/**
 * Clerque Counter — Device-size detection
 *
 * Returns `'tablet'` when the shorter screen edge is >= 600dp (the standard
 * Android tablet breakpoint), `'phone'` otherwise. Updates live on rotation.
 *
 * Used by RootNavigator to pick between the tablet drawer shell and the
 * phone bottom-tab shell. Phones are portrait-locked at startup so the
 * breakpoint is stable post-boot.
 */
import { useWindowDimensions } from 'react-native';

export type DeviceSize = 'phone' | 'tablet';

export function useDeviceSize(): DeviceSize {
  const { width, height } = useWindowDimensions();
  const shorter = Math.min(width, height);
  return shorter >= 600 ? 'tablet' : 'phone';
}
