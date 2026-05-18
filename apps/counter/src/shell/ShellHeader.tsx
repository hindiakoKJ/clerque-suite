/**
 * Clerque Counter — Responsive shell header
 *
 * Phone (≤600dp shorter edge) → compact PhoneHeader (56dp, title + avatar).
 * Tablet (>=600dp)            → full TopBar with tenant chip, search,
 *                               branch picker, sync pill, bell, role chip.
 *
 * Shared screens (OrdersScreen, ShiftCoordinator, SettingsScreen) render
 * through this so they don't paint the tablet header on a phone where it
 * overflows the 414dp width.
 */
import React from 'react';

import TopBar from '@/shell/TopBar';
import PhoneHeader from '@/shell/phone/PhoneHeader';
import { useDeviceSize } from '@/shell/useDeviceSize';

interface Props {
  /** Title shown on phone. Ignored on tablet (TopBar shows tenant chip). */
  title?:    string;
  subtitle?: string;
  /** Called when the phone back chevron / tablet burger is tapped. */
  onMenuPress?: () => void;
  /** When true the phone header hides the cashier avatar (e.g. on the
   *  Orders tab where the bottom-tab bar already shows identity). */
  hideRight?: boolean;
}

export default function ShellHeader({
  title,
  subtitle,
  onMenuPress,
  hideRight,
}: Props): React.ReactElement {
  const size = useDeviceSize();
  if (size === 'phone') {
    return (
      <PhoneHeader
        title={title}
        subtitle={subtitle}
        onBack={onMenuPress}
        hideRight={hideRight}
      />
    );
  }
  return <TopBar onMenuPress={onMenuPress} />;
}
