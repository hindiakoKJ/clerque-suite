/**
 * Clerque Counter — Phone Cart (full-screen)
 *
 * Phone replacement for the tablet 3rd-pane cart panel. Lists active lines
 * with qty steppers, indented modifiers, totals block, big "Charge ₱X"
 * 64dp CTA. CTA delegates to the existing `openTendering()` host so the
 * payment + receipt flow is identical to tablet.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { useCartStore } from '@/terminal/cartStore';
import { openTendering } from '@/payment/TenderingHost';
import { formatPeso } from '@/components/Money';
import { colors, radii, spacing, text as textTokens, tnum } from '@/theme';
import type { PhoneSellStackParamList } from '@/shell/phone/types';
import type { CartState } from '@/types';

type Props = NativeStackScreenProps<PhoneSellStackParamList, 'Cart'>;

export default function PhoneCartDrawer({ navigation }: Props): React.ReactElement {
  const lines = useCartStore((s) => s.lines);
  const subtotal = useCartStore((s) => s.subtotal());
  const discount = useCartStore((s) => s.discountTotal());
  const vat = useCartStore((s) => s.vatAmount());
  const total = useCartStore((s) => s.total());
  const setQty = useCartStore((s) => s.setQty);
  const removeLine = useCartStore((s) => s.removeLine);
  const clear = useCartStore((s) => s.clear);

  const active = lines.filter((l) => !l.removed && !l.voidedAt);

  const onCharge = async () => {
    if (total <= 0) return;
    const snapshot: CartState = useCartStore.getState();
    const res = await openTendering({
      cart: snapshot,
      totalCents: total,
      subtotalCents: subtotal,
      discountCents: discount,
    });
    if (res) {
      clear();
      navigation.popToTop();
      navigation.navigate('SellList' as never);
    }
  };

  return (
    <View style={styles.root}>
      <PhoneHeader title="Order" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {active.length === 0 ? (
          <Text style={styles.empty}>No items yet — go back and add some.</Text>
        ) : (
          active.map((l) => (
            <View key={l.id} style={styles.line}>
              <View style={styles.lineMain}>
                <Text style={styles.lineName}>{l.productName}</Text>
                {l.modifiers.map((m) => (
                  <Text key={m.optionId} style={styles.lineMod}>
                    + {m.optionName}
                    {m.priceAdjustment !== 0 ? ` (${formatPeso(m.priceAdjustment)})` : ''}
                  </Text>
                ))}
              </View>

              <View style={styles.qtyWrap}>
                <Pressable
                  onPress={() => {
                    if (l.qty <= 1) removeLine(l.id);
                    else setQty(l.id, l.qty - 1);
                  }}
                  style={styles.qtyBtn}
                >
                  <MaterialCommunityIcons name="minus" size={18} color={colors.ink} />
                </Pressable>
                <Text style={[styles.qty, tnum]}>{l.qty}</Text>
                <Pressable onPress={() => setQty(l.id, l.qty + 1)} style={styles.qtyBtn}>
                  <MaterialCommunityIcons name="plus" size={18} color={colors.ink} />
                </Pressable>
              </View>

              <Text style={[styles.linePrice, tnum]}>{formatPeso(l.lineTotal)}</Text>
            </View>
          ))
        )}

        {active.length > 0 ? (
          <View style={styles.totals}>
            <Row label="Subtotal" value={formatPeso(subtotal)} />
            {discount > 0 ? <Row label="Discount" value={`− ${formatPeso(discount)}`} /> : null}
            <Row label="VAT (incl.)" value={formatPeso(vat)} muted />
            <View style={styles.divider} />
            <Row label="Total" value={formatPeso(total)} big />
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.ctaWrap}>
        <Pressable
          onPress={onCharge}
          disabled={total <= 0}
          style={[styles.cta, total <= 0 && styles.ctaDisabled]}
        >
          <Text style={styles.ctaLabel}>Charge</Text>
          <Text style={[styles.ctaPrice, tnum]}>{formatPeso(total)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Row({ label, value, big, muted }: { label: string; value: string; big?: boolean; muted?: boolean }): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.rowMuted, big && styles.rowBig]}>{label}</Text>
      <Text style={[styles.rowValue, muted && styles.rowMuted, big && styles.rowBig, tnum]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.s4, paddingBottom: 120, gap: spacing.s2 },
  empty: { ...textTokens.body, color: colors.muted, textAlign: 'center', padding: spacing.s6 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s3,
  },
  lineMain: { flex: 1, minWidth: 0 },
  lineName: { ...textTokens.body, color: colors.ink, fontWeight: '700' },
  lineMod: { ...textTokens.caption, color: colors.muted, marginTop: 2, marginLeft: spacing.s2 },
  qtyWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  qtyBtn: {
    width: 32, height: 32, borderRadius: radii.sm,
    backgroundColor: colors.creamSoft,
    borderWidth: 1, borderColor: colors.rule,
    alignItems: 'center', justifyContent: 'center',
  },
  qty: { ...textTokens.body, color: colors.ink, minWidth: 24, textAlign: 'center', fontWeight: '700' },
  linePrice: { ...textTokens.body, color: colors.ink, fontWeight: '800', minWidth: 70, textAlign: 'right' },
  totals: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s4,
    gap: spacing.s2,
    marginTop: spacing.s3,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rowLabel: { ...textTokens.body, color: colors.ink },
  rowValue: { ...textTokens.body, color: colors.ink, fontWeight: '700' },
  rowMuted: { color: colors.muted },
  rowBig: { ...textTokens.displaySm, fontSize: 22, fontWeight: '800' },
  divider: { height: 1, backgroundColor: colors.rule, marginVertical: spacing.s1 },
  ctaWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.rule,
    padding: spacing.s3,
  },
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
  ctaLabel: { color: colors.onPrimary, fontWeight: '800', fontSize: 18 },
  ctaPrice: { color: colors.onPrimary, fontWeight: '800', fontSize: 22 },
});
