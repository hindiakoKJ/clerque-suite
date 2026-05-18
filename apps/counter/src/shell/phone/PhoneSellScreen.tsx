/**
 * Clerque Counter — Phone Sell (P-05)
 *
 * Single-column compact list. Search at top, 72dp tap rows, floating
 * "View order (N)" sticky CTA bottom-right. Tap a row that has modifier
 * groups → push <PhoneModifierScreen />. Tap a plain row → add to cart.
 *
 * Reuses the shared `useCartStore` (Zustand) so tablet + phone share state.
 * Reuses `usePosCatalog(branchId)` for the catalog.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { useBranchContext } from '@/api/BranchContext';
import { usePosCatalog, type ApiProduct } from '@/api/queries';
import { useCartStore } from '@/terminal/cartStore';
import { formatPeso } from '@/components/Money';
import { colors, radii, spacing, text as textTokens, tnum } from '@/theme';
import type { PhoneSellStackParamList } from '@/shell/phone/types';

type Props = NativeStackScreenProps<PhoneSellStackParamList, 'SellList'>;

function priceToCents(p: number | string): number {
  if (typeof p === 'string') return Math.round(parseFloat(p) * 100);
  // API may return pesos as number — assume pesos unless > 10000 (heuristic).
  return Math.round(p * 100);
}

function hasModifiers(p: ApiProduct): boolean {
  return Array.isArray(p.modifierGroups) && p.modifierGroups.length > 0;
}

export default function PhoneSellScreen({ navigation }: Props): React.ReactElement {
  const { activeBranch } = useBranchContext();
  const branchId = activeBranch?.id;
  const catalog = usePosCatalog(branchId);
  const addLine = useCartStore((s) => s.addLine);
  const lineCount = useCartStore((s) => s.lineCount());
  const total = useCartStore((s) => s.total());

  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const all = catalog.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((p) =>
      p.name.toLowerCase().includes(needle) ||
      (p.sku?.toLowerCase().includes(needle) ?? false) ||
      (p.barcode?.toLowerCase().includes(needle) ?? false),
    );
  }, [catalog.data, q]);

  const onPickProduct = (p: ApiProduct) => {
    if (hasModifiers(p)) {
      navigation.navigate('Modifier', { productId: p.id });
      return;
    }
    addLine({
      productId: p.id,
      productName: p.name,
      qty: 1,
      unitPrice: priceToCents(p.price),
    });
  };

  return (
    <View style={styles.root}>
      <PhoneHeader title="Sell" subtitle={activeBranch?.name ?? undefined} />
      <View style={styles.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search products or scan barcode…"
          placeholderTextColor={colors.faint}
          style={styles.search}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onPickProduct(item)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.thumb}>
              <Text style={styles.thumbText}>{item.name.slice(0, 2).toUpperCase()}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
              {item.sku || item.isLowStock ? (
                <Text style={styles.rowSub} numberOfLines={1}>
                  {item.isLowStock ? 'Low stock · ' : ''}{item.sku ?? ''}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.rowPrice, tnum]}>{formatPeso(priceToCents(item.price))}</Text>
            <View style={styles.addBtn}>
              <MaterialCommunityIcons
                name={hasModifiers(item) ? 'chevron-right' : 'plus'}
                size={20}
                color={colors.primaryInk}
              />
            </View>
          </Pressable>
        )}
        ItemSeparatorComponent={null}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {catalog.isLoading ? 'Loading…' : 'No products match'}
          </Text>
        }
      />

      {lineCount > 0 ? (
        <Pressable
          onPress={() => navigation.navigate('Cart')}
          style={styles.cta}
        >
          <Text style={styles.ctaLabel}>View order ({lineCount})</Text>
          <Text style={[styles.ctaPrice, tnum]}>{formatPeso(total)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s2,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  search: { flex: 1, ...textTokens.body, color: colors.ink, paddingVertical: spacing.s2 },
  listContent: { paddingBottom: 120 },
  row: {
    minHeight: 72,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  rowPressed: { backgroundColor: colors.creamSoft },
  thumb: {
    width: 48, height: 48, borderRadius: radii.md,
    backgroundColor: colors.creamDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbText: { ...textTokens.displaySm, color: colors.ink, fontSize: 14 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { ...textTokens.body, color: colors.ink, fontWeight: '700', fontSize: 15 },
  rowSub: { ...textTokens.caption, color: colors.muted, marginTop: 2 },
  rowPrice: { ...textTokens.body, color: colors.primary, fontWeight: '800', fontSize: 16 },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center', justifyContent: 'center',
  },
  empty: { ...textTokens.body, color: colors.muted, textAlign: 'center', padding: spacing.s6 },
  cta: {
    position: 'absolute',
    left: spacing.s3, right: spacing.s3, bottom: spacing.s3,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.s5, paddingVertical: spacing.s4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: colors.primary,
    shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ctaLabel: { color: colors.onPrimary, fontWeight: '800', fontSize: 16 },
  ctaPrice: { color: colors.onPrimary, fontWeight: '800', fontSize: 16 },
});
