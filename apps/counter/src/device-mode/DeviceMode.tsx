/**
 * Clerque Counter — First-launch device-mode picker
 *
 * Asks "how will this device be used?" and persists the answer so subsequent
 * boots skip straight into the right surface. Mode is stored in
 * expo-secure-store (auth-grade); resetting requires Settings → "Change
 * device mode" or signing out.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, radii, spacing, text } from '@/theme';
import {
  writeDeviceMode,
  type DeviceMode,
  type DisplayDeviceRole,
  type PairedDevice,
} from '@/device-mode/storage';
import PairingScreen from '@/device-mode/PairingScreen';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface Choice {
  kind:        'CASHIER' | 'OWNER_SPOTCHECK' | 'CUSTOMER_DISPLAY' | 'KDS';
  emoji:       string;
  icon:        IconName;
  title:       string;
  subtitle:    string;
  needsAuth:   boolean;
  needsPair:   boolean;
}

const CHOICES: Choice[] = [
  {
    kind:      'CASHIER',
    emoji:     '🛒',
    icon:      'cash-register',
    title:     'Cashier till',
    subtitle:  'Runs the till. Requires tenant login + cashier PIN.',
    needsAuth: true,
    needsPair: false,
  },
  {
    kind:      'CUSTOMER_DISPLAY',
    emoji:     '📺',
    icon:      'television',
    title:     'Customer-facing display',
    subtitle:  'Kiosk mode. No login. Requires pairing code from a cashier.',
    needsAuth: false,
    needsPair: true,
  },
  {
    kind:      'KDS',
    emoji:     '🍳',
    icon:      'silverware-fork-knife',
    title:     'Kitchen / Bar display (KDS)',
    subtitle:  'Kiosk mode. Pick a station, then pair with a code.',
    needsAuth: false,
    needsPair: true,
  },
  {
    kind:      'OWNER_SPOTCHECK',
    emoji:     '👀',
    icon:      'eye-outline',
    title:     'Owner spot-check',
    subtitle:  'Read-only multi-branch dashboard. Sign in as owner.',
    needsAuth: true,
    needsPair: false,
  },
];

type Step =
  | { phase: 'picker' }
  | { phase: 'pair-customer' }
  | { phase: 'kds-station-kind' }
  | { phase: 'pair-kds'; stationKind: DisplayDeviceRole };

interface Props {
  /** Called after the user picks a mode + (if applicable) successfully pairs. */
  onChosen: (mode: DeviceMode) => void;
}

