/**
 * Clerque Counter — Dashboard
 *
 * Tenant-level KPI dashboard for cashier mode. Renders a compact card grid
 * with today's gross / order count / avg / top product / low-stock count /
 * open-shifts count. Data is pulled from `/reports/dashboard` keyed on the
 * active branch (BranchContext is owned by the live-API agent — we import
 * the hook by name and gracefully degrade when not wired yet).
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';

import { api, ApiHttpError } from '@/api/client';
import { useBranchContext } from '@/api/BranchContext';
import TopBar from '@/shell/TopBar';
import { formatPeso } from '@/components/Money';
import { colors, radii, spacing, text as textTokens, tnum } from '@/theme';

interface DashboardResponse {
  grossCents: number;
  orderCount: number;
  avgOrderCents: number;
  topProduct: { id: string; name: string; unitsSold: number } | null;
  lowStockCount: number;
  openShifts: number;
}

interface Props {
  onMenuPress?: () => void;
}

export default function DashboardScreen({ onMenuPress }: Props): React.ReactElement {
  const { activeBranch } = useBranchContext();
  const branchId = activeBranch?.id ?? null;

  const { data, isLoading, error } = useQuery<DashboardResponse>({
    queryKey: ['reports', 'dashboard', branchId, 'today'],
    queryFn: () =>
      api.get<DashboardResponse>(
        `/reports/dashboard?day=today${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ''}`,
      ),
    retry: 1,
  });

  return (
    <View style={styles.root}>
      <TopBar onMenuPress={onMenuPress} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Today</Text>
          {activeBranch?.name ? (
            <Text style={styles.sub}>{activeBranch.name}</Text>
          ) : null}
        </View>

        <View style={styles.grid}>
          <Kpi
            label="Gross"
            value={data ? formatPeso(data.grossCents) : '—'}
            big
            isLoading={isLoading}
            error={errorMsg(error)}
          />
          <Kpi
            label="Orders"
            value={data ? String(data.orderCount) : '—'}
            isLoading={isLoading}
            error={errorMsg(error)}
          />
          <Kpi
            label="Avg / order"
            value={data ? formatPeso(data.avgOrderCents) : '—'}
            isLoading={isLoading}
            error={errorMsg(error)}
          />
          <Kpi
            label="Top product"
            value={data?.topProduct?.name ?? '—'}
            sub={data?.topProduct ? `${data.topProduct.unitsSold} sold` : undefined}
            isLoading={isLoading}
            error={errorMsg(error)}
          />
          <Kpi
            label="Low-stock items"
            value={data ? String(data.lowStockCount) : '—'}
            pillTone={data && data.lowStockCount > 0 ? 'warning' : undefined}
            isLoading={isLoading}
            error={errorMsg(error)}
          />
          <Kpi
            label="Open shifts"
            value={data ? String(data.openShifts) : '—'}
            isLoading={isLoading}
            error={errorMsg(error)}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function errorMsg(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiHttpError) return err.status === 0 ? 'Offline' : 'No data yet';
  return 'No data yet';
}

interface KpiProps {
  label: string;
  value: string;
  sub?: string;
  big?: boolean;
  isLoading?: boolean;
  error?: string | null;
  pillTone?: 'warning';
}

function Kpi({ label, value, sub, big, isLoading, error, pillTone }: KpiProps): React.ReactElement {
  return (
    <Card style={[styles.card, big && styles.cardBig]} mode="elevated">
      <Card.Content style={styles.cardInner}>
        <Text style={styles.cardLabel}>{label}</Text>
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: spacing.s2 }} />
        ) : error ? (
          <Text style={styles.cardSkel}>{error}</Text>
        ) : (
          <>
            <Text style={[big ? styles.cardValueBig : styles.cardValue, tnum]} numberOfLines={1}>
              {value}
            </Text>
            {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
            {pillTone === 'warning' ? (
              <View style={styles.warnPill}>
                <Text style={styles.warnPillText}>Needs attention</Text>
              </View>
            ) : null}
          </>
        )}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.s5, gap: spacing.s4 },
  header: { marginBottom: spacing.s3 },
  title: { ...textTokens.displayLg, color: colors.ink },
  sub: { ...textTokens.bodySm, color: colors.muted, marginTop: spacing.s1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s3 },
  card: {
    minWidth: 220,
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
  },
  cardBig: { flexBasis: '45%' },
  cardInner: { paddingVertical: spacing.s4 },
  cardLabel: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase' },
  cardValue: { ...textTokens.displayMd, color: colors.ink, marginTop: spacing.s2 },
  cardValueBig: { ...textTokens.displayLg, color: colors.ink, marginTop: spacing.s2 },
  cardSub: { ...textTokens.bodySm, color: colors.muted, marginTop: spacing.s1 },
  cardSkel: { ...textTokens.body, color: colors.faint, marginTop: spacing.s2 },
  warnPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.s2,
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s1,
    borderRadius: radii.pill,
    backgroundColor: colors.warningSoft,
  },
  warnPillText: { ...textTokens.caption, color: colors.warningDeep, fontWeight: '700' },
});
