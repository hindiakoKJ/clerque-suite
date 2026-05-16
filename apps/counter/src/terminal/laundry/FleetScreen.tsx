/**
 * Laundry Fleet — washers/dryers grid + queue rail.
 *
 * Reached from the app drawer (Laundry tenants only). Drawer wiring is the
 * drawer agent's job; this just exports a screen component.
 *
 * Each machine card shows:
 *   - Machine ID (W1/D1)
 *   - Coloured state pill (Idle/Running/Done/OOS)
 *   - Live countdown when RUNNING (mm:ss)
 *   - Assigned ticket / customer
 * Tap a card:
 *   - IDLE → bottom sheet to pick a queued ticket + duration
 *   - RUNNING with 0s left → "Mark done" action
 *   - DONE → reset to idle
 *   - OOS → toggle back to idle
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { colors, spacing, radii, text, tap, elevation } from '@/theme/tokens';
import {
  useFleet,
  startFleetTicker,
  formatCountdown,
  type Machine,
  type MachineState,
  type QueuedTicket,
} from './fleetStore';

const STATE_STYLES: Record<MachineState, { bg: string; fg: string; label: string }> = {
  IDLE:           { bg: colors.cream,       fg: colors.muted,      label: 'Idle' },
  RUNNING:        { bg: colors.infoSoft,    fg: colors.infoDeep,   label: 'Running' },
  DONE:           { bg: colors.successSoft, fg: colors.successDeep,label: 'Ready to unload' },
  OUT_OF_SERVICE: { bg: colors.errorSoft,   fg: colors.errorDeep,  label: 'Out of service' },
};

export const FleetScreen: React.FC = () => {
  const machines = useFleet((s) => s.machines);
  const queue = useFleet((s) => s.queue);
  const assignTicket = useFleet((s) => s.assignTicket);
  const markDone = useFleet((s) => s.markDone);
  const resetToIdle = useFleet((s) => s.resetToIdle);
  const setOutOfService = useFleet((s) => s.setOutOfService);

  const sheetRef = useRef<BottomSheet>(null);
  const [target, setTarget] = React.useState<Machine | null>(null);

  useEffect(() => {
    const stop = startFleetTicker();
    return stop;
  }, []);

  const washers = useMemo(() => machines.filter((m) => m.kind === 'WASHER'), [machines]);
  const dryers = useMemo(() => machines.filter((m) => m.kind === 'DRYER'), [machines]);

  const onMachinePress = (m: Machine) => {
    if (m.state === 'IDLE') {
      setTarget(m);
      sheetRef.current?.expand();
      return;
    }
    if (m.state === 'RUNNING') {
      if ((m.remainingSec ?? 1) === 0) {
        markDone(m.id);
      } else {
        Alert.alert(
          `${m.id} · still running`,
          `Countdown: ${formatCountdown(m.remainingSec)}. Force-stop?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Mark done', onPress: () => markDone(m.id) },
          ]
        );
      }
      return;
    }
    if (m.state === 'DONE') {
      resetToIdle(m.id);
      return;
    }
    if (m.state === 'OUT_OF_SERVICE') {
      setOutOfService(m.id, false);
    }
  };

  const onLongPress = (m: Machine) => {
    if (m.state === 'IDLE' || m.state === 'OUT_OF_SERVICE') {
      setOutOfService(m.id, m.state !== 'OUT_OF_SERVICE');
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Fleet</Text>
        <Text style={styles.sub}>
          {washers.length} washers · {dryers.length} dryers · {queue.length} waiting
        </Text>
      </View>

      <View style={styles.body}>
        <ScrollView style={styles.gridCol} contentContainerStyle={styles.gridContent}>
          <Section title="Washers" machines={washers} onPress={onMachinePress} onLongPress={onLongPress} />
          <Section title="Dryers" machines={dryers} onPress={onMachinePress} onLongPress={onLongPress} />
        </ScrollView>

        <View style={styles.queueRail}>
          <Text style={styles.queueTitle}>Queue · FIFO</Text>
          {queue.length === 0 && <Text style={styles.emptyHint}>No tickets waiting.</Text>}
          {queue.map((t, i) => (
            <View key={t.ticketNo} style={styles.queueRow}>
              <View style={styles.queueNo}>
                <Text style={styles.queueNoText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.queueTicket}>{t.ticketNo}</Text>
                <Text style={styles.queueMeta}>{t.customerName} · {t.loadKind}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={['55%']}
        enablePanDownToClose
        onClose={() => setTarget(null)}
      >
        <BottomSheetView style={styles.sheet}>
          {target && (
            <AssignSheetContent
              machine={target}
              queue={queue}
              onAssign={(ticket, mins) => {
                assignTicket(target.id, ticket, mins);
                sheetRef.current?.close();
              }}
            />
          )}
        </BottomSheetView>
      </BottomSheet>
    </SafeAreaView>
  );
};

// ---------- subcomponents ----------

const Section: React.FC<{
  title: string;
  machines: Machine[];
  onPress: (m: Machine) => void;
  onLongPress: (m: Machine) => void;
}> = ({ title, machines, onPress, onLongPress }) => (
  <View style={{ marginBottom: spacing.s6 }}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.grid}>
      {machines.map((m) => (
        <MachineCard key={m.id} machine={m} onPress={() => onPress(m)} onLongPress={() => onLongPress(m)} />
      ))}
    </View>
  </View>
);

const MachineCard: React.FC<{
  machine: Machine;
  onPress: () => void;
  onLongPress: () => void;
}> = ({ machine, onPress, onLongPress }) => {
  const st = STATE_STYLES[machine.state];
  return (
    <Pressable style={styles.card} onPress={onPress} onLongPress={onLongPress}>
      <View style={styles.cardHead}>
        <Text style={styles.machineId}>{machine.id}</Text>
        <View style={[styles.pill, { backgroundColor: st.bg }]}>
          <Text style={[styles.pillText, { color: st.fg }]}>{st.label}</Text>
        </View>
      </View>

      {machine.state === 'RUNNING' && (
        <Text style={styles.countdown}>{formatCountdown(machine.remainingSec)}</Text>
      )}
      {machine.ticketNo && (
        <View style={{ marginTop: spacing.s2 }}>
          <Text style={styles.cardTicket}>{machine.ticketNo}</Text>
          <Text style={styles.cardCustomer}>{machine.customerName}</Text>
        </View>
      )}
      {machine.state === 'IDLE' && (
        <Text style={styles.cardHint}>Tap to assign a ticket</Text>
      )}
      {machine.state === 'OUT_OF_SERVICE' && (
        <Text style={styles.cardHint}>Long-press to return to service</Text>
      )}
    </Pressable>
  );
};

const AssignSheetContent: React.FC<{
  machine: Machine;
  queue: QueuedTicket[];
  onAssign: (t: QueuedTicket, mins: number) => void;
}> = ({ machine, queue, onAssign }) => {
  const [picked, setPicked] = React.useState<QueuedTicket | null>(queue[0] ?? null);
  const [mins, setMins] = React.useState(machine.kind === 'WASHER' ? 35 : 40);

  return (
    <View>
      <Text style={styles.sheetTitle}>Assign to {machine.id}</Text>
      <Text style={styles.sub}>Pick a queued ticket and a run duration.</Text>

      <Text style={styles.fieldLabel}>Queue</Text>
      {queue.length === 0 && <Text style={styles.emptyHint}>Queue is empty.</Text>}
      {queue.map((t) => {
        const active = picked?.ticketNo === t.ticketNo;
        return (
          <Pressable
            key={t.ticketNo}
            onPress={() => setPicked(t)}
            style={[styles.queuePick, active && styles.queuePickActive]}
          >
            <Text style={[styles.queueTicket, active && { color: colors.onPrimary }]}>{t.ticketNo}</Text>
            <Text style={[styles.queueMeta, active && { color: colors.onPrimary }]}>
              {t.customerName} · {t.loadKind}
            </Text>
          </Pressable>
        );
      })}

      <Text style={styles.fieldLabel}>Run for</Text>
      <View style={{ flexDirection: 'row', gap: spacing.s2, flexWrap: 'wrap' }}>
        {[20, 30, 35, 40, 50, 60].map((m) => {
          const active = m === mins;
          return (
            <Pressable
              key={m}
              onPress={() => setMins(m)}
              style={[styles.minChip, active && styles.minChipActive]}
            >
              <Text style={[styles.minChipText, active && { color: colors.onPrimary }]}>{m} min</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        disabled={!picked}
        onPress={() => picked && onAssign(picked, mins)}
        style={[styles.primaryCta, !picked && styles.primaryCtaDisabled, { marginTop: spacing.s5 }]}
      >
        <Text style={styles.primaryCtaText}>Start {machine.id}</Text>
      </Pressable>
    </View>
  );
};

// ---------- styles ----------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    paddingHorizontal: spacing.s5, paddingVertical: spacing.s4,
    borderBottomWidth: 1, borderBottomColor: colors.rule,
    backgroundColor: colors.surface,
  },
  title: { ...text.displayLg, color: colors.ink },
  sub: { ...text.bodySm, color: colors.muted, marginTop: spacing.s1 },

  body: { flex: 1, flexDirection: 'row' },
  gridCol: { flex: 1 },
  gridContent: { padding: spacing.s5 },

  sectionTitle: { ...text.displaySm, color: colors.ink, marginBottom: spacing.s3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s4 },

  card: {
    width: 200,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.rule,
    padding: spacing.s4,
    ...elevation.e1,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  machineId: { ...text.displayMd, color: colors.ink },
  pill: {
    paddingHorizontal: spacing.s2, paddingVertical: 4,
    borderRadius: radii.pill,
  },
  pillText: { ...text.caption, fontWeight: '700', textTransform: 'uppercase' },
  countdown: {
    ...text.displayMd,
    color: colors.infoDeep,
    marginTop: spacing.s3,
    fontVariant: ['tabular-nums'],
  },
  cardTicket: { ...text.bodySm, color: colors.ink, fontWeight: '700' },
  cardCustomer: { ...text.caption, color: colors.muted, marginTop: 2 },
  cardHint: { ...text.caption, color: colors.faint, marginTop: spacing.s3 },

  // queue rail
  queueRail: {
    width: 320,
    backgroundColor: colors.creamSoft,
    borderLeftWidth: 1, borderLeftColor: colors.rule,
    padding: spacing.s4,
  },
  queueTitle: { ...text.displaySm, color: colors.ink, marginBottom: spacing.s3 },
  queueRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.s3,
    paddingVertical: spacing.s3,
    borderBottomWidth: 1, borderBottomColor: colors.rule,
  },
  queueNo: {
    width: 28, height: 28, borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  queueNoText: { ...text.caption, color: colors.onPrimary, fontWeight: '700' },
  queueTicket: { ...text.bodySm, color: colors.ink, fontWeight: '700' },
  queueMeta: { ...text.caption, color: colors.muted, marginTop: 2 },

  // sheet
  sheet: { padding: spacing.s5 },
  sheetTitle: { ...text.displayMd, color: colors.ink },
  fieldLabel: { ...text.caption, color: colors.muted, marginTop: spacing.s4, marginBottom: spacing.s2, textTransform: 'uppercase', fontWeight: '700' },
  queuePick: {
    padding: spacing.s3,
    borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.rule,
    backgroundColor: colors.surface,
    marginBottom: spacing.s2,
  },
  queuePickActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  minChip: {
    paddingHorizontal: spacing.s3, paddingVertical: spacing.s2,
    borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  minChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  minChipText: { ...text.bodySm, color: colors.ink, fontWeight: '600' },

  emptyHint: { ...text.bodySm, color: colors.faint, paddingVertical: spacing.s3 },

  primaryCta: {
    backgroundColor: colors.primary,
    height: tap.cashierPrimary,
    borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryCtaDisabled: { backgroundColor: colors.ruleStrong },
  primaryCtaText: { ...text.cashierLg, color: colors.onPrimary },
});

export default FleetScreen;
