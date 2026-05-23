/**
 * Clerque Counter — Tendering Screen
 *
 * Full-screen modal opened from the Terminal's "Charge ₱X" CTA. Segmented
 * control across the top: Cash · GCash · PayMaya · Card · Split.
 *
 * Headers shows ₱total HUGE (tabular-nums), customer name (if set), and a
 * dining-mode chip for F&B.
 *
 * Each tab calls `onPaid` with the captured payments; the parent (Terminal
 * coordinator) then finalizes the cart, assigns an OR number, and routes to
 * the ReceiptScreen.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  colors,
  radii,
  spacing,
  text as textTokens,
  tnum,
} from '@/theme/tokens';
import { formatPeso } from '@/components/Money';
import Pill from '@/components/Pill';
import PhoneTenderingWizard from '@/payment/PhoneTenderingWizard';
import { useDeviceSize } from '@/shell/useDeviceSize';
import type { CartPayment, CartState } from '@/types';

import CashTab from './CashTab';
import GCashTab from './GCashTab';
import PayMayaTab from './PayMayaTab';
import CardTab from './CardTab';
import QrPhTab from './QrPhTab';
import SplitTab from './SplitTab';

export type TenderingTab = 'CASH' | 'GCASH' | 'PAYMAYA' | 'CARD' | 'QR_PH' | 'SPLIT';

export interface TenderingScreenProps {
  cart: CartState;
  /** ₱ cents — pre-computed by the cart store. */
  totalCents: number;
  /** ₱ cents — discount applied. Shown in the secondary header. */
  discountCents?: number;
  /** Order number preview (e.g. for the "Order #000125" header). */
  orderRef?: string;
  /** Cashier initials, shown in header. */
  cashierInitials?: string;
  initialTab?: TenderingTab;
  /** Cashier confirmed payment(s). Caller persists + routes to receipt. */
  onPaid: (payments: CartPayment[], changeCents: number) => void;
  onCancel: () => void;
}

const TABS: { id: TenderingTab; label: string; tint?: string }[] = [
  { id: 'CASH',    label: 'Cash · Bayad' },
  { id: 'GCASH',   label: 'GCash',   tint: colors.gcash   },
  { id: 'PAYMAYA', label: 'PayMaya', tint: colors.paymaya },
  { id: 'CARD',    label: 'Card' },
  { id: 'QR_PH',   label: 'QR PH' },
  { id: 'SPLIT',   label: 'Split' },
];

