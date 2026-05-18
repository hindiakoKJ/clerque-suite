/**
 * Clerque Counter — Pairing screen
 *
 * 4-digit code entry for non-cashier modes. Posts to the public
 * /display-pairing/redeem endpoint with `{ tenantSlug, code }` and on
 * success returns a long-lived deviceToken the kiosk then uses for every
 * subsequent display-stream poll.
 *
 * Layout: tenant slug → 4 large code boxes (autofocus, auto-advance,
 * paste-aware) → big primary "Pair" button.
 */

import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from 'react-native';
import { Button, HelperText, Text, TextInput as PaperInput } from 'react-native-paper';

import { api, ApiHttpError } from '@/api/client';
import { getWebHost } from '@/api/webOrigin';
import { colors, radii, spacing, tap, text, tnum } from '@/theme';
import type { PairedDevice } from '@/device-mode/storage';

interface RedeemResponse {
  deviceToken: string;
  tenantId:    string;
  tenantName:  string;
  cashierId:   string;
  role:        string;
  stationId?:  string | null;
  label?:      string | null;
}

interface Props {
  title:        string;
  subtitle:     string;
  /** Display the user is targeting — surfaces a friendly mismatch error when
   *  the redeemed code is for a different role. */
  expectedRole?: string;
  onPaired:     (pairing: PairedDevice) => void;
  onCancel?:    () => void;
}

const SLOTS = 4;

