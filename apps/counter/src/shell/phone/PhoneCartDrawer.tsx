/**
 * Clerque Counter — Phone Cart (full-screen)
 *
 * Phone replacement for the tablet 3rd-pane cart panel. Per design P-05/P-06:
 *  • Header with back chevron + "Order" title
 *  • FlatList of lines — thumbnail + name + indented modifiers, qty stepper,
 *    line price. Swipe-left exposes a red "Remove" action.
 *  • Totals card at the bottom (subtotal, discount, VAT, divider, total)
 *  • Sticky 64dp "Charge ₱X" CTA at the bottom
 *
 * CTA delegates to the shared `openTendering()` host so the payment +
 * receipt flow is identical to tablet.
 */
import React, { useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Swipeable, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { useCartStore } from '@/terminal/cartStore';
import { openTendering } from '@/payment/TenderingHost';
import { formatPeso } from '@/components/Money';
import { useIsShiftOpen } from '@/shift/ShiftProvider';
import NoShiftSheet from '@/shift/NoShiftSheet';
import { colors, fonts, radii, spacing, text as textTokens, tnum } from '@/theme';
import type { PhoneSellStackParamList } from '@/shell/phone/types';
import type { CartState, CartLine } from '@/types';

type Props = NativeStackScreenProps<PhoneSellStackParamList, 'Cart'>;

export default function PhoneCartDrawer({ navigation }: Props): React.ReactElement {
  const lines = useCartStore((s) => s.lines);
  const subtotal = useCartStore((s) => s.subtotal());
  const discount = useCartStore((s) => s.discountTotal());
  const vat = useCartStore((s) => s.vatAmount());
  const total = useCartStore((s) => s.total());
  const setQty = useCartStore((s) => s.setQty);
  const removeLine = useCartStore((s) => s.removeLine);
  const applyDiscount = useCartStore((s) => s.applyDiscount);
  const clear = useCartStore((s) => s.clear);
  const customer = useCartStore((s) => s.customer);

  const [discountSheet, setDiscountSheet] = useState(false);
  const [noShiftSheet, setNoShiftSheet]   = useState(false);
  const shiftIsOpen = useIsShiftOpen();

  const active = lines.filter((l) => !l.removed && !l.voidedAt);

  /** Apply a tax-status-aware discount kind to every active line.
   *  SENIOR / PWD = 20% legally fixed.
   *  MARKDOWN     = 50% default (bakery end-of-day) — NOT VAT-exempt. */
  const setBulkDiscount = (kind: 'SENIOR' | 'PWD' | 'MARKDOWN' | null) => {
    setDiscountSheet(false);
    for (const l of active) {
      if (kind === null) {
        applyDiscount(l.id, undefined);
      } else if (kind === 'MARKDOWN') {
        applyDiscount(l.id, { kind, percent: 50 });
      } else {
        applyDiscount(l.id, { kind, percent: 20 });
      }
    }
  };
  const currentDiscountKind: 'SENIOR' | 'PWD' | 'MARKDOWN' | null = (() => {
    if (active.length === 0) return null;
    const first = active[0].discount?.kind;
    if (!first || first === 'MANUAL') return null;
    const everyMatches = active.every((l) => l.discount?.kind === first);
    return everyMatches ? (first as 'SENIOR' | 'PWD' | 'MARKDOWN') : null;
  })();
  // Track open swipeables so opening one closes the others.
  const swipeRefs = useRef<Map<string, Swipeable>>(new Map());
  const insets = useSafeAreaInsets();

  const onCharge = async () => {
    if (total <= 0) return;
    // Hard-block until shift is open — Z-read needs the opening float to
    // reconcile cash variance; without it BIR audit posture breaks.
    if (!shiftIsOpen) {
      setNoShiftSheet(true);
      return;
    }
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
    <GestureHandlerRootView style={styles.root}>
      <PhoneHeader title="Order" onBack={() => navigation.goBack()} />

      <FlatList<CartLine>
        data={active}
        keyExtractor={(l) => l.id}
        contentContainerStyle={styles.scroll}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="cart-outline" size={48} color={colors.faint} />
            <Text style={styles.emptyTitle}>No items yet</Text>
            <Text style={styles.emptySub}>Pick a product to start a new order.</Text>
            <Pressable
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [styles.emptyCta, pressed && { opacity: 0.9 }]}
            >
              <MaterialCommunityIcons name="plus" size={16} color={colors.onPrimary} />
              <Text style={styles.emptyCtaLabel}>Pick a product</Text>
            </Pressable>
          </View>
        }
        ListFooterComponent={
          active.length > 0 ? (
            <>
              {/* Action rows — Discount, Customer */}
              <View style={styles.actionList}>
                <Pressable
                  onPress={() => setDiscountSheet(true)}
                  style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
                >
                  <View style={styles.actionIconWrap}>
                    <MaterialCommunityIcons name="tag-outline" size={18} color={colors.primary} />
                  </View>
                  <Text style={styles.actionLabel}>Apply discount</Text>
                  <Text style={styles.actionValue}>
                    {currentDiscountKind === 'SENIOR' ? 'Senior 20%' :
                     currentDiscountKind === 'PWD' ? 'PWD 20%' :
                     currentDiscountKind === 'MARKDOWN' ? 'EOD 50%' :
                     'None'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} />
                </Pressable>

                <View style={styles.actionDivider} />

                <Pressable
                  onPress={() => { /* TODO: customer picker — backend search hook pending */ }}
                  style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
                >
                  <View style={styles.actionIconWrap}>
                    <MaterialCommunityIcons name="account-outline" size={18} color={colors.primary} />
                  </View>
                  <Text style={styles.actionLabel}>Add customer</Text>
                  <Text style={styles.actionValue} numberOfLines={1}>
                    {customer?.name ?? 'None'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} />
                </Pressable>
              </View>

              <View style={styles.totals}>
                <Row label="Subtotal" value={formatPeso(subtotal)} muted />
                {discount > 0 ? (
                  <Row label="Discount" value={`− ${formatPeso(discount)}`} muted />
                ) : null}
                <Row label="VAT (incl.)" value={formatPeso(vat)} muted />
                <View style={styles.divider} />
                <Row label="Total" value={formatPeso(total)} big />
              </View>
            </>
          ) : null
        }
        renderItem={({ item: l }) => (
          <Swipeable
            ref={(ref) => {
              if (ref) swipeRefs.current.set(l.id, ref);
              else swipeRefs.current.delete(l.id);
            }}
            onSwipeableWillOpen={() => {
              for (const [id, s] of swipeRefs.current) {
                if (id !== l.id) s.close();
              }
            }}
            renderRightActions={() => (
              <Pressable
                onPress={() => removeLine(l.id)}
                style={styles.swipeAction}
              >
                <MaterialCommunityIcons name="delete-outline" size={22} color={colors.onPrimary} />
                <Text style={styles.swipeActionLabel}>Remove</Text>
              </Pressable>
            )}
          >
            <View style={styles.line}>
              <View style={styles.lineThumb}>
                <Text style={styles.lineThumbText}>
                  {l.productName.slice(0, 2).toUpperCase()}
                </Text>
              </View>

              <View style={styles.lineMain}>
                <Text style={styles.lineName} numberOfLines={1}>{l.productName}</Text>
                {l.modifiers.map((m) => (
                  <Text key={m.optionId} style={styles.lineMod} numberOfLines={1}>
                    + {m.optionName}
                    {m.priceAdjustment !== 0 ? ` (${formatPeso(m.priceAdjustment)})` : ''}
                  </Text>
                ))}
                <Text style={[styles.lineUnit, tnum]}>{formatPeso(l.unitPrice)} ea</Text>
              </View>

              <View style={styles.qtyWrap}>
                <Pressable
                  onPress={() => {
                    if (l.qty <= 1) removeLine(l.id);
                    else setQty(l.id, l.qty - 1);
                  }}
                  style={styles.qtyBtn}
                  hitSlop={6}
                >
                  <MaterialCommunityIcons name="minus" size={18} color={colors.ink} />
                </Pressable>
                <Text style={[styles.qty, tnum]}>{l.qty}</Text>
                <Pressable
                  onPress={() => setQty(l.id, l.qty + 1)}
                  style={styles.qtyBtn}
                  hitSlop={6}
                >
                  <MaterialCommunityIcons name="plus" size={18} color={colors.ink} />
                </Pressable>
              </View>

              <Text style={[styles.linePrice, tnum]}>{formatPeso(l.lineTotal)}</Text>
            </View>
          </Swipeable>
        )}
      />

      {/* No-shift gate */}
      <NoShiftSheet
        visible={noShiftSheet}
        onCancel={() => setNoShiftSheet(false)}
        onGoToShift={() => {
          setNoShiftSheet(false);
          // Nav up to the bottom-tab navigator and switch to Shift.
          // getParent() walks past the Sell stack to the tab navigator.
          const tabNav = navigation.getParent();
          if (tabNav) {
            (tabNav as unknown as { navigate: (s: string) => void }).navigate('Shift');
          }
        }}
      />

      {/* Discount picker sheet */}
      <Modal
        visible={discountSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setDiscountSheet(false)}
      >
        <Pressable style={styles.modalScrim} onPress={() => setDiscountSheet(false)}>
          <Pressable style={styles.modalSheet} onPress={() => { /* swallow taps inside */ }}>
            <Text style={styles.modalTitle}>Apply discount</Text>
            <Text style={styles.modalSub}>Applies to every active item in this order.</Text>

            <DiscountPick
              label="Senior citizen · 20%"
              hint="VAT-exempt under RA 9994."
              active={currentDiscountKind === 'SENIOR'}
              onPress={() => setBulkDiscount('SENIOR')}
            />
            <DiscountPick
              label="PWD · 20%"
              hint="VAT-exempt under RA 10754."
              active={currentDiscountKind === 'PWD'}
              onPress={() => setBulkDiscount('PWD')}
            />
            <DiscountPick
              label="End-of-day · 50%"
              hint="Bakery markdown on near-expiry bread. VAT still applies."
              active={currentDiscountKind === 'MARKDOWN'}
              onPress={() => setBulkDiscount('MARKDOWN')}
            />
            <DiscountPick
              label="No discount"
              hint="Clears every line."
              active={currentDiscountKind === null}
              onPress={() => setBulkDiscount(null)}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <View style={[styles.ctaWrap, { paddingBottom: spacing.s5 + insets.bottom }]}>
        <Pressable
          onPress={onCharge}
          disabled={total <= 0}
          style={[styles.cta, total <= 0 && styles.ctaDisabled]}
        >
          <Text style={styles.ctaLabel}>Charge</Text>
          <Text style={[styles.ctaPrice, tnum]}>{formatPeso(total)}</Text>
        </Pressable>
      </View>
    </GestureHandlerRootView>
  );
}

