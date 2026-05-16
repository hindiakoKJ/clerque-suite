import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import BottomSheet, { BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { colors, spacing, radii, text as textTokens, tap, tnum } from '@/theme/tokens';
import type { CartModifier } from '@/types';
import type { FBProduct, FBModifierGroup, FBModifierOption } from '../mockCatalog';
import { formatPeso } from '@/components/Money';

export interface ModifierSheetHandle {
  open: (product: FBProduct) => void;
  close: () => void;
}

interface Props {
  /** Called when the user confirms. Receives qty=1 plus chosen modifiers and computed line total. */
  onAdd: (args: { product: FBProduct; modifiers: CartModifier[]; lineTotal: number }) => void;
}

const ModifierSheet = forwardRef<ModifierSheetHandle, Props>(({ onAdd }, ref) => {
  const sheetRef = useRef<BottomSheet>(null);
  const [product, setProduct] = useState<FBProduct | null>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  useImperativeHandle(ref, () => ({
    open: (p: FBProduct) => {
      setProduct(p);
      // Pre-select required radio's first option.
      const init: Record<string, string[]> = {};
      (p.modifierGroups ?? []).forEach((g) => {
        if (g.required && g.min === 1 && g.max === 1 && g.options[0]) {
          init[g.id] = [g.options[0].id];
        } else {
          init[g.id] = [];
        }
      });
      setSelected(init);
      sheetRef.current?.expand();
    },
    close: () => sheetRef.current?.close(),
  }));

  const snapPoints = useMemo(() => ['85%'], []);

  const isRadio = (g: FBModifierGroup) => g.required && g.min === 1 && g.max === 1;

  const toggleOption = (group: FBModifierGroup, opt: FBModifierOption) => {
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      if (isRadio(group)) return { ...prev, [group.id]: [opt.id] };
      // checkbox
      const has = current.includes(opt.id);
      if (has) return { ...prev, [group.id]: current.filter((id) => id !== opt.id) };
      if (current.length >= group.max) return prev;
      return { ...prev, [group.id]: [...current, opt.id] };
    });
  };

  const flatModifiers: CartModifier[] = useMemo(() => {
    if (!product) return [];
    const out: CartModifier[] = [];
    (product.modifierGroups ?? []).forEach((g) => {
      const chosenIds = selected[g.id] ?? [];
      chosenIds.forEach((oid) => {
        const opt = g.options.find((o) => o.id === oid);
        if (opt) out.push({
          groupId: g.id, groupName: g.name,
          optionId: opt.id, optionName: opt.name,
          priceAdjustment: opt.priceAdjustment,
        });
      });
    });
    return out;
  }, [product, selected]);

  const lineTotal = useMemo(() => {
    if (!product) return 0;
    return product.price + flatModifiers.reduce((s, m) => s + m.priceAdjustment, 0);
  }, [product, flatModifiers]);

  const allRequiredMet = useMemo(() => {
    if (!product) return false;
    return (product.modifierGroups ?? []).every((g) => {
      if (!g.required) return true;
      const n = (selected[g.id] ?? []).length;
      return n >= g.min;
    });
  }, [product, selected]);

  const handleAdd = () => {
    if (!product || !allRequiredMet) return;
    onAdd({ product, modifiers: flatModifiers, lineTotal });
    sheetRef.current?.close();
  };

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} pressBehavior="close" />
    ),
    [],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.ruleStrong }}
    >
      {product && (
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={[textTokens.displaySm, { color: colors.ink }]}>{product.name}</Text>
            <Text style={[textTokens.body, tnum, { color: colors.primary, fontWeight: '700' }]}>
              {formatPeso(product.price)}
            </Text>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.s6 }}>
            {(product.modifierGroups ?? []).map((g) => {
              const radio = isRadio(g);
              return (
                <View key={g.id} style={styles.group}>
                  <View style={styles.groupHeader}>
                    <Text style={[textTokens.bodyLg, { fontWeight: '700', color: colors.ink }]}>
                      {g.name}
                    </Text>
                    <Text style={[textTokens.caption, { color: g.required ? colors.errorDeep : colors.muted }]}>
                      {g.required ? 'Required' : `Optional · choose up to ${g.max}`}
                    </Text>
                  </View>
                  <View style={styles.options}>
                    {g.options.map((opt) => {
                      const isSelected = (selected[g.id] ?? []).includes(opt.id);
                      return (
                        <Pressable
                          key={opt.id}
                          onPress={() => toggleOption(g, opt)}
                          style={[
                            styles.optionChip,
                            isSelected && styles.optionChipSelected,
                          ]}
                        >
                          <View style={[radio ? styles.radio : styles.check, isSelected && styles.markerOn]}>
                            {isSelected && <View style={radio ? styles.radioDot : styles.checkDot} />}
                          </View>
                          <Text style={[textTokens.body, { color: isSelected ? colors.primaryInk : colors.ink, fontWeight: '600' }]}>
                            {opt.name}
                          </Text>
                          {opt.priceAdjustment > 0 && (
                            <Text style={[textTokens.caption, tnum, { color: colors.muted, marginLeft: 'auto' }]}>
                              +{formatPeso(opt.priceAdjustment)}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={handleAdd}
            disabled={!allRequiredMet}
            style={({ pressed }) => [
              styles.cta,
              { opacity: !allRequiredMet ? 0.4 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.ctaText}>
              Add to cart — {formatPeso(lineTotal)}
            </Text>
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
});

ModifierSheet.displayName = 'ModifierSheet';
export default ModifierSheet;

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.s5, paddingTop: spacing.s2 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.s4,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    marginBottom: spacing.s4,
  },
  group: { marginBottom: spacing.s5 },
  groupHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'baseline', marginBottom: spacing.s3,
  },
  options: { gap: spacing.s2 },
  optionChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.s3,
    paddingVertical: spacing.s3, paddingHorizontal: spacing.s4,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  optionChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryContainer,
  },
  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: colors.ruleStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  check: {
    width: 22, height: 22, borderRadius: radii.xs,
    borderWidth: 2, borderColor: colors.ruleStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  markerOn: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  checkDot: { width: 12, height: 12, borderRadius: 2, backgroundColor: colors.primary },
  cta: {
    height: tap.cashierPrimary,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
    marginVertical: spacing.s4,
  },
  ctaText: { ...textTokens.cashierLg, color: colors.onPrimary },
});
