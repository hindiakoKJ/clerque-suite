/**
 * Clerque Counter — Cashier PIN screen (P-03)
 *
 * Pixel-faithful to design-source-v3 phone P-03:
 *   • Big 72×72 brown avatar with cashier initials (Plus Jakarta 28sp 800)
 *   • Display heading "Welcome, {firstName}", muted "Enter your {N}-digit PIN"
 *   • Role chip (Cashier · Sales Lead · Owner) directly below
 *   • PIN dots row (22dp circles, 18dp gap)
 *   • Cream-soft keypad container with 88dp keys at 10dp gap (action keys
 *     "Clear" + "⌫" in cream tone)
 *   • Bottom: muted "Not {name}? Switch cashier ↗" link
 *
 * Length is 4 for CASHIER, 6 for supervisor/owner — matches the verify
 * endpoint's spec. AuthProvider stamps `cashier.pinVerifiedAt` on success,
 * which flips RootNavigator into the App stack.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import PinKeypad, { PinDots } from '@/auth/PinKeypad';
import { useAuth, ApiHttpError } from '@/auth/AuthProvider';
import { colors, fonts, radii, spacing, text } from '@/theme';

export default function CashierPinScreen(): React.ReactElement {
  const { session, verifyCashierPin, signOut } = useAuth();
  const role = session?.user.role;
  const length: 4 | 6 = useMemo(() => (role === 'CASHIER' ? 4 : 6), [role]);

  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);

  const fullName = session?.user.name ?? 'Cashier';
  const firstName = fullName.split(/\s+/)[0] ?? fullName;
  const initials = fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '·';

  // Auto-submit when the dots fill.
  useEffect(() => {
    if (pin.length !== length || submitting) return;
    let cancelled = false;
    (async () => {
      setSubmitting(true);
      setErrorMsg(null);
      try {
        await verifyCashierPin(pin);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiHttpError && err.status === 401) {
          setErrorMsg('Incorrect PIN. Try again.');
        } else if (err instanceof ApiHttpError && err.status === 0) {
          setErrorMsg('No network — PIN verification requires connection.');
        } else {
          setErrorMsg('Could not verify PIN. Please try again.');
        }
        setPin('');
      } finally {
        if (!cancelled) setSubmitting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pin, length, submitting, verifyCashierPin]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.greeting}>Welcome, {firstName}</Text>
        <Text style={styles.helper}>Enter your {length}-digit PIN</Text>
        <View style={styles.roleChip}>
          <Text style={styles.roleChipText}>{roleLabel(role)}</Text>
        </View>

        <View style={styles.dotsWrap}>
          <PinDots value={pin} length={length} />
        </View>

        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

        <View style={styles.keypadShell}>
          <PinKeypad value={pin} length={length} onChange={setPin} disabled={submitting} />
        </View>

        <Pressable onPress={signOut} hitSlop={12} style={styles.switchWrap}>
          <Text style={styles.switchLine}>
            Not {firstName}?{' '}
            <Text style={styles.switchLink}>Switch cashier ↗</Text>
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function roleLabel(role: string | undefined): string {
  switch (role) {
    case 'CASHIER':         return 'Cashier';
    case 'SALES_LEAD':      return 'Sales Lead';
    case 'BUSINESS_OWNER':  return 'Owner';
    case 'SUPER_ADMIN':     return 'Admin';
    default:                return role ?? 'Staff';
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.s5,
    paddingTop: spacing.s5,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.s3,
    shadowColor: colors.primary, shadowOpacity: 0.30, shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  avatarText: {
    fontFamily: fonts.displayBold, fontSize: 28, fontWeight: '800',
    color: colors.onPrimary,
  },
  greeting: { ...text.displayMd, fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  helper:   { ...text.caption, color: colors.muted, marginTop: 4, marginBottom: 6 },
  roleChip: {
    paddingHorizontal: spacing.s3, paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryContainer,
    marginBottom: spacing.s5,
  },
  roleChipText: { fontFamily: fonts.bodyBold, fontSize: 11, fontWeight: '700', color: colors.primaryPress, letterSpacing: 0.3 },

  dotsWrap: { marginBottom: spacing.s6 },

  error: { ...text.bodySm, color: colors.error, marginBottom: spacing.s3 },

  keypadShell: {
    padding: 14,
    backgroundColor: colors.creamSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.creamDeep,
  },

  switchWrap: { marginTop: spacing.s5, padding: spacing.s2 },
  switchLine: { ...text.bodySm, color: colors.muted, textAlign: 'center' },
  switchLink: { color: colors.primary, fontWeight: '700' },
});
