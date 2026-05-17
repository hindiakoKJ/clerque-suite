/**
 * Clerque Counter — Kitchen / Bar Display Screen (KDS)
 *
 * Polls /kds/stations/<stationId>/queue every 3s for the paired station.
 * Each order group is one card; tap an item to bump (POST /kds/items/<id>/bump).
 * Cards drop off as soon as every item in the order is READY (mirrors the
 * recently-fixed web KDS behavior — see `apps/web/app/pos/station/[id]/page.tsx`).
 *
 * Color tone reflects wait time:
 *   • <  5 min → emerald
 *   • 5–10 min → amber
 *   • > 10 min → red
 *
 * Tap haptics on every bump (kitchen ergonomics — confirmation in a noisy room).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { pairedClient, verifyDeviceToken } from '@/device-mode/pairedClient';
import { ApiHttpError } from '@/api/client';
import { clearDeviceMode, type PairedDevice } from '@/device-mode/storage';
import { colors, radii, spacing, text, tnum } from '@/theme';

interface QueueItem {
  id:          string;
  orderId:     string;
  orderNumber: string;
  branchId:    string;
  productName: string;
  quantity:    number;
  modifiers:   string[];
  notes:       string | null;
  prepStatus:  'PENDING' | 'READY' | 'SERVED';
  orderedAt:   string | null;
  readyAt:     string | null;
  waitSeconds: number;
}

interface Props {
  pairing:    PairedDevice;
  onUnpaired: () => void;
}

function fmtElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

type Tone = 'emerald' | 'amber' | 'red';
function tone(waitSeconds: number): Tone {
  if (waitSeconds > 600) return 'red';
  if (waitSeconds > 300) return 'amber';
  return 'emerald';
}

const TONE_BORDER: Record<Tone, string> = {
  emerald: colors.success,
  amber:   colors.warning,
  red:     colors.error,
};
const TONE_BG: Record<Tone, string> = {
  emerald: 'rgba(16,185,129,0.10)',
  amber:   'rgba(245,158,11,0.10)',
  red:     'rgba(220,38,38,0.10)',
};

export default function KdsScreen({ pairing, onUnpaired }: Props): React.ReactElement {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [now, setNow] = useState(new Date());
  const { width } = useWindowDimensions();
  const cols = width >= 1280 ? 3 : width >= 768 ? 2 : 1;

  const stationId = pairing.stationId;

  // Clock tick every 30s
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Verify token on mount; bounce on revoke.
  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = await verifyDeviceToken(pairing.deviceToken);
      if (!alive) return;
      if (!ok) {
        await clearDeviceMode();
        onUnpaired();
      }
    })();
    return () => { alive = false; };
  }, [pairing.deviceToken, onUnpaired]);

  // Poll the queue every 3s
  useEffect(() => {
    if (!stationId) return;
    let alive = true;
    const tick = async () => {
      try {
        const data = await pairedClient.get<QueueItem[]>(
          `/kds/stations/${encodeURIComponent(stationId)}/queue`,
          pairing.deviceToken,
        );
        if (!alive) return;
        setItems(data ?? []);
      } catch (err) {
        if (alive && err instanceof ApiHttpError && (err.status === 401 || err.status === 403)) {
          await clearDeviceMode();
          onUnpaired();
        }
        // Otherwise: next tick will retry.
      }
    };
    void tick();
    const t = setInterval(tick, 3_000);
    return () => { alive = false; clearInterval(t); };
  }, [stationId, pairing.deviceToken, onUnpaired]);

  const bump = async (id: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await pairedClient.post(`/kds/items/${encodeURIComponent(id)}/bump`, pairing.deviceToken, {});
      // Optimistic flip
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, prepStatus: 'READY' as const } : i)));
    } catch {
      // Poll will reconcile.
    }
  };

  const grouped = useMemo(() => {
    const acc: Record<string, QueueItem[]> = {};
    for (const it of items) (acc[it.orderNumber] ??= []).push(it);
    return acc;
  }, [items]);

  const orderNumbers = useMemo(() => {
    return Object.keys(grouped)
      .filter((on) => grouped[on].some((i) => i.prepStatus !== 'READY'))
      .sort((a, b) => {
        const at = grouped[a][0].orderedAt ? new Date(grouped[a][0].orderedAt!).getTime() : 0;
        const bt = grouped[b][0].orderedAt ? new Date(grouped[b][0].orderedAt!).getTime() : 0;
        return at - bt;
      });
  }, [grouped]);

  const pendingCount = items.filter((i) => i.prepStatus === 'PENDING').length;
  const stationLabel = pairing.label ?? 'Station';

  if (!stationId) {
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.errorTitle}>No station configured</Text>
        <Text style={styles.errorBody}>
          This KDS device wasn&apos;t paired to a specific station. Ask your cashier to
          generate a new code with a station selected.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialCommunityIcons name="chef-hat" size={32} color={colors.warning} />
          <View>
            <Text style={styles.headerTitle}>{stationLabel}</Text>
            <Text style={styles.headerSub}>Kitchen display · {pendingCount} pending</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.headerClock}>
            {now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <Text style={styles.headerHint}>Updates every 3s</Text>
        </View>
      </View>

      {orderNumbers.length === 0 ? (
        <View style={styles.emptyWrap}>
          <MaterialCommunityIcons name="check-circle-outline" size={64} color={colors.darkMuted} />
          <Text style={styles.emptyTitle}>All caught up</Text>
          <Text style={styles.emptyBody}>Waiting for new orders…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {orderNumbers.map((on) => {
            const orderItems = grouped[on];
            const oldestWait = Math.max(...orderItems.map((i) => i.waitSeconds));
            const t = tone(oldestWait);
            return (
              <View
                key={on}
                style={[
                  styles.card,
                  { width: `${100 / cols - 1}%`, borderColor: TONE_BORDER[t], backgroundColor: TONE_BG[t] },
                ]}
              >
                <View style={styles.cardHead}>
                  <Text style={styles.cardOrder}>#{on.replace(/^ORD-/, '')}</Text>
                  <View style={styles.cardWait}>
                    <MaterialCommunityIcons name="clock-outline" size={14} color={colors.darkInk} />
                    <Text style={styles.cardWaitText}>{fmtElapsed(oldestWait)}</Text>
                  </View>
                </View>
                <View style={styles.cardItems}>
                  {orderItems.map((it) => {
                    const isReady = it.prepStatus === 'READY';
                    return (
                      <Pressable
                        key={it.id}
                        onPress={() => !isReady && bump(it.id)}
                        style={({ pressed }) => [
                          styles.item,
                          isReady && styles.itemReady,
                          pressed && !isReady && styles.itemPressed,
                        ]}
                      >
                        <View style={styles.itemRow}>
                          <Text style={styles.itemQty}>{it.quantity}×</Text>
                          <Text style={[styles.itemName, isReady && styles.itemNameReady]}>
                            {it.productName}
                          </Text>
                          {isReady ? (
                            <MaterialCommunityIcons name="check" size={22} color={colors.success} />
                          ) : (
                            <Text style={styles.itemHint}>tap to bump</Text>
                          )}
                        </View>
                        {it.modifiers.length > 0 && (
                          <Text style={styles.itemMods}>{it.modifiers.join(' · ')}</Text>
                        )}
                        {it.notes ? <Text style={styles.itemNote}>★ {it.notes}</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.darkBg },

  header: {
    paddingHorizontal: spacing.s5,
    paddingVertical:   spacing.s4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.darkSurface,
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(245,158,11,0.5)',
  },
  headerLeft:   { flexDirection: 'row', alignItems: 'center', gap: spacing.s3 },
  headerRight:  { alignItems: 'flex-end' },
  headerTitle:  { color: colors.darkInk, fontFamily: 'PlusJakartaSans', fontSize: 28, fontWeight: '800' },
  headerSub:    { color: colors.darkMuted, ...text.caption, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },
  headerClock:  { color: colors.darkInk, fontSize: 22, fontWeight: '700', ...tnum },
  headerHint:   { color: colors.darkMuted, ...text.caption, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },

  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.s7 },
  emptyTitle: { color: colors.darkMuted, ...text.displaySm, marginTop: spacing.s4 },
  emptyBody:  { color: colors.darkMuted, ...text.bodySm, marginTop: spacing.s1 },

  grid: { padding: spacing.s4, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s3 },
  card: {
    borderWidth: 2,
    borderRadius: radii.lg,
    padding: spacing.s4,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: spacing.s3 },
  cardOrder: { color: colors.darkInk, fontFamily: 'PlusJakartaSans', fontSize: 28, fontWeight: '800' },
  cardWait:  { flexDirection: 'row', alignItems: 'center', gap: spacing.s1 },
  cardWaitText: { color: colors.darkInk, fontSize: 14, fontWeight: '600', ...tnum },

  cardItems: { gap: spacing.s2 },
  item: {
    backgroundColor: colors.darkElev,
    borderRadius: radii.md,
    paddingHorizontal: spacing.s3,
    paddingVertical:   spacing.s3,
    minHeight: 48,
  },
  itemPressed: { backgroundColor: colors.darkRule, transform: [{ scale: 0.98 }] },
  itemReady:   { backgroundColor: 'rgba(16,185,129,0.25)', opacity: 0.8 },
  itemRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  itemQty:     { color: '#FCD34D', fontSize: 18, fontWeight: '700', width: 36, ...tnum },
  itemName:    { color: colors.darkInk, fontSize: 18, fontWeight: '500', flex: 1 },
  itemNameReady: { textDecorationLine: 'line-through' },
  itemHint:    { color: colors.darkMuted, ...text.caption, textTransform: 'uppercase', letterSpacing: 1 },
  itemMods:    { color: colors.darkMuted, ...text.caption, marginTop: spacing.s1, marginLeft: 36 + spacing.s2 },
  itemNote:    { color: colors.warning, ...text.caption, marginTop: spacing.s1, marginLeft: 36 + spacing.s2, fontStyle: 'italic' },

  errorWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.s7, backgroundColor: colors.darkBg },
  errorTitle:  { color: colors.darkInk, ...text.displayMd, marginBottom: spacing.s3 },
  errorBody:   { color: colors.darkMuted, ...text.body, textAlign: 'center', maxWidth: 420 },
});
