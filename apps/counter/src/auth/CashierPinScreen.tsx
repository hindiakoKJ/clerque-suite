/**
 * Clerque Counter — Cashier PIN screen
 * Full-screen numeric keypad gate between sign-in and the terminal. Length is
 * 4 digits for CASHIER role, 6 for supervisor/owner (auto-detected from the
 * session role). On success the AuthProvider stamps `cashier.pinVerifiedAt`,
 * which flips RootNavigator into the App stack.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import PinKeypad, { PinDots } from '@/auth/PinKeypad';
import { useAuth, ApiHttpError } from '@/auth/AuthProvider';
import { colors, radii, spacing, text } from '@/theme';

export default function CashierPinScreen(): React.ReactElement {
  const { session, tenant, verifyCashierPin, signOut } = useAuth();
  const role = session?.user.role;
  const length: 4 | 6 = useMemo(() => (role === 'CASHIER' ? 4 : 6), [role]);

  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto-submit once full length is reached.
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
    return () => {
      cancelled = true;
    };
  }, [pin, length, submitting, verifyCashierPin]);

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Pressable onPress={signOut} hitSlop={12}>
          <Text style={styles.topLink}>Switch cashier</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <Text style={styles.tenant}>{tenant?.name ?? 'Clerque'}</Text>
        <Text style={styles.title}>Enter your {length}-digit PIN</Text>
        <Text style={styles.subtitle}>
          Signed in as {session?.user.name ?? session?.user.email}
        </Text>

        <View style={styles.dotsWrap}>
          <PinDots value={pin} length={length} />
        </View>

        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

        <View style={styles.keypadWrap}>
          <PinKeypad value={pin} length={length} onChange={setPin} disabled={submitting} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.s5,
  },
  topLink: { ...text.bodySm, color: colors.primary, fontWeight: '600' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.s5 },
  tenant: { ...text.caption, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1.2 },
  title: { ...text.displayMd, color: colors.ink, marginTop: spacing.s2 },
  subtitle: { ...text.bodySm, color: colors.muted, marginTop: spacing.s1 },
  dotsWrap: { marginTop: spacing.s5, marginBottom: spacing.s4 },
  error: { ...text.bodySm, color: colors.error, marginBottom: spacing.s3 },
  keypadWrap: { marginTop: spacing.s4 },
  // Unused but kept for parity with mock spec.
  _radii: { borderRadius: radii.lg },
});