function DiscountPick({
  label, hint, active, onPress,
}: { label: string; hint: string; active: boolean; onPress: () => void }): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.pickRow, active && styles.pickRowOn, pressed && { opacity: 0.85 }]}
    >
      <View style={[styles.pickRadio, active && styles.pickRadioOn]}>
        {active ? <View style={styles.pickRadioDot} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.pickLabel, active && styles.pickLabelOn]}>{label}</Text>
        <Text style={styles.pickHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

function Row({
  label, value, big, muted,
}: { label: string; value: string; big?: boolean; muted?: boolean }): React.ReactElement {
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

  empty: { paddingVertical: spacing.s8, alignItems: 'center', gap: spacing.s2 },
  emptyTitle: { ...textTokens.displaySm, color: colors.ink, fontSize: 16 },
  emptySub: { ...textTokens.bodySm, color: colors.muted },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.s5,
    paddingVertical: spacing.s3,
    borderRadius: radii.pill,
    marginTop: spacing.s3,
  },
  emptyCtaLabel: { ...textTokens.body, color: colors.onPrimary, fontWeight: '700' },

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s3,
    marginBottom: spacing.s2,
  },
  lineThumb: {
    width: 44, height: 44, borderRadius: radii.sm,
    backgroundColor: colors.creamDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  lineThumbText: { ...textTokens.displaySm, color: colors.ink, fontSize: 12 },
  lineMain: { flex: 1, minWidth: 0 },
  lineName: { ...textTokens.body, color: colors.ink, fontWeight: '700' },
  lineMod: { ...textTokens.caption, color: colors.muted, marginTop: 2, marginLeft: spacing.s2 },
  lineUnit: { ...textTokens.caption, color: colors.faint, marginTop: 2 },

  qtyWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  qtyBtn: {
    width: 30, height: 30, borderRadius: radii.sm,
    backgroundColor: colors.creamSoft,
    borderWidth: 1, borderColor: colors.rule,
    alignItems: 'center', justifyContent: 'center',
  },
  qty: { ...textTokens.body, color: colors.ink, minWidth: 22, textAlign: 'center', fontWeight: '700' },

  linePrice: { ...textTokens.body, color: colors.ink, fontWeight: '800', minWidth: 70, textAlign: 'right' },

  swipeAction: {
    backgroundColor: colors.error,
    width: 88,
    marginBottom: spacing.s2,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  swipeActionLabel: { color: colors.onPrimary, fontSize: 11, fontWeight: '700' },

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
  rowBig: { ...textTokens.displaySm, fontSize: 22, fontWeight: '800', color: colors.ink },
  divider: { height: 1, backgroundColor: colors.rule, marginVertical: spacing.s1 },

  // Action rows (Apply discount / Add customer)
  actionList: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    marginTop: spacing.s3,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
  },
  actionRowPressed: { backgroundColor: colors.creamSoft },
  actionIconWrap: {
    width: 32, height: 32, borderRadius: radii.sm,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { ...textTokens.body, color: colors.ink, fontWeight: '600', fontSize: 14, flex: 1 },
  actionValue: { ...textTokens.bodySm, color: colors.muted, fontSize: 13, maxWidth: 120, textAlign: 'right' },
  actionDivider: { height: 1, backgroundColor: colors.rule, marginHorizontal: spacing.s4 },

  // Discount picker modal
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(31,27,22,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.s5,
    gap: spacing.s2,
    paddingBottom: spacing.s7,
  },
  modalTitle: { fontFamily: fonts.displayBold, fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 2 },
  modalSub:   { ...textTokens.bodySm, color: colors.muted, marginBottom: spacing.s3 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    paddingVertical: spacing.s3,
    paddingHorizontal: spacing.s4,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  pickRowOn: { backgroundColor: colors.primaryContainer, borderColor: colors.primary },
  pickRadio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1.5, borderColor: colors.ruleStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  pickRadioOn: { borderColor: colors.primary },
  pickRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  pickLabel:    { ...textTokens.body, color: colors.ink, fontWeight: '700' },
  pickLabelOn:  { color: colors.primaryPress },
  pickHint:     { ...textTokens.caption, color: colors.muted, marginTop: 2 },

  ctaWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.rule,
    padding: spacing.s3,
    paddingBottom: spacing.s5,
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
