/**
 * Clerque Counter — Phone Approvals (P-15)
 *
 * Owner-facing queue of pending void/refund approval requests. Approve or
 * reject via PATCH endpoints (already shipped in Sprint 25 backend).
 */
import React from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { api, ApiHttpError } from '@/api/client';
import { formatPeso } from '@/components/Money';
import { colors, radii, spacing, text as textTokens, tnum } from '@/theme';

interface VoidApproval {
  id: string;
  orderNumber?: string;
  amountCents?: number;
  reason?: string;
  kind?: 'VOID' | 'REFUND';
  cashierName?: string;
  createdAt: string;
}

interface Props {
  onBack?: () => void;
}

export default function PhoneApprovalsScreen({ onBack }: Props): React.ReactElement {
  const qc = useQueryClient();

  const list = useQuery<VoidApproval[]>({
    queryKey: ['void-approvals', 'PENDING'],
    queryFn: async () => {
      try {
        const res = await api.get<VoidApproval[]>('/void-approvals?status=PENDING');
        return Array.isArray(res) ? res : [];
      } catch (err) {
        if (err instanceof ApiHttpError) return [];
        throw err;
      }
    },
  });

  const mutate = useMutation({
    mutationFn: async (args: { id: string; action: 'approve' | 'reject' }) => {
      return api.patch<VoidApproval>(`/void-approvals/${args.id}/${args.action}`, {});
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['void-approvals'] });
    },
    onError: (e) => {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed');
    },
  });

  return (
    <View style={styles.root}>
      <PhoneHeader title="Approvals" subtitle="Pending void / refund" onBack={onBack} />
      {list.isLoading ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={list.data ?? []}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.scroll}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.kind}>{item.kind ?? 'VOID'}</Text>
                <Text style={[styles.amount, tnum]}>
                  {item.amountCents != null ? formatPeso(item.amountCents) : '—'}
                </Text>
              </View>
              {item.orderNumber ? (
                <Text style={styles.order}>Order #{item.orderNumber}</Text>
              ) : null}
              {item.cashierName ? (
                <Text style={styles.sub}>From {item.cashierName}</Text>
              ) : null}
              {item.reason ? <Text style={styles.reason}>{item.reason}</Text> : null}
              <View style={styles.actions}>
                <Pressable
                  onPress={() => mutate.mutate({ id: item.id, action: 'reject' })}
                  style={[styles.btn, styles.btnReject]}
                >
                  <Text style={[styles.btnLabel, { color: colors.errorDeep }]}>Reject</Text>
                </Pressable>
                <Pressable
                  onPress={() => mutate.mutate({ id: item.id, action: 'approve' })}
                  style={[styles.btn, styles.btnApprove]}
                >
                  <Text style={[styles.btnLabel, { color: colors.onPrimary }]}>Approve</Text>
                </Pressable>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No pending approvals. Nice and quiet.</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.s4, gap: spacing.s3 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s4,
    gap: spacing.s2,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  kind: { ...textTokens.caption, color: colors.warningDeep, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  amount: { ...textTokens.displaySm, color: colors.ink, fontSize: 18 },
  order: { ...textTokens.body, color: colors.ink, fontWeight: '700' },
  sub: { ...textTokens.caption, color: colors.muted },
  reason: { ...textTokens.bodySm, color: colors.ink },
  actions: { flexDirection: 'row', gap: spacing.s2, marginTop: spacing.s2 },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnReject: { backgroundColor: colors.errorSoft, borderWidth: 1, borderColor: colors.errorSoft },
  btnApprove: { backgroundColor: colors.primary },
  btnLabel: { ...textTokens.body, fontWeight: '800' },
  empty: { ...textTokens.body, color: colors.muted, textAlign: 'center', padding: spacing.s6 },
});
