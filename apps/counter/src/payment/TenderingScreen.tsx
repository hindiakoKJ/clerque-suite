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
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  radii,
  spacing,
  text as textTokens,
  tnum,
} from '@/theme/tokens';
import { formatPeso } from '@/components/Money';
import Pill from '@/components/Pill';
import type { CartPayment, CartState } from '@/types';

import CashTab from './CashTab';
import GCashTab from './GCashTab';
import PayMayaTab from './PayMayaTab';
import CardTab from './CardTab';
import SplitTab from './SplitTab';

export type TenderingTab = 'CASH' | 'GCASH' | 'PAYMAYA' | 'CARD' | 'SPLIT';

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
  { id: 'CASH', label: 'Cash · Bayad' },
  { id: 'GCASH', label: 'GCash', tint: colors.gcash },
  { id: 'PAYMAYA', label: 'PayMaya', tint: colors.paymaya },
  { id: 'CARD', label: 'Card' },
  { id: 'SPLIT', label: 'Split' },
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

  const headerColor =
    tab === 'GCASH' ? colors.gcash :
    tab === 'PAYMAYA' ? colors.paymaya :
    colors.primary;

  return (
    <View style={s.root}>
      {/* HEADER */}
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

      {/* TABS */}
      <View style={s.tabs}>
        {TABS.map(t => {
          const active = tab === t.id;
          const tint = t.tint ?? colors.primary;
          return (
            <Pressable
              key={t.id}
              style={[
                s.tab,
                active && { borderBottomColor: tint },
              ]}
              onPress={() => setTab(t.id)}
            >
              <Text
                style={[
                  s.tabText,
                  active && { color: tint, fontWeight: '700' },
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

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
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  tab: {
    height: 64,
    paddingHorizontal: spacing.s5,
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabText: { ...textTokens.bodyLg, color: colors.muted, fontWeight: '500' },
});