export default function PairingScreen({
  title,
  subtitle,
  expectedRole,
  onPaired,
  onCancel,
}: Props): React.ReactElement {
  const [tenantSlug, setTenantSlug] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(SLOTS).fill(''));
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inputs = useRef<Array<TextInput | null>>([]);

  const setDigit = (idx: number, raw: string) => {
    // Paste case — strip non-digits and fan out.
    const clean = raw.replace(/\D/g, '');
    if (clean.length > 1) {
      const next = [...digits];
      for (let i = 0; i < SLOTS; i++) {
        next[i] = clean[i] ?? '';
      }
      setDigits(next);
      const focusIdx = Math.min(clean.length, SLOTS - 1);
      inputs.current[focusIdx]?.focus();
      return;
    }
    const next = [...digits];
    next[idx] = clean;
    setDigits(next);
    if (clean && idx < SLOTS - 1) {
      inputs.current[idx + 1]?.focus();
    }
  };

  const onKeyPress = (idx: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    }
  };

  const code = digits.join('');
  const canSubmit = tenantSlug.trim().length > 0 && code.length === SLOTS && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await api.post<RedeemResponse>('/display-pairing/redeem', {
        tenantSlug: tenantSlug.trim().toLowerCase(),
        code,
      });
      // Role-fit sanity check
      if (expectedRole) {
        const wantsCustomer = expectedRole === 'CUSTOMER_DISPLAY';
        const wantsKds      = expectedRole.startsWith('KDS_');
        const gotCustomer   = res.role === 'CUSTOMER_DISPLAY';
        const gotKds        = res.role?.startsWith('KDS_');
        if (wantsCustomer && !gotCustomer) {
          setErrorMsg(`This code is for a ${res.role} device, not a customer display.`);
          setSubmitting(false);
          return;
        }
        if (wantsKds && !gotKds) {
          setErrorMsg(`This code is for a ${res.role} device, not a kitchen display.`);
          setSubmitting(false);
          return;
        }
      }
      const pairing: PairedDevice = {
        deviceToken: res.deviceToken,
        tenantId:    res.tenantId,
        tenantName:  res.tenantName,
        cashierId:   res.cashierId,
        role:        res.role,
        stationId:   res.stationId ?? null,
        label:       res.label ?? null,
      };
      onPaired(pairing);
    } catch (err) {
      if (err instanceof ApiHttpError) {
        if (err.status === 404 && /tenant/i.test(err.message)) {
          setErrorMsg('Tenant not found. Double-check the tenant ID.');
        } else if (err.status === 404) {
          setErrorMsg('Code not found. Ask your cashier for a new one.');
        } else if (err.status === 400 && /expired/i.test(err.message)) {
          setErrorMsg('Code expired. Ask your cashier for a fresh one.');
        } else if (err.status === 400 && /used|revoked/i.test(err.message)) {
          setErrorMsg('Code already used or revoked. Generate a new one on the cashier till.');
        } else if (err.status === 0) {
          setErrorMsg('No network connection. Check Wi-Fi and try again.');
        } else {
          setErrorMsg(err.message || 'Pairing failed. Please try again.');
        }
      } else {
        setErrorMsg('Pairing failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <PaperInput
            label="Tenant ID"
            placeholder={`same as you use on ${getWebHost()}`}
            value={tenantSlug}
            onChangeText={setTenantSlug}
            autoCapitalize="none"
            autoCorrect={false}
            mode="outlined"
            style={styles.tenantInput}
            disabled={submitting}
          />

          <Text style={styles.codeLabel}>4-digit pairing code</Text>
          <View style={styles.codeRow}>
            {digits.map((d, idx) => (
              <TextInput
                key={idx}
                ref={(el) => { inputs.current[idx] = el; }}
                value={d}
                onChangeText={(t) => setDigit(idx, t)}
                onKeyPress={(e) => onKeyPress(idx, e)}
                keyboardType="number-pad"
                maxLength={SLOTS} // allow paste of full code into slot 0
                autoFocus={idx === 0}
                style={styles.codeBox}
                editable={!submitting}
                selectTextOnFocus
                returnKeyType="done"
              />
            ))}
          </View>

          {errorMsg ? (
            <HelperText type="error" visible style={styles.errorText}>
              {errorMsg}
            </HelperText>
          ) : null}

          <Button
            mode="contained"
            onPress={submit}
            loading={submitting}
            disabled={!canSubmit}
            style={styles.submit}
            contentStyle={styles.submitContent}
            labelStyle={styles.submitLabel}
          >
            Pair this device
          </Button>

          {onCancel ? (
            <Pressable onPress={onCancel} style={styles.cancel}>
              <Text style={styles.cancelText}>Back</Text>
            </Pressable>
          ) : null}

          <Text style={styles.footer}>
            Ask your cashier to tap Settings → Displays → Generate code
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg },
  scroll:  { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.s5 },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.s6,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  title:       { ...text.displayMd, color: colors.ink, textAlign: 'center' },
  subtitle:    { ...text.bodySm, color: colors.muted, textAlign: 'center', marginTop: spacing.s2, marginBottom: spacing.s5 },
  tenantInput: { backgroundColor: colors.surface, marginBottom: spacing.s4 },
  codeLabel:   { ...text.caption, color: colors.muted, marginBottom: spacing.s2, textTransform: 'uppercase', letterSpacing: 1 },
  codeRow:     { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.s3 },
  codeBox: {
    flex: 1,
    height: 96,
    borderRadius: radii.md,
    backgroundColor: colors.creamSoft,
    borderWidth: 2,
    borderColor: colors.ruleStrong,
    textAlign: 'center',
    fontFamily: 'PlusJakartaSans',
    fontSize: 56,
    fontWeight: '800',
    color: colors.ink,
    ...tnum,
  },
  errorText:    { marginTop: spacing.s2 },
  submit:       { marginTop: spacing.s5, borderRadius: radii.md },
  submitContent:{ height: tap.cashierPrimary },
  submitLabel:  { ...text.bodyLg, fontWeight: '700' },
  cancel:       { alignSelf: 'center', marginTop: spacing.s3, padding: spacing.s2 },
  cancelText:   { ...text.body, color: colors.muted },
  footer:       { ...text.caption, color: colors.faint, textAlign: 'center', marginTop: spacing.s5 },
});
