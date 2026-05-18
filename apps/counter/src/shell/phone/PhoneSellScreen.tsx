/**
 * Clerque Counter — Phone Sell (P-05)
 *
 * Matches design-source-v3/phone-414x900.html P-05:
 *  • Header (PhoneHeader) with brand + Order # subtitle
 *  • Search field with scan/magnify icon (sticky, white surface)
 *  • Horizontal category chips strip just below search
 *  • Single-column 72dp rows: thumbnail · name · price · add-circle
 *  • Low-stock badge inline on row subtitle (warning tone, bold)
 *  • Floating "View order (N) · ₱X" pill at bottom-right with blue glow
 *
 * Tap product with modifier groups → push <PhoneModifierScreen />.
 * Tap product without modifiers → addLine() instantly.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { useBranchContext } from '@/api/BranchContext';
import { usePosCatalog, type ApiProduct } from '@/api/queries';
import { useCartStore } from '@/terminal/cartStore';
import { formatPeso } from '@/components/Money';
import { getWebOrigin, getWebHost } from '@/api/webOrigin';
import { colors, radii, spacing, text as textTokens, tnum } from '@/theme';
import type { PhoneSellStackParamList } from '@/shell/phone/types';

type Props = NativeStackScreenProps<PhoneSellStackParamList, 'SellList'>;

const ALL_CATEGORY = '__all__';

function priceToCents(p: number | string): number {
  if (typeof p === 'string') return Math.round(parseFloat(p) * 100);
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
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORY);

  // Categories list from the catalog (unique by id, ordered by first-seen).
  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of catalog.data ?? []) {
      if (p.category && !seen.has(p.category.id)) {
        seen.set(p.category.id, p.category.name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [catalog.data]);

  const filtered = useMemo(() => {
    const all = catalog.data ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter((p) => {
      if (activeCat !== ALL_CATEGORY && p.categoryId !== activeCat) return false;
      if (!needle) return true;
      return p.name.toLowerCase().includes(needle)
        || (p.sku?.toLowerCase().includes(needle) ?? false)
        || (p.barcode?.toLowerCase().includes(needle) ?? false);
    });
  }, [catalog.data, q, activeCat]);

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

      {/* Search field */}
      <View style={styles.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search or scan barcode…"
          placeholderTextColor={colors.faint}
          style={styles.search}
          autoCorrect={false}
          autoCapitalize="none"
        />
        <MaterialCommunityIcons name="barcode-scan" size={20} color={colors.muted} />
      </View>

      {/* Category chips strip */}
      {categories.length > 0 ? (
        <View style={styles.chipsBar}>
          <FlatList
            horizontal
            data={[{ id: ALL_CATEGORY, name: 'All' }, ...categories]}
            keyExtractor={(c) => c.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContent}
            renderItem={({ item }) => {
              const on = item.id === activeCat;
              return (
                <Pressable
                  onPress={() => setActiveCat(item.id)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipLabel, on && styles.chipLabelOn]} numberOfLines={1}>
                    {item.name}
                  </Text>
                </Pressable>
              );
            }}
          />
        </View>
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => {
          const cents = priceToCents(item.price);
          const isLow = !!item.isLowStock;
          const oos = !!item.isOutOfStock;
          return (
            <Pressable
              onPress={() => onPickProduct(item)}
              disabled={oos}
              style={({ pressed }) => [
                styles.row,
                pressed && styles.rowPressed,
                oos && styles.rowDisabled,
              ]}
            >
              <View style={styles.thumb}>
                <Text style={styles.thumbText}>{item.name.slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
                <Text
                  style={[
                    styles.rowSub,
                    (isLow || oos) && styles.rowSubWarn,
                  ]}
                  numberOfLines={1}
                >
                  {oos
                    ? '✕ Out of stock'
                    : isLow
                      ? '⚠ Low stock'
                      : hasModifiers(item)
                        ? `${(item.modifierGroups ?? []).length} modifiers`
                        : (item.sku ?? 'No modifiers')}
                </Text>
              </View>
              <Text style={[styles.rowPrice, tnum]}>{formatPeso(cents)}</Text>
              <View style={styles.addBtn}>
                <MaterialCommunityIcons
                  name={hasModifiers(item) ? 'chevron-right' : 'plus'}
                  size={18}
                  color={colors.primaryInk}
                />
              </View>
            </Pressable>
          );
        }}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          catalog.isLoading ? (
            <View style={styles.center}><ActivityIndicator /></View>
          ) : q ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="magnify-close" size={48} color={colors.muted} />
              <Text style={styles.emptyTitle}>No products match</Text>
              <Text style={styles.emptyHint}>Try a different name, SKU, or barcode.</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons name="package-variant-closed" size={40} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>No products yet</Text>
              <Text style={styles.emptyHint}>
                Build your catalog on the web first — open{'\n'}
                <Text style={styles.emptyHintBold}>{getWebHost()}</Text> on a laptop or browser.
              </Text>
              <Pressable
                onPress={() => Linking.openURL(`${getWebOrigin()}/pos/products`).catch(() => {})}
                style={({ pressed }) => [styles.emptyCta, pressed && { opacity: 0.9 }]}
              >
                <MaterialCommunityIcons name="open-in-new" size={16} color={colors.onPrimary} />
                <Text style={styles.emptyCtaText}>Open products page</Text>
              </Pressable>
            </View>
          )
        }
      />

      {/* Floating "View order" CTA */}
      {lineCount > 0 ? (
        <Pressable
          onPress={() => navigation.navigate('Cart')}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.92 }]}
        >
          <View style={styles.ctaLeft}>
            <View style={styles.ctaCountBubble}>
              <Text style={styles.ctaCountText}>{lineCount}</Text>
            </View>
            <Text style={styles.ctaLabel}>View order</Text>
          </View>
          <Text style={[styles.ctaPrice, tnum]}>{formatPeso(total)} →</Text>
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

  chipsBar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  chipsContent: { paddingHorizontal: spacing.s4, paddingVertical: spacing.s2, gap: spacing.s2 },
  chip: {
    paddingHorizontal: spacing.s4,
    paddingVertical: 6,
    backgroundColor: colors.creamSoft,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.creamDeep,
    marginRight: spacing.s1,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: 12, fontWeight: '700', color: colors.muted },
  chipLabelOn: { color: colors.onPrimary },

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
  rowDisabled: { opacity: 0.5 },
  thumb: {
    width: 48, height: 48, borderRadius: radii.md,
    backgroundColor: colors.creamDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbText: { ...textTokens.displaySm, color: colors.ink, fontSize: 14 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { ...textTokens.body, color: colors.ink, fontWeight: '700', fontSize: 15 },
  rowSub: { ...textTokens.caption, color: colors.muted, marginTop: 2 },
  rowSubWarn: { color: colors.warningDeep, fontWeight: '700' },
  rowPrice: { ...textTokens.body, color: colors.primary, fontWeight: '800', fontSize: 16 },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center', justifyContent: 'center',
  },

  center: { padding: spacing.s7, alignItems: 'center' },
  empty: { ...textTokens.body, color: colors.muted, textAlign: 'center', padding: spacing.s7 },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.s8,
    paddingHorizontal: spacing.s5,
    gap: spacing.s3,
  },
  emptyIconWrap: {
    width: 72, height: 72,
    borderRadius: radii.xl,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.s2,
  },
  emptyTitle: { ...textTokens.displaySm, color: colors.ink, fontSize: 18, textAlign: 'center' },
  emptyHint: { ...textTokens.bodySm, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  emptyHintBold: { color: colors.ink, fontWeight: '700' },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.s5,
    paddingVertical: spacing.s3,
    borderRadius: radii.pill,
    marginTop: spacing.s4,
  },
  emptyCtaText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },

  cta: {
    position: 'absolute',
    left: spacing.s3, right: spacing.s3, bottom: spacing.s3,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: colors.primary,
    shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  ctaLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  ctaCountBubble: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  ctaCountText: { color: colors.onPrimary, fontWeight: '800', fontSize: 13 },
  ctaLabel: { color: colors.onPrimary, fontWeight: '800', fontSize: 15 },
  ctaPrice: { color: colors.onPrimary, fontWeight: '800', fontSize: 17 },
});