export default function DeviceModePicker({ onChosen }: Props): React.ReactElement {
  const [step, setStep] = useState<Step>({ phase: 'picker' });

  const choose = async (choice: Choice) => {
    if (choice.kind === 'CASHIER') {
      const mode: DeviceMode = { kind: 'CASHIER' };
      await writeDeviceMode(mode);
      onChosen(mode);
      return;
    }
    if (choice.kind === 'OWNER_SPOTCHECK') {
      const mode: DeviceMode = { kind: 'OWNER_SPOTCHECK' };
      await writeDeviceMode(mode);
      onChosen(mode);
      return;
    }
    if (choice.kind === 'CUSTOMER_DISPLAY') {
      setStep({ phase: 'pair-customer' });
      return;
    }
    if (choice.kind === 'KDS') {
      setStep({ phase: 'kds-station-kind' });
      return;
    }
  };

  const onPaired = async (pairing: PairedDevice, kind: 'CUSTOMER_DISPLAY' | 'KDS') => {
    const mode: DeviceMode =
      kind === 'CUSTOMER_DISPLAY'
        ? { kind: 'CUSTOMER_DISPLAY', pairing }
        : { kind: 'KDS', pairing };
    await writeDeviceMode(mode);
    onChosen(mode);
  };

  if (step.phase === 'pair-customer') {
    return (
      <PairingScreen
        expectedRole="CUSTOMER_DISPLAY"
        title="Pair customer display"
        subtitle="Enter the 4-digit code from your cashier"
        onCancel={() => setStep({ phase: 'picker' })}
        onPaired={(p) => onPaired(p, 'CUSTOMER_DISPLAY')}
      />
    );
  }

  if (step.phase === 'pair-kds') {
    return (
      <PairingScreen
        expectedRole={step.stationKind}
        title="Pair kitchen display"
        subtitle="Enter the 4-digit code from your cashier"
        onCancel={() => setStep({ phase: 'kds-station-kind' })}
        onPaired={(p) => onPaired(p, 'KDS')}
      />
    );
  }

  if (step.phase === 'kds-station-kind') {
    return (
      <KdsStationPicker
        onPick={(stationKind) => setStep({ phase: 'pair-kds', stationKind })}
        onBack={() => setStep({ phase: 'picker' })}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} style={styles.root}>
      <Text style={styles.heading}>How will this device be used?</Text>
      <Text style={styles.lead}>
        Pick once — Counter will boot straight to the right surface from now on.
      </Text>

      <View style={styles.choices}>
        {CHOICES.map((c) => (
          <Pressable
            key={c.kind}
            onPress={() => choose(c)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={styles.cardIconWrap}>
              <Text style={styles.cardEmoji}>{c.emoji}</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{c.title}</Text>
              <Text style={styles.cardSubtitle}>{c.subtitle}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={colors.muted} />
          </Pressable>
        ))}
      </View>

      <Text style={styles.footer}>
        You can change this later under Settings → Change device mode.
      </Text>
    </ScrollView>
  );
}

interface StationOpt {
  role:  DisplayDeviceRole;
  label: string;
  hint:  string;
  icon:  IconName;
}

const STATION_OPTIONS: StationOpt[] = [
  { role: 'KDS_KITCHEN',     label: 'Kitchen',     hint: 'Hot food, mains',         icon: 'silverware-fork-knife' },
  { role: 'KDS_BAR',         label: 'Bar',         hint: 'Drinks, coffee',           icon: 'coffee' },
  { role: 'KDS_HOT_BAR',     label: 'Hot bar',     hint: 'Espresso, hot drinks',     icon: 'kettle-steam' },
  { role: 'KDS_COLD_BAR',    label: 'Cold bar',    hint: 'Iced drinks, smoothies',   icon: 'snowflake' },
  { role: 'KDS_PASTRY_PASS', label: 'Pastry pass', hint: 'Bakery, plated pastries',  icon: 'cake' },
  { role: 'KDS_GENERIC',     label: 'Generic',     hint: 'Any other station',        icon: 'monitor-dashboard' },
];

function KdsStationPicker({
  onPick,
  onBack,
}: {
  onPick: (role: DisplayDeviceRole) => void;
  onBack: () => void;
}): React.ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.scroll} style={styles.root}>
      <Pressable onPress={onBack} style={styles.backLink}>
        <MaterialCommunityIcons name="arrow-left" size={20} color={colors.primary} />
        <Text style={styles.backLinkText}>Back</Text>
      </Pressable>
      <Text style={styles.heading}>Pick station</Text>
      <Text style={styles.lead}>Which station does this screen serve?</Text>

      <View style={styles.choices}>
        {STATION_OPTIONS.map((s) => (
          <Pressable
            key={s.role}
            onPress={() => onPick(s.role)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={styles.cardIconWrap}>
              <MaterialCommunityIcons name={s.icon} size={28} color={colors.primary} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{s.label}</Text>
              <Text style={styles.cardSubtitle}>{s.hint}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={colors.muted} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg },
  scroll:  { padding: spacing.s6, alignItems: 'center' },
  heading: { ...text.displayLg, color: colors.ink, textAlign: 'center', marginTop: spacing.s4 },
  lead:    {
    ...text.bodyLg,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.s3,
    marginBottom: spacing.s6,
    maxWidth: 520,
  },
  choices: { width: '100%', maxWidth: 560, gap: spacing.s3 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.s4,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: spacing.s4,
    minHeight: 88,
  },
  cardPressed: { backgroundColor: colors.creamSoft, borderColor: colors.ruleStrong },
  cardIconWrap: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji:    { fontSize: 28 },
  cardBody:     { flex: 1 },
  cardTitle:    { ...text.displaySm, color: colors.ink },
  cardSubtitle: { ...text.bodySm, color: colors.muted, marginTop: spacing.s1 },
  footer: {
    ...text.caption,
    color: colors.faint,
    marginTop: spacing.s6,
    textAlign: 'center',
  },
  backLink:     { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: spacing.s2 },
  backLinkText: { ...text.body, color: colors.primary, marginLeft: spacing.s1, fontWeight: '600' },
});
