/**
 * Clerque Counter — Phone Modifier picker (P-06)
 *
 * Matches design-source-v3/phone-414x900.html P-06:
 *  • Header back + "Customize · <name>" title + base price subtitle
 *  • Hero row at top: 64x64 thumb + name + tagline
 *  • Vertical group sections with uppercase eyebrow + "required" badge
 *  • Chip-style options with "+₱20" price hint on right
 *  • Selected chip = solid primary; unselected = cream-soft + rule border
 *  • Sticky bottom row with white surface: Cancel ghost + 52dp "Add to cart · ₱X"
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import type { CartModifier } from '@/types';

type Props = NativeStackScreenProps<PhoneSellStackParamList, 'Modifier'>;

function priceToCents(p: number | string): number {
  if (typeof p === 'string') return Math.round(parseFloat(p) * 100);
  return Math.round(p * 100);
}

export default function PhoneModifierScreen({ route, navigation }: Props): React.ReactElement {
  const { activeBranch } = useBranchContext();
  const catalog = usePosCatalog(activeBranch?.id);
  const addLine = useCartStore((s) => s.addLine);

  const product: ApiProduct | undefined = catalog.data?.find((p) => p.id === route.params.productId);
  const groups = product?.modifierGroups ?? [];

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
        const adj = priceToCents(o.priceAdjustment);
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
  const canAdd = !!product && missing.length === 0;

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
      <PhoneHeader
        title={`Customize · ${product.name}`}
        subtitle={`Base ${formatPeso(basePrice)}`}
        onBack={() => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroThumb}>
            <Text style={styles.heroThumbText}>
              {product.name.slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.heroName} numberOfLines={2}>{product.name}</Text>
            {product.sku ? <Text style={styles.heroSub}>{product.sku}</Text> : null}
          </View>
        </View>

        {groups.map((pg) => {
          const g = pg.modifierGroup;
          const multi = !!g.multiSelect || (g.maxSelect != null && g.maxSelect > 1);
          const sel = selection[g.id] ?? new Set<string>();
          return (
            <View key={g.id} style={styles.group}>
              <View style={styles.groupHead}>
                <Text style={styles.groupTitle}>{g.name.toUpperCase()}</Text>
                {g.required ? <Text style={styles.required}>required</Text> : null}
              </View>
              <View style={styles.chipRow}>
                {g.options.map((o) => {
                  const on = sel.has(o.id);
                  const adj = priceToCents(o.priceAdjustment);
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => toggle(g.id, o.id, multi)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <View style={[styles.chipRadio, on && styles.chipRadioOn]}>
                        {on ? <View style={styles.chipRadioDot} /> : null}
                      </View>
                      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{o.name}</Text>
                      {adj !== 0 ? (
                        <Text style={[styles.chipAdj, on && styles.chipAdjOn, tnum]}>
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
          <Text style={styles.missing}>
            <MaterialCommunityIcons name="alert-circle-outline" size={12} color={colors.warningDeep} />
            {' '}Pick {missing.join(', ')}
          </Text>
        ) : null}
        <View style={styles.ctaRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.cancelBtn}
          >
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.s4, paddingBottom: 140, gap: spacing.s4 },

  empty: { ...textTokens.body, color: colors.muted, padding: spacing.s7, textAlign: 'center' },

  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    paddingBottom: spacing.s3,
  },
  heroThumb: {
    width: 64, height: 64, borderRadius: radii.lg,
    backgroundColor: colors.creamDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  heroThumbText: { ...textTokens.displayMd, color: colors.ink, fontSize: 22 },
  heroName: { ...textTokens.displaySm, color: colors.ink, fontSize: 17 },
  heroSub: { ...textTokens.caption, color: colors.muted, marginTop: 2 },

  group: { gap: spacing.s2 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.s2 },
  groupTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 1.2,
  },
  required: { fontSize: 11, color: colors.error, fontWeight: '600' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s2 },
  chip: {
    minHeight: 38,
    paddingHorizontal: spacing.s3,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
    flexDirection: 'row',
    gap: spacing.s2,
    alignItems: 'center',
  },
  chipOn: { backgroundColor: colors.primaryContainer, borderColor: colors.primary },
  chipRadio: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 1.5, borderColor: colors.ruleStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  chipRadioOn: { borderColor: colors.primary },
  chipRadioDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.primary },
  chipLabel: { fontSize: 13, color: colors.ink, fontWeight: '600' },
  chipLabelOn: { color: colors.primaryInk, fontWeight: '700' },
  chipAdj: { fontSize: 11, color: colors.muted, fontWeight: '700' },
  chipAdjOn: { color: colors.primary },

  ctaWrap: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    padding: spacing.s3,
    paddingBottom: spacing.s5,
    gap: spacing.s2,
  },
  missing: { fontSize: 12, color: colors.warningDeep, textAlign: 'center', fontWeight: '600' },
  ctaRow: { flexDirection: 'row', gap: spacing.s2 },
  cancelBtn: {
    height: 52,
    paddingHorizontal: spacing.s5,
    borderRadius: radii.md,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: { ...textTokens.body, color: colors.ink, fontWeight: '700' },
  cta: {
    flex: 1,
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.s4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ctaDisabled: { backgroundColor: colors.faint },
  ctaLabel: { color: colors.onPrimary, fontWeight: '800', fontSize: 15 },
  ctaPrice: { color: colors.onPrimary, fontWeight: '800', fontSize: 15 },
});