export default function TenderingScreen({
  cart,
  totalCents,
  discountCents = 0,
  orderRef,
  cashierInitials,
  initialTab = 'CASH',
  onPaid,
  onCancel,
}: TenderingScreenProps): React.ReactElement {
  const [tab, setTab] = useState<TenderingTab>(initialTab);
  const insets = useSafeAreaInsets();
  const isPhone = useDeviceSize() === 'phone';

  // On phone, the entire screen is the 3-step wizard — different IA than
  // the tablet single-screen tab grid.
  if (isPhone) {
    return (
      <PhoneTenderingWizard
        cart={cart}
        totalCents={totalCents}
        discountCents={discountCents}
        onPaid={onPaid}
        onCancel={onCancel}
      />
    );
  }

  const headerColor =
    tab === 'GCASH' ? colors.gcash :
    tab === 'PAYMAYA' ? colors.paymaya :
    colors.primary;

  return (
    <View style={s.root}>
      {/* HEADER — phone stacks; tablet keeps the wide 3-column layout */}
      {isPhone ? (
        <View style={[s.phoneHeader, { paddingTop: insets.top + spacing.s2 }]}>
          <View style={s.phoneHeaderRow}>
            <Pressable onPress={onCancel} style={s.back} hitSlop={8}>
              <Text style={s.backText}>←</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={s.phoneTitle}>Tendering · Bayad</Text>
              <Text style={s.subtle} numberOfLines={1}>
                {orderRef ? `Order ${orderRef} · ` : ''}
                {cart.lines.filter(l => !l.removed).length} items
                {cashierInitials ? ` · ${cashierInitials}` : ''}
              </Text>
            </View>
          </View>
          <View style={s.phoneAmountBlock}>
            <Text style={s.amountDueLabel}>Amount due</Text>
            <Text style={[s.amountDuePhone, tnum, { color: headerColor }]}>
              {formatPeso(totalCents)}
            </Text>
          </View>
          {(cart.customer?.name || cart.diningMode || discountCents > 0) ? (
            <View style={s.phonePillRow}>
              {cart.customer?.name ? <Pill tone="info" dot>{cart.customer.name}</Pill> : null}
              {cart.diningMode ? (
                <Pill tone="neutral">
                  {cart.diningMode === 'DINE_IN' ? 'Dine-in' : cart.diningMode === 'TAKEOUT' ? 'Takeout' : 'Delivery'}
                </Pill>
              ) : null}
              {discountCents > 0 ? (
                <Pill tone="success" dot>− {formatPeso(discountCents)}</Pill>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={s.header}>
          <Pressable onPress={onCancel} style={s.back}>
            <Text style={s.backText}>← Back to Order</Text>
          </Pressable>
          <View style={{ marginLeft: spacing.s6, flex: 1 }}>
            <Text style={s.title}>Tendering · Bayad</Text>
            <View style={{ flexDirection: 'row', gap: spacing.s3, marginTop: 4, alignItems: 'center' }}>
              <Text style={s.subtle}>
                {orderRef ? `Order ${orderRef} · ` : ''}
                {cart.lines.filter(l => !l.removed).length} items
                {cashierInitials ? ` · ${cashierInitials}` : ''}
              </Text>
              {cart.customer?.name ? <Pill tone="info" dot>{cart.customer.name}</Pill> : null}
              {cart.diningMode ? (
                <Pill tone="neutral">
                  {cart.diningMode === 'DINE_IN' ? 'Dine-in' : cart.diningMode === 'TAKEOUT' ? 'Takeout' : 'Delivery'}
                </Pill>
              ) : null}
              {discountCents > 0 ? (
                <Pill tone="success" dot>− {formatPeso(discountCents)}</Pill>
              ) : null}
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.amountDueLabel}>Amount due</Text>
            <Text style={[s.amountDue, tnum, { color: headerColor }]}>
              {formatPeso(totalCents)}
            </Text>
          </View>
        </View>
      )}

      {/* TABS — pill style with brand-tinted active fill (T-08/T-09).
       *  Phone wraps them in a horizontal scroller so all five fit at 414dp. */}
      <ScrollView
        horizontal={isPhone}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={isPhone ? s.phoneTabs : s.tabs}
        style={isPhone ? s.phoneTabsScroll : undefined}
      >
        {TABS.map(t => {
          const active = tab === t.id;
          const tint = t.tint ?? colors.primary;
          return (
            <Pressable
              key={t.id}
              style={[
                s.tab,
                active && { backgroundColor: tint, borderColor: tint },
              ]}
              onPress={() => setTab(t.id)}
            >
              <Text
                style={[
                  s.tabText,
                  active && { color: colors.onPrimary, fontWeight: '700' },
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* TAB BODY */}
      <View style={{ flex: 1 }}>
        {tab === 'CASH' && (
          <CashTab
            totalCents={totalCents}
            onConfirm={(p, change) => onPaid([p], change)}
          />
        )}
        {tab === 'GCASH' && (
          <GCashTab totalCents={totalCents} onConfirm={p => onPaid([p], 0)} />
        )}
        {tab === 'PAYMAYA' && (
          <PayMayaTab totalCents={totalCents} onConfirm={p => onPaid([p], 0)} />
        )}
        {tab === 'CARD' && (
          <CardTab totalCents={totalCents} onConfirm={p => onPaid([p], 0)} />
        )}
        {tab === 'QR_PH' && (
          <QrPhTab totalCents={totalCents} onConfirm={p => onPaid([p], 0)} />
        )}
        {tab === 'SPLIT' && (
          <SplitTab
            totalCents={totalCents}
            onConfirm={(payments, change) => onPaid(payments, change)}
          />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.s5,
    paddingHorizontal: spacing.s6,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    backgroundColor: colors.surface,
  },
  back: { paddingVertical: spacing.s2, paddingRight: spacing.s4 },
  backText: { ...textTokens.body, color: colors.ink, fontWeight: '600' },
  title: { ...textTokens.displaySm, color: colors.ink },
  subtle: { ...textTokens.caption, color: colors.muted },
  amountDueLabel: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  amountDue: {
    ...textTokens.displayLg,
    fontSize: 48,
    lineHeight: 52,
    marginTop: 2,
  },

  tabs: {
    flexDirection: 'row',
    gap: spacing.s2,
    paddingHorizontal: spacing.s6,
    paddingTop: spacing.s4,
    paddingBottom: spacing.s3,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  tab: {
    height: 48,
    paddingHorizontal: spacing.s4,
    borderRadius: radii.pill,
    justifyContent: 'center',
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.creamDeep,
  },
  tabText: { ...textTokens.bodySm, color: colors.muted, fontWeight: '700' },

  // Phone-specific overrides (414dp width)
  phoneHeader: {
    paddingHorizontal: spacing.s4,
    paddingBottom: spacing.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    backgroundColor: colors.surface,
    gap: spacing.s3,
  },
  phoneHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
  },
  phoneTitle: { ...textTokens.displaySm, color: colors.ink, fontSize: 18 },
  phoneAmountBlock: {
    alignItems: 'flex-start',
    paddingTop: spacing.s2,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  amountDuePhone: {
    ...textTokens.displayLg,
    fontSize: 34,
    lineHeight: 38,
    marginTop: 2,
  },
  phonePillRow: { flexDirection: 'row', gap: spacing.s2, flexWrap: 'wrap' },
  phoneTabs: {
    flexDirection: 'row',
    gap: spacing.s2,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
  },
  phoneTabsScroll: {
    flexGrow: 0,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
});
