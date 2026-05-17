/**
 * Clerque Counter — Printer settings
 *
 * Drawer page: discover paired Bluetooth devices, connect one, test print,
 * disconnect. Lives under Settings → Printer.
 *
 * Permission flow:
 *   • On Android 12+ we request BLUETOOTH_CONNECT + BLUETOOTH_SCAN the
 *     first time the user taps Discover.
 *   • Denial surfaces as a red banner with a Retry button.
 *   • Under Expo Go the underlying service is the ConsolePrinter — the
 *     discover list will be empty and a banner explains why.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator, Snackbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, radii, spacing, tap, text } from '@/theme';
import { usePrinter } from '@/receipt/usePrinter';
import type {
  BluetoothDeviceInfo,
  PrinterService,
} from '@/receipt/printerService';
import type { ReceiptForPrinter } from '@/receipt/receiptToEscPos';
import * as SecureStore from 'expo-secure-store';

const PAIRED_DEVICE_KEY = 'clerque.printerId';

type LastPrintStatus =
  | { kind: 'never' }
  | { kind: 'success'; at: number }
  | { kind: 'error'; at: number; message: string };

export interface PrinterSettingsScreenProps {
  onMenuPress?: () => void;
}

export default function PrinterSettingsScreen({
  onMenuPress,
}: PrinterSettingsScreenProps): React.ReactElement {
  const printer = usePrinter();
  const [devices, setDevices] = useState<BluetoothDeviceInfo[]>([]);
  const [pairedId, setPairedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  const [lastPrint, setLastPrint] = useState<LastPrintStatus>({ kind: 'never' });

  // Restore the persisted device id on mount so we can pin it to the top.
  useEffect(() => {
    void SecureStore.getItemAsync(PAIRED_DEVICE_KEY).then(setPairedId);
  }, []);

  const discover = useCallback(async () => {
    setBusy(true);
    setPermError(null);
    try {
      const list = await printer.scanForDevices();
      setDevices(list);
      if (list.length === 0) {
        setSnack('No paired devices found. Pair the printer in Bluetooth settings first.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Discovery failed.';
      setPermError(msg);
    } finally {
      setBusy(false);
    }
  }, [printer]);

  const connect = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await printer.pair(id);
        setPairedId(id);
        setSnack('Printer connected.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not connect.';
        setSnack(msg);
      } finally {
        setBusy(false);
      }
    },
    [printer],
  );

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      await printer.disconnect?.();
      setPairedId(null);
      setSnack('Printer disconnected.');
    } finally {
      setBusy(false);
    }
  }, [printer]);

  const testPrint = useCallback(async () => {
    setBusy(true);
    try {
      await printer.print(buildTestReceipt());
      setLastPrint({ kind: 'success', at: Date.now() });
      setSnack('Test page sent to printer.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Print failed.';
      setLastPrint({ kind: 'error', at: Date.now(), message });
      setSnack(message);
    } finally {
      setBusy(false);
    }
  }, [printer]);

  const pinned = pairedId
    ? devices.find(d => d.id === pairedId) ?? { id: pairedId, name: 'Paired printer' }
    : null;
  const rest = devices.filter(d => d.id !== pairedId);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {onMenuPress ? (
          <Pressable onPress={onMenuPress} style={styles.menuBtn} hitSlop={12}>
            <MaterialCommunityIcons name="menu" size={22} color={colors.ink} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Printer</Text>
          <Text style={styles.caption}>
            Pair a Bluetooth thermal printer (58 mm or 80 mm ESC/POS).
          </Text>
        </View>
        <StatusPill last={lastPrint} />
      </View>

      <View style={styles.body}>
        {permError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorTitle}>Cannot access Bluetooth</Text>
            <Text style={styles.errorBody}>{permError}</Text>
            <Pressable onPress={discover} style={styles.retryBtn}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {pinned ? (
          <View style={styles.pinnedCard}>
            <Text style={styles.cardLabel}>Connected</Text>
            <Text style={styles.deviceName}>{pinned.name}</Text>
            <Text style={styles.deviceMac}>{pinned.id}</Text>
            <View style={styles.actionRow}>
              <Pressable
                onPress={testPrint}
                disabled={busy}
                style={[styles.primaryBtn, busy && styles.btnDisabled]}
              >
                <Text style={styles.primaryBtnLabel}>Test print</Text>
              </Pressable>
              <Pressable
                onPress={disconnect}
                disabled={busy}
                style={[styles.ghostBtn, busy && styles.btnDisabled]}
              >
                <Text style={styles.ghostBtnLabel}>Disconnect</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.discoverRow}>
          <Text style={styles.sectionLabel}>Paired Bluetooth devices</Text>
          <Pressable
            onPress={discover}
            disabled={busy}
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.primaryBtnLabel}>Discover devices</Text>
            )}
          </Pressable>
        </View>

        <FlatList<BluetoothDeviceInfo>
          data={rest}
          keyExtractor={d => d.id}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          contentContainerStyle={{ paddingBottom: spacing.s6 }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No other paired devices. Use the OS Bluetooth settings to pair
              your printer first, then tap Discover.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.deviceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceName}>{item.name}</Text>
                <Text style={styles.deviceMac}>{item.id}</Text>
              </View>
              <Pressable
                onPress={() => connect(item.id)}
                disabled={busy}
                style={[styles.primaryBtn, busy && styles.btnDisabled]}
              >
                <Text style={styles.primaryBtnLabel}>Connect</Text>
              </Pressable>
            </View>
          )}
        />
      </View>

      <Snackbar
        visible={snack !== null}
        onDismiss={() => setSnack(null)}
        duration={3500}
      >
        {snack ?? ''}
      </Snackbar>
    </View>
  );
}

function StatusPill({ last }: { last: LastPrintStatus }): React.ReactElement {
  let label: string;
  let bg: string;
  let fg: string;
  switch (last.kind) {
    case 'never':
      label = 'Never used';
      bg = colors.creamSoft;
      fg = colors.muted;
      break;
    case 'success':
      label = 'Last print OK';
      bg = colors.successSoft;
      fg = colors.successDeep;
      break;
    case 'error':
      label = 'Last print failed';
      bg = colors.errorSoft;
      fg = colors.errorDeep;
      break;
  }
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** Synthetic test receipt — uses minimal placeholders. */
function buildTestReceipt(): ReceiptForPrinter {
  return {
    tenant: {
      id: 'test',
      name: 'Clerque Test Print',
      businessType: 'OTHER',
      planCode: 'SOLO_STANDARD',
      isVatRegistered: false,
      tin: '000-000-000-000',
      taxStatus: 'NON_VAT',
      nextOrNumber: 1,
      planFeatures: {
        maxRecipes: 0,
        maxAdvancedInventoryItems: 0,
        salesLeadDelegation: 0,
        customerPhoneLookup: false,
        receiptCustomization: 'none',
        advancedReports: false,
        loyaltyPro: false,
        autoBackup: false,
        fifoValuation: false,
        makerCheckerVoids: false,
        auditLog: false,
        customRoles: false,
        apiAccess: 'none',
      },
    },
    cart: {
      lines: [
        {
          id: 't1',
          productId: 'test',
          productName: 'Test item',
          qty: 1,
          unitPrice: 100,
          modifiers: [],
          lineTotal: 100,
        },
      ],
      payments: [],
    },
    orNumber: 0,
    issuedAt: Date.now(),
    cashierName: 'Test',
    subtotalCents: 100,
    discountCents: 0,
    totalCents: 100,
    payments: [{ method: 'CASH', amount: 100 }],
    changeCents: 0,
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.s5,
    gap: spacing.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    backgroundColor: colors.surface,
  },
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.creamSoft,
  },
  title: { ...text.displaySm, color: colors.ink },
  caption: { ...text.caption, color: colors.muted, marginTop: 2 },
  pill: {
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
    borderRadius: radii.pill,
  },
  pillLabel: { ...text.caption, fontWeight: '700' },
  body: { flex: 1, padding: spacing.s5, gap: spacing.s4 },
  errorBanner: {
    padding: spacing.s4,
    borderRadius: radii.md,
    backgroundColor: colors.errorSoft,
    gap: spacing.s2,
  },
  errorTitle: { ...text.bodyLg, color: colors.errorDeep, fontWeight: '700' },
  errorBody: { ...text.bodySm, color: colors.errorDeep },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s2,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.errorDeep,
  },
  retryLabel: { ...text.body, color: colors.errorDeep, fontWeight: '600' },
  pinnedCard: {
    padding: spacing.s5,
    borderRadius: radii.lg,
    backgroundColor: colors.primaryContainer,
    gap: spacing.s2,
  },
  cardLabel: {
    ...text.caption,
    color: colors.primaryInk,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  deviceName: { ...text.bodyLg, color: colors.ink, fontWeight: '600' },
  deviceMac: { ...text.caption, color: colors.muted, fontFamily: undefined },
  actionRow: { flexDirection: 'row', gap: spacing.s3, marginTop: spacing.s3 },
  discoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.s3,
  },
  sectionLabel: { ...text.bodyLg, color: colors.ink, fontWeight: '700' },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.s4,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: spacing.s3,
  },
  sep: { height: spacing.s2 },
  empty: {
    ...text.bodySm,
    color: colors.muted,
    padding: spacing.s4,
    textAlign: 'center',
  },
  primaryBtn: {
    paddingHorizontal: spacing.s4,
    height: tap.default,
    minWidth: 132,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnLabel: { ...text.body, color: colors.onPrimary, fontWeight: '700' },
  ghostBtn: {
    paddingHorizontal: spacing.s4,
    height: tap.default,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnLabel: { ...text.body, color: colors.ink, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
});
