/**
 * Clerque Counter — Phone Approvals (P-15)
 *
 * Matches design-source-v3/phone-414x900.html P-15:
 *  • Header "Approvals · N"
 *  • Cards with left-border accent (error for VOID, warning for REFUND)
 *  • Top row: kind badge + REQ-id mono on right
 *  • Title (16dp display bold)
 *  • Reason block ("Order #X · reason: <reason>")
 *  • Requested-by line with time-ago
 *  • Bottom: Approve (primary/destructive) + Deny ghost
 *  • Empty state: dashed cream card "No more pending approvals"
 *
 * Wired to GET /void-approvals?status=PENDING +
 *           PATCH /void-approvals/:id/approve and /reject
 */
import React from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { api, ApiHttpError } from '@/api/client';
import { formatPeso } from '@/components/Money';
import { openSupervisorPin } from '@/auth/openSupervisorPin';
import { colors, radii, spacing, text as textTokens, tnum } from '@/theme';

type ApprovalKind = 'VOID' | 'REFUND';

interface VoidApproval {
  id: string;
  orderNumber?: string | number;
  amountCents?: number;
  reason?: string;
  kind?: ApprovalKind;
  cashierName?: string;
  createdAt: string;
}

interface Props {
  onBack?: () => void;
}

function timeAgo(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const sec = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    return `${hr}h ago`;
  } catch {
    return '';
  }
}

export default function PhoneApprovalsScreen({ onBack }: Props): React.ReactElement {
  const qc = useQueryClient();

  const list = useQuery<VoidApproval[]>({
    queryKey: ['void-approvals', 'PENDING'],
    refetchInterval: 15_000,
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
    mutationFn: async (args: { id: string; action: 'approve' | 'reject'; supervisorId?: string }) => {
      const body = args.supervisorId ? { supervisorId: args.supervisorId } : {};
      return api.patch<VoidApproval>(`/void-approvals/${args.id}/${args.action}`, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['void-approvals'] });
    },
    onError: (e) => {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed');
    },
  });

  const handleApprove = React.useCallback(
    async (id: string, kind: ApprovalKind) => {
      try {
        const result = await openSupervisorPin({ reason: `Approve ${kind}` });
        if (!result) return; // cancelled
        mutate.mutate({ id, action: 'approve', supervisorId: result.supervisorId });
      } catch (err) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to verify PIN');
      }
    },
    [mutate],
  );

  const items = list.data ?? [];
  const count = items.length;

  return (
    <View style={styles.root}>
      <PhoneHeader
        title={count > 0 ? `Approvals · ${count}` : 'Approvals'}
        subtitle="Pending void / refund"
        onBack={onBack}
      />

      {list.isLoading && !list.data ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.scroll}
          refreshing={list.isFetching && !list.isLoading}
          onRefresh={() => list.refetch()}
          renderItem={({ item }) => {
            const kind: ApprovalKind = item.kind ?? 'VOID';
            const isVoid = kind === 'VOID';
            const accent = isVoid ? colors.error : colors.warning;
            return (
              <View style={[styles.card, { borderLeftColor: accent }]}>
                <View style={styles.cardHead}>
                  <View style={[styles.badge, isVoid ? styles.badgeError : styles.badgeWarn]}>
                    <View style={[styles.badgeDot, { backgroundColor: accent }]} />
                    <Text style={[styles.badgeText, { color: isVoid ? colors.errorDeep : colors.warningDeep }]}>
                      {kind} · pending {timeAgo(item.createdAt)}
                    </Text>
                  </View>
                  <Text style={styles.reqId}>REQ-{item.id.slice(-4).toUpperCase()}</Text>
                </View>

                <Text style={styles.title} numberOfLines={2}>
                  {isVoid ? 'Void' : 'Refund'} {item.amountCents != null ? formatPeso(item.amountCents) : ''}
                </Text>

                {item.orderNumber ? (
                  <Text style={styles.detail}>
                    Order #{String(item.orderNumber)} · reason:{' '}
                    <Text style={styles.detailBold}>{item.reason ?? 'Not given'}</Text>
                  </Text>
                ) : item.reason ? (
                  <Text style={styles.detail}>
                    Reason: <Text style={styles.detailBold}>{item.reason}</Text>
                  </Text>
                ) : null}

                <Text style={styles.requester}>
                  Requested by {item.cashierName ?? 'Cashier'}
                </Text>

                <View style={styles.actions}>
                  <Pressable
                    onPress={() => { void handleApprove(item.id, kind); }}
                    disabled={mutate.isPending}
                    style={[
                      styles.approveBtn,
                      isVoid ? styles.approveBtnDestructive : styles.approveBtnPrimary,
                    ]}
                  >
                    <Text style={styles.approveBtnLabel}>Approve · PIN required</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => mutate.mutate({ id: item.id, action: 'reject' })}
                    disabled={mutate.isPending}
                    style={styles.denyBtn}
                  >
                    <Text style={styles.denyBtnLabel}>Deny</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <MaterialCommunityIcons name="check-circle-outline" size={32} color={colors.success} />
              <Text style={styles.emptyTitle}>No approvals waiting</Text>
              <Text style={styles.emptySub}>
                Approved actions appear in Orders with the supervisor badge.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

// silence unused-import warning when tnum reference is removed
void tnum;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.s4, gap: spacing.s3 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    borderLeftWidth: 4,
    padding: spacing.s4,
    gap: spacing.s2,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  badgeError: { backgroundColor: colors.errorSoft },
  badgeWarn: { backgroundColor: colors.warningSoft },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  reqId: { fontFamily: 'JetBrainsMono_500Medium', fontSize: 10, color: colors.muted },

  title: { ...textTokens.displaySm, color: colors.ink, fontSize: 16, marginTop: 4 },
  detail: { ...textTokens.bodySm, color: colors.muted, lineHeight: 18 },
  detailBold: { color: colors.ink, fontWeight: '700' },
  requester: { ...textTokens.caption, color: colors.muted },

  actions: { flexDirection: 'row', gap: spacing.s2, marginTop: spacing.s2 },
  approveBtn: {
    flex: 1,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveBtnPrimary: { backgroundColor: colors.primary },
  approveBtnDestructive: { backgroundColor: colors.error },
  approveBtnLabel: { ...textTokens.body, color: colors.onPrimary, fontWeight: '800', fontSize: 13 },
  denyBtn: {
    height: 44,
    paddingHorizontal: spacing.s4,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  denyBtnLabel: { ...textTokens.body, color: colors.muted, fontWeight: '700', fontSize: 14 },

  emptyCard: {
    backgroundColor: colors.creamSoft,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.creamDeep,
    borderStyle: 'dashed',
    padding: spacing.s6,
    alignItems: 'center',
    gap: spacing.s2,
  },
  emptyTitle: { ...textTokens.body, color: colors.ink, fontWeight: '700' },
  emptySub: { ...textTokens.caption, color: colors.muted, textAlign: 'center' },
});
