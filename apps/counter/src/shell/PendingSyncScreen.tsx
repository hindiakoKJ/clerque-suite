/**
 * Clerque Counter — Pending sync (offline outbox)
 *
 * Lists rows in `sync_outbox` so the user can see exactly what hasn't
 * flushed yet. "Drain now" forces a flush attempt; "Clear failed"
 * removes rows that have already failed > 5 times.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import TopBar from '@/shell/TopBar';
import { useSync } from '@/offline/SyncProvider';
import { deleteOutbox, listOutbox, type OutboxRow } from '@/offline/db';
import { colors, radii, spacing, text as textTokens } from '@/theme';

interface Props {
  onMenuPress?: () => void;
}

export default function PendingSyncScreen({ onMenuPress }: Props): React.ReactElement {
  const { drainQueue, queuedCount, state } = useSync();
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await listOutbox(200);
      setRows(all);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, queuedCount]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleDrain = async () => {
    setBusy(true);
    try {
      await drainQueue();
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleClearFailed = async () => {
    setBusy(true);
    try {
      const failed = rows.filter((r) => r.attempts > 5);
      for (const r of failed) {
        await deleteOutbox(r.id);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const failedCount = rows.filter((r) => r.attempts > 5).length;

  return (
    <View style={styles.root}>
      <TopBar onMenuPress={onMenuPress} />

      <View style={styles.toolbar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.toolbarTitle}>{queuedCount} queued</Text>
          <Text style={styles.toolbarSub}>
            {state === 'syncing' ? 'Syncing now…' : state === 'offline' ? 'Offline' : 'Online'}
            {failedCount > 0 ? ` · ${failedCount} failed` : ''}
          </Text>
        </View>
        <Pressable
          disabled={busy || state === 'syncing'}
          onPress={handleDrain}
          style={({ pressed }) => [
            styles.toolBtn,
            (busy || state === 'syncing' || pressed) && { opacity: 0.7 },
          ]}
        >
          <MaterialCommunityIcons name="cloud-upload-outline" size={18} color={colors.onPrimary} />
          <Text style={styles.toolBtnLabel}>Drain now</Text>
        </Pressable>
        <Pressable
          disabled={busy || failedCount === 0}
          onPress={handleClearFailed}
          style={({ pressed }) => [
            styles.toolBtnSecondary,
            (busy || failedCount === 0 || pressed) && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.toolBtnSecondaryLabel}>Clear failed</Text>
        </Pressable>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="cloud-check-outline" size={48} color={colors.faint} />
            <Text style={styles.emptyTitle}>Outbox is empty</Text>
            <Text style={styles.emptySub}>Mutations queued while offline appear here.</Text>
          </View>
        }
        renderItem={({ item }) => <OutboxRowItem row={item} />}
      />
    </View>
  );
}

function OutboxRowItem({ row }: { row: OutboxRow }): React.ReactElement {
  const queued = new Date(row.created_at).toLocaleString();
  const isFailed = row.attempts > 5;
  return (
    <View style={[styles.row, isFailed && styles.rowFailed]}>
      <View style={styles.rowHead}>
        <Text style={styles.rowKind}>{row.kind}</Text>
        <View
          style={[
            styles.attemptsPill,
            isFailed && { backgroundColor: colors.errorSoft },
          ]}
        >
          <Text
            style={[
              styles.attemptsPillText,
              isFailed && { color: colors.errorDeep },
            ]}
          >
            {row.attempts} {row.attempts === 1 ? 'try' : 'tries'}
          </Text>
        </View>
      </View>
      <Text style={styles.rowMeta}>Queued {queued}</Text>
      {row.last_error ? (
        <Text style={styles.rowError} numberOfLines={2}>
          {row.last_error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  toolbarTitle: { ...textTokens.displaySm, color: colors.ink },
  toolbarSub: { ...textTokens.bodySm, color: colors.muted, marginTop: spacing.s1 },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  toolBtnLabel: { ...textTokens.body, color: colors.onPrimary, fontWeight: '700' },
  toolBtnSecondary: {
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  toolBtnSecondaryLabel: { ...textTokens.body, color: colors.ink, fontWeight: '600' },

  list: { padding: spacing.s4, gap: spacing.s3 },
  empty: { padding: spacing.s7, alignItems: 'center', gap: spacing.s2 },
  emptyTitle: { ...textTokens.bodyLg, color: colors.ink, fontWeight: '700', marginTop: spacing.s3 },
  emptySub: { ...textTokens.bodySm, color: colors.muted, textAlign: 'center' },

  row: {
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    marginBottom: spacing.s2,
  },
  rowFailed: { borderColor: colors.errorSoft },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowKind: { ...textTokens.mono, color: colors.ink, fontWeight: '700' },
  attemptsPill: {
    paddingHorizontal: spacing.s2,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.creamSoft,
  },
  attemptsPillText: { ...textTokens.caption, color: colors.muted, fontWeight: '700' },
  rowMeta: { ...textTokens.bodySm, color: colors.muted, marginTop: spacing.s2 },
  rowError: { ...textTokens.bodySm, color: colors.errorDeep, marginTop: spacing.s2 },
});
