/**
 * Clerque Counter — Phone Tendering wizard (P-07 / P-08 / P-09)
 *
 * Pixel-faithful to design-source-v3 phone P-07..P-09:
 *
 *   STEP 1 — pick method
 *     • App-bar with back chevron + "Tendering" + "Order · N items" subtitle
 *     • Wizard stepper row: ● Method ─ ○ Amount ─ ○ Confirm
 *     • Centered "AMOUNT DUE" eyebrow + huge primary-brown total
 *     • "How does the customer pay?" muted uppercase section header
 *     • Five method cards: Cash (selected by default) / GCash / PayMaya /
 *       Card / Split. Each is a 14px-radius card with an icon tile, label,
 *       and one-line sub. Selected card carries the primary brown border
 *       and a 4dp soft glow.
 *     • Sticky bottom: "Continue · {Method} →" 52dp primary brown CTA
 *
 *   STEP 2 — enter amount  (Cash flow only today; other methods skip to step 3)
 *     • App-bar "Tendering · Cash" with "Amount due ₱X" subtitle
 *     • Wizard stepper: ✓ Method ─ ● Amount ─ ○ Confirm
 *     • Bayad card (white) — the tendered cash amount in 38sp tabular display
 *     • Sukli card (success-soft) — change due in success-deep
 *     • Quick-amount denomination chips (₱50/₱100/₱200/₱500/₱1k + Exact)
 *     • 3×4 keypad with "·" decimal and ⌫ delete
 *     • Sticky bottom: "Continue · ₱{tendered} →"
 *
 *   STEP 3 — confirm
 *     • App-bar "Tendering · Cash" with "Confirm to print receipt" subtitle
 *     • Line items summary card (max 6 lines, +N more)
 *     • Totals card (Subtotal · Discount · Total)
 *     • 2-up Bayad / Sukli mini cards
 *     • Info banner about auto-print
 *     • Two CTAs: "Confirm & print ✓" primary + "Cancel sale" ghost
 *
 * Logic: orderSubmit + tendering host live in TenderingHost.tsx. This
 * component is presentation-only — it captures the cashier's choice +
 * amount and calls `onPaid(payments[], changeCents)`. The host then runs
 * submitOrder and shows the receipt.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatPeso } from '@/components/Money';
import GCashTab from '@/payment/GCashTab';
import PayMayaTab from '@/payment/PayMayaTab';
import CardTab from '@/payment/CardTab';
import SplitTab from '@/payment/SplitTab';
import { keypadToCents } from '@/payment/NumericKeypad';
import { colors, fonts, radii, spacing, text as textTokens, tnum } from '@/theme';
import type { CartPayment, CartState, PaymentMethod } from '@/types';

export interface PhoneTenderingWizardProps {
  cart:          CartState;
  totalCents:    number;
  discountCents?: number;
  onPaid:        (payments: CartPayment[], changeCents: number) => void;
  onCancel:      () => void;
}

type Method = 'CASH' | 'GCASH' | 'PAYMAYA' | 'CARD' | 'SPLIT';
type Step = 1 | 2 | 3;

const METHODS: { id: Method; label: string; sub: string; glyph: string; tone: 'primary' | 'gcash' | 'paymaya' | 'neutral' }[] = [
  { id: 'CASH',    label: 'Cash · Bayad', sub: 'Customer hands over bills · gives sukli', glyph: '₱',  tone: 'primary' },
  { id: 'GCASH',   label: 'GCash',        sub: 'QR or send request · enter ref number',    glyph: 'G',  tone: 'gcash' },
  { id: 'PAYMAYA', label: 'PayMaya',      sub: 'QR or send request · enter ref number',    glyph: 'P',  tone: 'paymaya' },
  { id: 'CARD',    label: 'Card',         sub: 'Tap to record · external terminal',         glyph: '◧',  tone: 'neutral' },
  { id: 'SPLIT',   label: 'Split',        sub: 'Two or more tenders',                       glyph: '÷',  tone: 'neutral' },
];

const QUICK_CENTS = [5000, 10000, 20000, 50000, 100000];

export default function PhoneTenderingWizard({
  cart, totalCents, discountCents = 0, onPaid, onCancel,
}: PhoneTenderingWizardProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const [step,   setStep]   = useState<Step>(1);
  const [method, setMethod] = useState<Method>('CASH');
  const [bayadRaw, setBayadRaw] = useState('');

  const activeLineCount = cart.lines.filter(l => !l.removed && !l.voidedAt).length;
  const bayadCents = useMemo(() => keypadToCents(bayadRaw), [bayadRaw]);
  const changeCents = bayadCents - totalCents;
  const bayadReady = bayadCents >= totalCents && bayadCents > 0;

  /** Step-1 continue: cash needs the amount-entry step; others skip to step 3
   *  (their own forms live as ad-hoc panels above the confirm screen). */
  const onContinueFromStep1 = () => setStep(method === 'CASH' ? 2 : 3);
  const onContinueFromStep2 = () => bayadReady && setStep(3);
  const onConfirm = () => {
    if (method === 'CASH' && bayadReady) {
      onPaid([{ method: 'CASH', amount: bayadCents }], changeCents);
    }
    // Other methods finalize via their own tab components on step 3.
  };

  return (
    <View style={styles.root}>
      <PhoneTenderingAppBar
        step={step}
        method={method}
        order={cart.lines.length}
        items={activeLineCount}
        totalCents={totalCents}
        onBack={() => (step === 1 ? onCancel() : setStep((s) => (s - 1) as Step))}
        insets={insets}
      />
      <WizardStepper step={step} />

      {step === 1 ? (
        <Step1Method
          method={method}
          onPick={setMethod}
          totalCents={totalCents}
        />
      ) : step === 2 && method === 'CASH' ? (
        <Step2CashAmount
          totalCents={totalCents}
          bayadRaw={bayadRaw}
          setBayadRaw={setBayadRaw}
          bayadCents={bayadCents}
          changeCents={changeCents}
        />
      ) : (
        <Step3Confirm
          method={method}
          cart={cart}
          totalCents={totalCents}
          discountCents={discountCents}
          bayadCents={bayadCents}
          changeCents={changeCents}
          onPaid={onPaid}
        />
      )}

      <View style={[styles.footer, { paddingBottom: spacing.s7 + insets.bottom }]}>
        {step === 1 ? (
          <Pressable
            onPress={onContinueFromStep1}
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          >
            <Text style={styles.ctaLabel}>
              Continue · {labelFor(method)} →
            </Text>
          </Pressable>
        ) : step === 2 ? (
          <Pressable
            onPress={onContinueFromStep2}
            disabled={!bayadReady}
            style={({ pressed }) => [
              styles.cta,
              (!bayadReady) && styles.ctaDisabled,
              pressed && styles.ctaPressed,
            ]}
          >
            <Text style={styles.ctaLabel}>
              Continue · {formatPeso(bayadCents)} →
            </Text>
          </Pressable>
        ) : (
          <View style={{ gap: spacing.s2 }}>
            {method === 'CASH' ? (
              <Pressable
                onPress={onConfirm}
                style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              >
                <Text style={styles.ctaLabel}>Confirm &amp; print ✓</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onCancel} style={styles.ghost}>
              <Text style={styles.ghostLabel}>Cancel sale</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function labelFor(m: Method): string {
  return m === 'CASH' ? 'Cash' :
         m === 'GCASH' ? 'GCash' :
         m === 'PAYMAYA' ? 'PayMaya' :
         m === 'CARD' ? 'Card' :
         'Split';
}

// ─── App bar ─────────────────────────────────────────────────────────

function PhoneTenderingAppBar({
  step, method, order, items, totalCents, onBack, insets,
}: {
  step: Step; method: Method; order: number; items: number; totalCents: number;
  onBack: () => void; insets: { top: number };
}): React.ReactElement {
  const title    = step === 1 ? 'Tendering' : `Tendering · ${labelFor(method)}`;
  const subtitle = step === 1
    ? `Order · ${items} item${items === 1 ? '' : 's'}`
    : step === 2 ? `Amount due ${formatPeso(totalCents)}`
                 : 'Confirm to print receipt';
  void order;
  return (
    <View style={[appBarStyles.bar, { paddingTop: insets.top + 4 }]}>
      <Pressable onPress={onBack} hitSlop={8} style={appBarStyles.back}>
        <MaterialCommunityIcons name="arrow-left" size={22} color={colors.muted} />
      </Pressable>
      <View style={appBarStyles.titleWrap}>
        <Text style={appBarStyles.title} numberOfLines={1}>{title}</Text>
        <Text style={appBarStyles.sub}   numberOfLines={1}>{subtitle}</Text>
      </View>
    </View>
  );
}

const appBarStyles = StyleSheet.create({
  bar: {
    minHeight: 56,
    paddingHorizontal: spacing.s3,
    paddingBottom: spacing.s2,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.s2,
  },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.displayBold, fontSize: 15, fontWeight: '800', color: colors.ink },
  sub:   { ...textTokens.caption, color: colors.muted, fontSize: 10, marginTop: 1 },
});

// ─── Wizard stepper ──────────────────────────────────────────────────

function WizardStepper({ step }: { step: Step }): React.ReactElement {
  const labels: { idx: 1 | 2 | 3; label: string }[] = [
    { idx: 1, label: 'Method' },
    { idx: 2, label: 'Amount' },
    { idx: 3, label: 'Confirm' },
  ];
  return (
    <View style={stepperStyles.row}>
      {labels.map((l, i) => {
        const done = l.idx < step;
        const on   = l.idx === step;
        return (
          <React.Fragment key={l.idx}>
            <View style={[stepperStyles.dot, done && stepperStyles.dotDone, on && stepperStyles.dotOn]}>
              <Text style={[stepperStyles.dotText, (done || on) && stepperStyles.dotTextOn]}>
                {done ? '✓' : String(l.idx)}
              </Text>
            </View>
            <Text style={[stepperStyles.label, on && stepperStyles.labelOn]}>{l.label}</Text>
            {i < 2 ? <View style={[stepperStyles.line, l.idx < step && stepperStyles.lineDone]} /> : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const stepperStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    paddingHorizontal: spacing.s4,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  dot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.cream,
    alignItems: 'center', justifyContent: 'center',
  },
  dotOn:   { backgroundColor: colors.primary },
  dotDone: { backgroundColor: colors.success },
  dotText:   { color: colors.muted, fontSize: 12, fontWeight: '800', fontFamily: fonts.bodyBold },
  dotTextOn: { color: colors.onPrimary },
  label:   { ...textTokens.caption, color: colors.muted, fontSize: 12, fontWeight: '700' },
  labelOn: { color: colors.ink },
  line:    { flex: 1, height: 2, backgroundColor: colors.cream },
  lineDone:{ backgroundColor: colors.success },
});

// ─── Step 1 — pick method ────────────────────────────────────────────

function Step1Method({
  method, onPick, totalCents,
}: { method: Method; onPick: (m: Method) => void; totalCents: number }): React.ReactElement {
  return (
    <ScrollView contentContainerStyle={step1Styles.scroll}>
      <View style={step1Styles.amountBlock}>
        <Text style={step1Styles.eyebrow}>Amount due</Text>
        <Text style={[step1Styles.amount, tnum]} numberOfLines={1}>{formatPeso(totalCents)}</Text>
      </View>

      <Text style={step1Styles.section}>How does the customer pay?</Text>

      <View style={{ gap: spacing.s3 }}>
        {METHODS.map((m) => {
          const active = m.id === method;
          return (
            <Pressable
              key={m.id}
              onPress={() => onPick(m.id)}
              style={[step1Styles.card, active && step1Styles.cardOn]}
            >
              <View style={[step1Styles.glyph, glyphTone(m.tone, active)]}>
                <Text style={[step1Styles.glyphText, glyphTextTone(m.tone, active)]}>
                  {m.glyph}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={step1Styles.label}>{m.label}</Text>
                <Text style={step1Styles.sub}>{m.sub}</Text>
              </View>
              {active ? (
                <MaterialCommunityIcons name="circle" size={14} color={colors.primary} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

function glyphTone(tone: 'primary' | 'gcash' | 'paymaya' | 'neutral', active: boolean) {
  if (active && tone === 'primary') return { backgroundColor: colors.primary };
  if (tone === 'gcash')   return { backgroundColor: colors.gcashSoft };
  if (tone === 'paymaya') return { backgroundColor: '#D8F0DE' };
  return { backgroundColor: colors.cream };
}
function glyphTextTone(tone: 'primary' | 'gcash' | 'paymaya' | 'neutral', active: boolean) {
  if (active && tone === 'primary') return { color: colors.onPrimary };
  if (tone === 'gcash')   return { color: colors.gcash };
  if (tone === 'paymaya') return { color: colors.paymaya };
  return { color: colors.ink };
}

const step1Styles = StyleSheet.create({
  scroll: { padding: spacing.s4, paddingBottom: 120 },
  amountBlock: { alignItems: 'center', marginBottom: spacing.s5 },
  eyebrow: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1, fontSize: 11, fontWeight: '800' },
  amount: { fontFamily: fonts.displayBold, fontSize: 42, fontWeight: '800', color: colors.primary, letterSpacing: -0.6, marginTop: 4 },
  section: { ...textTokens.caption, fontSize: 12, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing.s2 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.s3,
    paddingVertical: 14, paddingHorizontal: spacing.s4,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.rule,
    borderRadius: 14,
  },
  cardOn: {
    borderColor: colors.primary,
    borderWidth: 2,
    shadowColor: colors.primary, shadowOpacity: 0.15, shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 }, elevation: 0,
  },
  glyph: {
    width: 44, height: 44, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  glyphText: { fontFamily: fonts.displayBold, fontSize: 18, fontWeight: '800' },
  label: { ...textTokens.body, fontSize: 16, fontWeight: '800', color: colors.ink },
  sub:   { ...textTokens.caption, color: colors.muted, marginTop: 2, fontSize: 12 },
});

// ─── Step 2 — cash amount ────────────────────────────────────────────

function Step2CashAmount({
  totalCents, bayadRaw, setBayadRaw, bayadCents, changeCents,
}: {
  totalCents: number;
  bayadRaw: string; setBayadRaw: (v: string) => void;
  bayadCents: number; changeCents: number;
}): React.ReactElement {
  const handleKey = (k: string) => {
    if (k === 'back') {
      setBayadRaw(bayadRaw.slice(0, -1));
      return;
    }
    if (k === '.') {
      if (!bayadRaw.includes('.')) setBayadRaw((bayadRaw || '0') + '.');
      return;
    }
    // Limit to two decimals
    if (bayadRaw.includes('.') && bayadRaw.split('.')[1].length >= 2) return;
    setBayadRaw(bayadRaw + k);
  };

  const setExactOrQuick = (cents: number | 'exact') => {
    const value = cents === 'exact' ? totalCents : cents;
    setBayadRaw((value / 100).toFixed(2));
  };

  return (
    <ScrollView contentContainerStyle={step2Styles.scroll}>
      <View style={step2Styles.bayadCard}>
        <Text style={step2Styles.bayadLabel}>Bayad · Cash received</Text>
        <Text style={[step2Styles.bayadValue, tnum]}>{formatPeso(bayadCents)}</Text>
      </View>

      <View style={step2Styles.sukliCard}>
        <Text style={step2Styles.sukliLabel}>Sukli · Change</Text>
        <Text style={[step2Styles.sukliValue, tnum]}>
          {changeCents > 0 ? formatPeso(changeCents) : '—'}
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={step2Styles.chipsRow}>
        {QUICK_CENTS.map((c) => (
          <Pressable
            key={c}
            onPress={() => setExactOrQuick(c)}
            style={[step2Styles.chip, bayadCents === c && step2Styles.chipOn]}
          >
            <Text style={[step2Styles.chipText, bayadCents === c && step2Styles.chipTextOn]}>
              {c >= 100000 ? '₱1k' : `₱${c / 100}`}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setExactOrQuick('exact')}
          style={[step2Styles.chip, bayadCents === totalCents && step2Styles.chipOn]}
        >
          <Text style={[step2Styles.chipText, bayadCents === totalCents && step2Styles.chipTextOn]}>
            Exact
          </Text>
        </Pressable>
      </ScrollView>

      <View style={step2Styles.keypad}>
        {['1','2','3','4','5','6','7','8','9','.','0','back'].map((k) => {
          const action = k === '.' || k === 'back';
          return (
            <Pressable
              key={k}
              onPress={() => handleKey(k)}
              style={({ pressed }) => [
                step2Styles.key,
                action && step2Styles.keyAction,
                pressed && step2Styles.keyPressed,
              ]}
            >
              <Text style={[step2Styles.keyLabel, action && step2Styles.keyLabelAction]}>
                {k === 'back' ? '⌫' : k}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const step2Styles = StyleSheet.create({
  scroll: { padding: spacing.s4, paddingBottom: 120 },
  bayadCard: {
    padding: 18,
    paddingHorizontal: 22,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1, borderColor: colors.rule,
    marginBottom: 10,
  },
  bayadLabel: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 10, fontWeight: '800' },
  bayadValue: { fontFamily: fonts.displayBold, fontSize: 38, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 },
  sukliCard: {
    padding: 18,
    paddingHorizontal: 22,
    backgroundColor: colors.successSoft,
    borderRadius: 14,
    borderWidth: 1, borderColor: '#B5E6D2',
    marginBottom: spacing.s4,
  },
  sukliLabel: { ...textTokens.caption, color: colors.successDeep, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 10, fontWeight: '800' },
  sukliValue: { fontFamily: fonts.displayBold, fontSize: 38, fontWeight: '800', letterSpacing: -0.6, marginTop: 4, color: colors.successDeep },

  chipsRow: { gap: 6, paddingVertical: 4, marginBottom: spacing.s3, flexDirection: 'row' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, minHeight: 36,
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1.5, borderColor: colors.rule,
    alignItems: 'center', justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.primaryContainer, borderColor: colors.primary },
  chipText:   { ...textTokens.bodySm, fontSize: 12, fontWeight: '700', color: colors.ink },
  chipTextOn: { color: colors.primaryPress },

  keypad: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    padding: 10,
    backgroundColor: colors.creamSoft,
    borderRadius: 16,
  },
  key: {
    width: '31%', height: 52,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.rule,
    borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  keyAction: { backgroundColor: colors.cream, borderColor: colors.creamDeep },
  keyPressed: { opacity: 0.7 },
  keyLabel:       { fontFamily: fonts.bodyBold, fontSize: 18, fontWeight: '600', color: colors.ink },
  keyLabelAction: { color: colors.primary, fontSize: 16, fontWeight: '600' },
});

// ─── Step 3 — confirm ────────────────────────────────────────────────

function Step3Confirm({
  method, cart, totalCents, discountCents, bayadCents, changeCents, onPaid,
}: {
  method: Method;
  cart: CartState;
  totalCents: number;
  discountCents: number;
  bayadCents: number;
  changeCents: number;
  onPaid: (payments: CartPayment[], change: number) => void;
}): React.ReactElement {
  const active = cart.lines.filter((l) => !l.removed && !l.voidedAt);
  const subtotal = active.reduce((acc, l) => acc + l.lineTotal, 0);

  if (method !== 'CASH') {
    // Other methods carry their entry flow inline — render the tab content
    // here as the "amount entry" step is inseparable from the entry UX.
    return (
      <ScrollView contentContainerStyle={step3Styles.scroll}>
        <View style={step3Styles.card}>
          <Text style={step3Styles.cardLabel}>Capture {labelFor(method as Method)} reference</Text>
        </View>
        {method === 'GCASH'   ? <GCashTab   totalCents={totalCents} onConfirm={(p) => onPaid([p], 0)} /> : null}
        {method === 'PAYMAYA' ? <PayMayaTab totalCents={totalCents} onConfirm={(p) => onPaid([p], 0)} /> : null}
        {method === 'CARD'    ? <CardTab    totalCents={totalCents} onConfirm={(p) => onPaid([p], 0)} /> : null}
        {method === 'SPLIT'   ? <SplitTab   totalCents={totalCents} onConfirm={(payments, change) => onPaid(payments, change)} /> : null}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={step3Styles.scroll}>
      {/* Lines summary */}
      <View style={step3Styles.card}>
        <Text style={step3Styles.cardLabel}>
          {active.length} item{active.length === 1 ? '' : 's'}
        </Text>
        {active.slice(0, 6).map((l) => (
          <View key={l.id} style={step3Styles.lineRow}>
            <Text style={step3Styles.lineName} numberOfLines={1}>
              {l.qty}× {l.productName}
            </Text>
            <Text style={[step3Styles.linePrice, tnum]}>{formatPeso(l.lineTotal)}</Text>
          </View>
        ))}
        {active.length > 6 ? (
          <Text style={step3Styles.lineMore}>+{active.length - 6} more</Text>
        ) : null}
      </View>

      {/* Totals */}
      <View style={step3Styles.card}>
        <View style={step3Styles.totalRow}>
          <Text style={step3Styles.totalLabel}>Subtotal</Text>
          <Text style={[step3Styles.totalValue, tnum]}>{formatPeso(subtotal)}</Text>
        </View>
        {discountCents > 0 ? (
          <View style={step3Styles.totalRow}>
            <Text style={[step3Styles.totalLabel, { color: colors.successDeep }]}>Discount</Text>
            <Text style={[step3Styles.totalValue, tnum, { color: colors.successDeep }]}>− {formatPeso(discountCents)}</Text>
          </View>
        ) : null}
        <View style={step3Styles.grandRow}>
          <Text style={step3Styles.grandLabel}>Total</Text>
          <Text style={[step3Styles.grandValue, tnum]}>{formatPeso(totalCents)}</Text>
        </View>
      </View>

      {/* Bayad / Sukli 2-up */}
      <View style={step3Styles.row2}>
        <View style={[step3Styles.miniCard]}>
          <Text style={step3Styles.miniLabel}>Bayad</Text>
          <Text style={[step3Styles.miniValue, tnum]}>{formatPeso(bayadCents)}</Text>
        </View>
        <View style={[step3Styles.miniCard, step3Styles.miniSukli]}>
          <Text style={[step3Styles.miniLabel, { color: colors.successDeep }]}>Sukli</Text>
          <Text style={[step3Styles.miniValue, tnum, { color: colors.successDeep }]}>{formatPeso(changeCents)}</Text>
        </View>
      </View>

      <View style={step3Styles.banner}>
        <Text style={step3Styles.bannerText}>
          <Text style={{ fontWeight: '700' }}>Auto-print on confirm.</Text>{' '}
          Receipt sends to the paired Counter printer — a Retry toast appears
          on failure.
        </Text>
      </View>
    </ScrollView>
  );
}

const step3Styles = StyleSheet.create({
  scroll: { padding: spacing.s4, gap: spacing.s3, paddingBottom: 140 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.rule,
    padding: 16,
    marginBottom: spacing.s3,
  },
  cardLabel: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 10, fontWeight: '800', marginBottom: spacing.s2 },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 4 },
  lineName:  { ...textTokens.body, fontSize: 13, color: colors.ink, flex: 1, marginRight: spacing.s3 },
  linePrice: { ...textTokens.body, fontSize: 13, color: colors.ink, fontWeight: '700' },
  lineMore:  { ...textTokens.bodySm, color: colors.muted, marginTop: 4, fontStyle: 'italic' },

  totalRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginVertical: 4 },
  totalLabel: { ...textTokens.body, fontSize: 13, color: colors.muted },
  totalValue: { ...textTokens.body, fontSize: 13, fontWeight: '700', color: colors.ink },
  grandRow:   {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    marginTop: 6, paddingTop: 6,
    borderTopWidth: 1, borderTopColor: colors.rule,
  },
  grandLabel: { ...textTokens.body, fontSize: 16, fontWeight: '800', color: colors.ink },
  grandValue: { fontFamily: fonts.displayBold, fontSize: 16, fontWeight: '800', color: colors.ink },

  row2: { flexDirection: 'row', gap: 10, marginBottom: spacing.s3 },
  miniCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.rule,
    padding: 16,
  },
  miniSukli: { backgroundColor: colors.successSoft, borderColor: '#B5E6D2' },
  miniLabel: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 10, fontWeight: '800' },
  miniValue: { fontFamily: fonts.displayBold, fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginTop: 4 },

  banner: {
    padding: 12,
    backgroundColor: colors.infoSoft,
    borderRadius: 10,
    borderWidth: 1, borderColor: '#BFD8FB',
  },
  bannerText: { ...textTokens.caption, fontSize: 12, color: colors.infoDeep, lineHeight: 18 },
});

// ─── Root styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  footer: {
    padding: spacing.s3,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.rule,
  },
  cta: {
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaPressed:  { backgroundColor: colors.primaryPress },
  ctaDisabled: { backgroundColor: colors.faint },
  ctaLabel:    { color: colors.onPrimary, fontFamily: fonts.bodyBold, fontWeight: '700', fontSize: 17 },
  ghost:       { height: 40, alignItems: 'center', justifyContent: 'center' },
  ghostLabel:  { color: colors.muted, fontSize: 13, fontWeight: '600' },
});
