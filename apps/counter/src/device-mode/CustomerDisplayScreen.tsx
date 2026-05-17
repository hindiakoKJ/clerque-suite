/**
 * Clerque Counter — Customer-facing kiosk surface
 *
 * Read-only mirror of the cashier's cart. Polls the server relay every 1s,
 * mirrors the same message shape the web /pos/customer-display screen
 * consumes (CART_UPDATE / PAYMENT_PENDING / PAYMENT_COMPLETE / WELCOME).
 *
 * Mirrors the web logic for the two-phase PAYMENT_COMPLETE display:
 *   • 5 s green "Salamat!" with change due
 *   • 30 s amber "Preparing your order" with order number
 * After which the cashier publishes WELCOME and the screen resets.
 *
 * No interactions — kiosk mode.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { pairedClient, verifyDeviceToken } from '@/device-mode/pairedClient';
import { ApiHttpError } from '@/api/client';
import { clearDeviceMode, type PairedDevice } from '@/device-mode/storage';
import { colors, radii, spacing, text, tnum } from '@/theme';

type DisplayType = 'WELCOME' | 'CART_UPDATE' | 'PAYMENT_PENDING' | 'PAYMENT_COMPLETE' | 'CLEAR';
type PaymentMethod = 'CASH' | 'GCASH' | 'PAYMAYA' | 'CARD' | 'SPLIT';

interface DisplayLine {
  productName: string;
  quantity:    number;
  unitPrice:   number;
  lineTotal:   number;
  modifiers?:  string[];
}

interface DisplayState {
  type:           DisplayType;
  lines:          DisplayLine[];
  subtotal:       number;
  discount:       number;
  vatAmount:      number;
  total:          number;
  amountTendered?:number;
  changeDue?:     number;
  orderNumber?:   string;
  cashierName?:   string;
  branchName?:    string;
  businessName?:  string;
  paymentMethod?: PaymentMethod;
  seq?:           number;
}

interface ReadResponse extends Partial<DisplayState> {
  exists: boolean;
  seq?:   number;
}

const EMPTY: DisplayState = {
  type:     'WELCOME',
  lines:    [],
  subtotal: 0,
  discount: 0,
  vatAmount:0,
  total:    0,
};

function formatPeso(cents: number): string {
  // Backend stores cents; treat undefined / NaN defensively.
  const v = (cents ?? 0) / 100;
  return `₱${v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  pairing:    PairedDevice;
  /** Called when the device token has been revoked / wiped. */
  onUnpaired: () => void;
}

