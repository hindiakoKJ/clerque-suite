/**
 * Clerque Counter — Phone Modifier picker (P-06)
 *
 * Full-screen takeover (NOT a bottom sheet, unlike tablet). Groups stacked
 * vertically with option chips; required groups validate before "Add".
 * Big 64dp CTA at bottom with live total.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { useBranchContext } from '@/api/BranchContext';
import { usePosCatalog, type ApiProduct } from '@/api/queries';
import { useCartStore } from '@/terminal/cartStore';
import { formatPeso } from '@/components/Money';
import { colors, radii, spacing, text as textTokens, tnum } from '@/theme';
import type { PhoneSellStackParamList } from '@/shell/phone/types';
import type { CartModifier } from '@/types';

type Props = NativeStackScreenProps<PhoneSellStackParamList, 'Modifier'>;

function priceToCents(p: number | string): number {
  if (typeof p === 'string') return Math.round(parseFloat(p) * 100);
  return Math.round(p * 100);
}
function adjToCents(p: number | string): number {
  if (typeof p === 'string') return Math.round(parseFloat(p) * 100);
  return Math.round(p * 100);
}

export default function PhoneModifierScreen({ route, navigation }: Props): React.ReactElement {
  const { activeBranch } = useBranchContext();
  const catalog = usePosCatalog(activeBranch?.id);
  const addLine = useCartStore((s) => s.addLine);

  const product: ApiProduct | undefined = catalog.data?.find((p) => p.id === route.params.productId);
  const groups = product?.modifierGroups ?? [];

  // selection[groupId] = Set<optionId>
  const [selection, setSelection] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {};
    for (const pg of groups) {
      const g = pg.modifierGroup;
      const defaults = g.options.filter((o) => o.isDefault).map((o) => o.id);
      init[g.id] = new Set(defaults);
    }
    return init;
  });

  const toggle = (groupId: string, optionId: string, multi: boolean) => {
    setSelection((prev) => {
      const cur = new Set(prev[groupId] ?? []);
      if (multi) {
        if (cur.has(optionId)) cur.delete(optionId); else cur.add(optionId);
      } else {
        cur.clear();
        cur.add(optionId);
      }
      return { ...prev, [groupId]: cur };
    });
  };

  const { modifiers, surcharge, missing } = useMemo(() => {
    let surchargeCents = 0;
    const mods: CartModifier[] = [];
    const missingGroups: string[] = [];
    for (const pg of groups) {
      const g = pg.modifierGroup;
      const sel = selection[g.id] ?? new Set<string>();
      if (g.required && sel.size === 0) missingGroups.push(g.name);
      for (const o of g.options) {
        if (!sel.has(o.id)) continue;
        const adj = adjToCents(o.priceAdjustment);
        surchargeCents += adj;
        mods.push({
          groupId: g.id,
          groupName: g.name,
          optionId: o.id,
          optionName: o.name,
          priceAdjustment: adj,
        });
      }
    }
    return { modifiers: mods, surcharge: surchargeCents, missing: missingGroups };
  }, [groups, selection]);

  const basePrice = product ? priceToCents(product.price) : 0;
  const lineTotal = basePrice + surcharge;
  const canAdd = product && missing.length === 0;

  const onAdd = () => {
    if (!product || !canAdd) return;
    addLine({
      productId: product.id,
      productName: product.name,
      qty: 1,
      unitPrice: basePrice,
      modifiers,
    });
    navigation.goBack();
  };

  if (!product) {
    return (
      <View style={styles.root}>
        <PhoneHeader title="Modifier" onBack={() => navigation.goBack()} />
        <Text style={styles.empty}>Product not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <PhoneHeader title={product.name} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.basePrice}>Base · {formatPeso(basePrice)}</Text>

        {groups.map((pg) => {
          const g = pg.modifierGroup;
          const multi = !!g.multiSelect || (g.maxSelect != null && g.maxSelect > 1);
          const sel = selection[g.id] ?? new Set<string>();
          return (
            <View key={g.id} style={styles.group}>
              <View style={styles.groupHead}>
                <Text style={styles.groupTitle}>{g.name}</Text>
                {g.required ? <Text style={styles.required}>Required</Text> : null}
              </View>
              <View style={styles.chipRow}>
                {g.options.map((o) => {
                  const on = sel.has(o.id);
                  const adj = adjToCents(o.priceAdjustment);
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => toggle(g.id, o.id, multi)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{o.name}</Text>
                      {adj !== 0 ? (
                        <Text style={[styles.chipAdj, on && styles.chipLabelOn]}>
                          {adj > 0 ? '+' : ''}{formatPeso(adj)}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.ctaWrap}>
        {missing.length > 0 ? (
          <Text style={styles.missing}>Pick: {missing.join(', ')}</Text>
        ) : null}
        <Pressable
          onPress={onAdd}
          disabled={!canAdd}
          style={[styles.cta, !canAdd && styles.ctaDisabled]}
        >
          <Text style={styles.ctaLabel}>Add to cart</Text>
          <Text style={[styles.ctaPrice, tnum]}>{formatPeso(lineTotal)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.s4, paddingBottom: 120, gap: spacing.s3 },
  basePrice: { ...textTokens.bodySm, color: colors.muted },
  empty: { ...textTokens.body, color: colors.muted, padding: spacing.s5, textAlign: 'center' },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s4,
    gap: spacing.s3,
  },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  groupTitle: { ...textTokens.displaySm, color: colors.ink, fontSize: 16 },
  required: { ...textTokens.caption, color: colors.warningDeep, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s2 },
  chip: {
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
    borderRadius: radii.pill,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
    flexDirection: 'row',
    gap: spacing.s2,
    alignItems: 'center',
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { ...textTokens.body, color: colors.ink, fontWeight: '600' },
  chipLabelOn: { color: colors.onPrimary },
  chipAdj: { ...textTokens.caption, color: colors.muted, fontWeight: '700' },
  ctaWrap: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    padding: spacing.s3,
    gap: spacing.s2,
  },
  missing: { ...textTokens.caption, color: colors.warningDeep, textAlign: 'center' },
  cta: {
    height: 64,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.s5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ctaDisabled: { backgroundColor: colors.faint },
  ctaLabel: { color: colors.onPrimary, fontWeight: '800', fontSize: 17 },
  ctaPrice: { color: colors.onPrimary, fontWeight: '800', fontSize: 17 },
});