export default function CustomerDisplayScreen({ pairing, onUnpaired }: Props): React.ReactElement {
  const [state, setState] = useState<DisplayState>({ ...EMPTY, businessName: pairing.tenantName });
  const [paymentPhase, setPaymentPhase] = useState<'thanks' | 'preparing'>('thanks');
  const lastPaymentSeq = useRef<number | null>(null);
  const lastSeq = useRef(0);

  // Verify token on mount; bounce to picker if revoked.
  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = await verifyDeviceToken(pairing.deviceToken);
      if (!alive) return;
      if (!ok) {
        await clearDeviceMode();
        onUnpaired();
      }
    })();
    return () => { alive = false; };
  }, [pairing.deviceToken, onUnpaired]);

  // Poll the relay every 1 s.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const data = await pairedClient.get<ReadResponse>(
          `/customer-display/state?cashierId=${encodeURIComponent(pairing.cashierId)}`,
          pairing.deviceToken,
        );
        if (!alive || !data?.exists) return;
        const seq = data.seq ?? 0;
        if (seq <= lastSeq.current) return;
        lastSeq.current = seq;
        setState({
          type:           data.type ?? 'WELCOME',
          lines:          data.lines ?? [],
          subtotal:       data.subtotal ?? 0,
          discount:       data.discount ?? 0,
          vatAmount:      data.vatAmount ?? 0,
          total:          data.total ?? 0,
          amountTendered: data.amountTendered,
          changeDue:      data.changeDue,
          orderNumber:    data.orderNumber,
          cashierName:    data.cashierName,
          branchName:     data.branchName,
          businessName:   data.businessName ?? pairing.tenantName,
          paymentMethod:  data.paymentMethod,
          seq,
        });
      } catch (err) {
        if (alive && err instanceof ApiHttpError && (err.status === 401 || err.status === 403)) {
          // Token rejected — wipe and bounce.
          await clearDeviceMode();
          onUnpaired();
        }
        // Otherwise: network blip, next tick will retry.
      }
    };
    void tick();
    const t = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [pairing.cashierId, pairing.deviceToken, pairing.tenantName, onUnpaired]);

  // PAYMENT_COMPLETE two-phase choreography
  useEffect(() => {
    if (state.type !== 'PAYMENT_COMPLETE') {
      lastPaymentSeq.current = null;
      setPaymentPhase('thanks');
      return;
    }
    if (lastPaymentSeq.current !== state.seq) {
      lastPaymentSeq.current = state.seq ?? null;
      setPaymentPhase('thanks');
      const t = setTimeout(() => setPaymentPhase('preparing'), 5_000);
      return () => clearTimeout(t);
    }
    return;
  }, [state.type, state.seq]);

  const businessName = state.businessName ?? pairing.tenantName ?? 'Welcome';

  // WELCOME
  if (state.type === 'WELCOME' || (state.lines.length === 0 && state.type !== 'PAYMENT_PENDING')) {
    return (
      <View style={[styles.full, styles.welcomeBg]}>
        <MaterialCommunityIcons name="coffee" size={96} color={'#FBE9C7'} />
        <Text style={styles.welcomeTitle}>{businessName}</Text>
        <Text style={styles.welcomeSubtitle}>Welcome — please order at the counter</Text>
      </View>
    );
  }

  // PAYMENT_PENDING
  if (state.type === 'PAYMENT_PENDING') {
    const method  = state.paymentMethod ?? 'CASH';
    const isWallet = method === 'GCASH' || method === 'PAYMAYA';
    const brandBg =
      method === 'GCASH'   ? colors.gcash   :
      method === 'PAYMAYA' ? colors.paymaya :
      method === 'CARD'    ? colors.muted    :
                             colors.ink;
    const brandName =
      method === 'GCASH'   ? 'GCash' :
      method === 'PAYMAYA' ? 'PayMaya' :
      method === 'CARD'    ? 'Card' :
      method === 'SPLIT'   ? 'Split payment' :
                             'Cash';
    return (
      <View style={[styles.full, { backgroundColor: brandBg }]}>
        <Text style={styles.pendLabel}>Amount due</Text>
        <Text style={styles.pendAmount}>{formatPeso(state.total)}</Text>
        {isWallet ? (
          <View style={styles.qrCard}>
            <Text style={[styles.qrBrand, { color: brandBg }]}>{brandName}</Text>
            <Text style={styles.qrPlaceholder}>QR CODE</Text>
            <Text style={styles.qrHint}>
              Ask your cashier to upload your business QR in Settings
            </Text>
          </View>
        ) : (
          <Text style={styles.pendInstruction}>
            Please pay <Text style={styles.pendInstructionBrand}>{brandName}</Text> at the counter
          </Text>
        )}
        <Text style={styles.pendFooter}>{businessName}</Text>
      </View>
    );
  }

  // PAYMENT_COMPLETE — phase A
  if (state.type === 'PAYMENT_COMPLETE' && paymentPhase === 'thanks') {
    return (
      <View style={[styles.full, styles.thanksBg]}>
        <MaterialCommunityIcons name="check-decagram" size={96} color="#FFFFFF" />
        <Text style={styles.thanksTitle}>Salamat!</Text>
        <Text style={styles.thanksSubtitle}>Thank you for your order</Text>
        <View style={styles.thanksBox}>
          <View style={styles.thanksRow}>
            <Text style={styles.thanksRowLabel}>Total paid</Text>
            <Text style={styles.thanksRowValue}>{formatPeso(state.total)}</Text>
          </View>
          {state.amountTendered != null && (
            <View style={styles.thanksRow}>
              <Text style={styles.thanksRowLabel}>Tendered</Text>
              <Text style={styles.thanksRowValue}>{formatPeso(state.amountTendered)}</Text>
            </View>
          )}
          {state.changeDue != null && state.changeDue > 0 && (
            <View style={[styles.thanksRow, styles.thanksChangeRow]}>
              <Text style={styles.thanksChangeLabel}>Change due</Text>
              <Text style={styles.thanksChangeValue}>{formatPeso(state.changeDue)}</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  // PAYMENT_COMPLETE — phase B
  if (state.type === 'PAYMENT_COMPLETE' && paymentPhase === 'preparing') {
    return (
      <View style={[styles.full, styles.preparingBg]}>
        <MaterialCommunityIcons name="chef-hat" size={96} color="#FFFFFF" />
        <Text style={styles.thanksTitle}>Preparing your order</Text>
        <Text style={styles.thanksSubtitle}>Please wait at the counter</Text>
        {state.orderNumber ? (
          <View style={styles.preparingBox}>
            <Text style={styles.preparingLabel}>Order number</Text>
            <Text style={styles.preparingNumber}>{state.orderNumber}</Text>
          </View>
        ) : null}
        <Text style={styles.thanksFooter}>We&apos;ll call your number when it&apos;s ready</Text>
      </View>
    );
  }

  // CART_UPDATE — active cart list
  return (
    <View style={styles.cartRoot}>
      <View style={styles.cartHeader}>
        <View style={styles.cartHeaderLeft}>
          <MaterialCommunityIcons name="coffee" size={28} color={'#FBE9C7'} />
          <Text style={styles.cartHeaderTitle}>{businessName}</Text>
        </View>
        <View style={styles.cartHeaderRight}>
          <MaterialCommunityIcons name="cart" size={20} color={'#FBE9C7'} />
          <Text style={styles.cartHeaderRightText}>Your order</Text>
        </View>
      </View>

      <ScrollView style={styles.cartList} contentContainerStyle={styles.cartListContent}>
        {state.lines.map((line, idx) => (
          <View key={idx} style={styles.cartLine}>
            <Text style={styles.cartQty}>{line.quantity}×</Text>
            <View style={styles.cartLineBody}>
              <Text style={styles.cartLineName}>{line.productName}</Text>
              {line.modifiers && line.modifiers.length > 0 && (
                <Text style={styles.cartLineMods}>{line.modifiers.join(' · ')}</Text>
              )}
            </View>
            <Text style={styles.cartLineTotal}>{formatPeso(line.lineTotal)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.cartFooter}>
        {state.discount > 0 && (
          <View style={styles.cartFooterRow}>
            <Text style={styles.cartFooterLabel}>Discount</Text>
            <Text style={styles.cartFooterDiscount}>-{formatPeso(state.discount)}</Text>
          </View>
        )}
        {state.vatAmount > 0 && (
          <View style={styles.cartFooterRow}>
            <Text style={styles.cartFooterLabel}>VAT (12%)</Text>
            <Text style={styles.cartFooterValue}>{formatPeso(state.vatAmount)}</Text>
          </View>
        )}
        <View style={styles.cartTotalRow}>
          <Text style={styles.cartTotalLabel}>Total</Text>
          <Text style={styles.cartTotalValue}>{formatPeso(state.total)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  full: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s7,
  },
  welcomeBg: { backgroundColor: '#6B3F1D' },
  welcomeTitle: {
    fontFamily: 'PlusJakartaSans',
    fontSize: 72,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: spacing.s5,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  welcomeSubtitle: { ...text.bodyLg, color: '#FBE9C7', marginTop: spacing.s3, fontSize: 22 },

  // PAYMENT_PENDING
  pendLabel: {
    color: 'rgba(255,255,255,0.7)',
    ...text.bodyLg,
    fontSize: 20,
    textTransform: 'uppercase',
    letterSpacing: 3,
    marginBottom: spacing.s3,
  },
  pendAmount: {
    fontFamily: 'PlusJakartaSans',
    fontSize: 96,
    fontWeight: '800',
    color: '#FFFFFF',
    ...tnum,
    marginBottom: spacing.s6,
    letterSpacing: -1,
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xl,
    padding: spacing.s5,
    marginBottom: spacing.s5,
    alignItems: 'center',
    width: 320,
    height: 320,
    justifyContent: 'center',
  },
  qrBrand:       { fontFamily: 'PlusJakartaSans', fontWeight: '800', fontSize: 36 },
  qrPlaceholder: { ...text.caption, color: colors.faint, marginTop: spacing.s2, letterSpacing: 2 },
  qrHint:        { ...text.caption, color: colors.faint, marginTop: spacing.s5, textAlign: 'center', paddingHorizontal: spacing.s5 },
  pendInstruction: { color: 'rgba(255,255,255,0.85)', fontSize: 24, marginBottom: spacing.s5, textAlign: 'center' },
  pendInstructionBrand: { fontWeight: '700' },
  pendFooter:    { color: 'rgba(255,255,255,0.6)', ...text.body },

  // PAYMENT_COMPLETE — thanks
  thanksBg:     { backgroundColor: colors.success },
  preparingBg:  { backgroundColor: colors.warning },
  thanksTitle:  { fontFamily: 'PlusJakartaSans', fontSize: 64, fontWeight: '800', color: '#FFFFFF', marginTop: spacing.s4 },
  thanksSubtitle: { ...text.bodyLg, color: 'rgba(255,255,255,0.9)', fontSize: 24, marginTop: spacing.s2, marginBottom: spacing.s6 },
  thanksFooter: { ...text.bodySm, color: 'rgba(255,255,255,0.9)', marginTop: spacing.s6, fontStyle: 'italic' },
  thanksBox: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radii.xl,
    paddingHorizontal: spacing.s6,
    paddingVertical:   spacing.s5,
    minWidth: 360,
  },
  thanksRow:        { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.s2 },
  thanksRowLabel:   { color: 'rgba(255,255,255,0.9)', fontSize: 18 },
  thanksRowValue:   { color: '#FFFFFF', fontWeight: '600', fontSize: 18, ...tnum },
  thanksChangeRow:  { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.3)', paddingTop: spacing.s3, marginTop: spacing.s2 },
  thanksChangeLabel:{ color: '#FFFFFF', fontWeight: '700', fontSize: 28 },
  thanksChangeValue:{ color: '#FFFFFF', fontWeight: '800', fontSize: 28, ...tnum },

  // Preparing
  preparingBox: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: radii.xl,
    paddingHorizontal: spacing.s7,
    paddingVertical:   spacing.s6,
    alignItems: 'center',
  },
  preparingLabel:  { color: 'rgba(255,255,255,0.85)', ...text.body, letterSpacing: 2, textTransform: 'uppercase', marginBottom: spacing.s2 },
  preparingNumber: { fontFamily: 'PlusJakartaSans', color: '#FFFFFF', fontSize: 96, fontWeight: '800', ...tnum },

  // CART
  cartRoot: { flex: 1, backgroundColor: '#1C1814' },
  cartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.s6,
    paddingVertical:   spacing.s4,
    backgroundColor: '#6B3F1D',
    borderBottomWidth: 4,
    borderBottomColor: '#8B5E3C',
  },
  cartHeaderLeft:  { flexDirection: 'row', alignItems: 'center', gap: spacing.s3 },
  cartHeaderTitle: { color: '#FFFFFF', fontFamily: 'PlusJakartaSans', fontSize: 28, fontWeight: '800' },
  cartHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  cartHeaderRightText: { color: '#FBE9C7', fontSize: 18, fontWeight: '500' },

  cartList:        { flex: 1 },
  cartListContent: { paddingHorizontal: spacing.s6, paddingVertical: spacing.s4 },
  cartLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.s3,
    gap: spacing.s4,
  },
  cartQty:         { color: '#FCD34D', fontWeight: '700', fontSize: 24, width: 52, ...tnum },
  cartLineBody:    { flex: 1 },
  cartLineName:    { color: '#FFFFFF', fontSize: 22, fontWeight: '500' },
  cartLineMods:    { color: '#A8A29E', ...text.bodySm, marginTop: spacing.s1 },
  cartLineTotal:   { color: '#FFFFFF', fontSize: 22, fontWeight: '600', ...tnum },

  cartFooter: {
    paddingHorizontal: spacing.s6,
    paddingVertical:   spacing.s5,
    backgroundColor:   'rgba(0,0,0,0.4)',
    borderTopWidth:    1,
    borderTopColor:    '#3F3A33',
  },
  cartFooterRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.s2 },
  cartFooterLabel:    { color: '#D6D3D1', fontSize: 18 },
  cartFooterValue:    { color: '#D6D3D1', fontSize: 18, ...tnum },
  cartFooterDiscount: { color: '#34D399', fontSize: 18, ...tnum },
  cartTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems:    'baseline',
    borderTopWidth: 1,
    borderTopColor: '#3F3A33',
    paddingTop:     spacing.s4,
    marginTop:      spacing.s2,
  },
  cartTotalLabel: { color: '#D6D3D1', fontSize: 22, textTransform: 'uppercase', letterSpacing: 1.5 },
  cartTotalValue: { color: '#FCD34D', fontFamily: 'PlusJakartaSans', fontWeight: '800', fontSize: 64, ...tnum },
});
