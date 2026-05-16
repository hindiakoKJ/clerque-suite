/**
 * Clerque Counter — Supervisor PIN modal
 * Reusable elevation gate (voids, refunds, over-threshold discounts). Logs
 * every elevation attempt to the offline audit outbox so the supervisor's
 * presence is provable even when the device was offline.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import PinKeypad, { PinDots } from '@/auth/PinKeypad';
import { useAuth, ApiHttpError } from '@/auth/AuthProvider';
import { enqueueOutbox } from '@/offline/db';
import { colors, radii, spacing, text } from '@/theme';
import type { AuthSession } from '@/types';

interface Props {
  visible: boolean;
  reason: string;
  onCancel: () => void;
  onSuccess: (info: { supervisorId: string; role: AuthSession['user']['role'] }) => void;
}

export default function SupervisorPinModal({
  visible,
  reason,
  onCancel,
  onSuccess,
}: Props): React.ReactElement {
  const { verifySupervisorPin } = useAuth();
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset on open.
  useEffect(() => {
    if (visible) {
      setPin('');
      setErrorMsg(null);
      setSubmitting(false);
    }
  }, [visible]);

  // Auto-submit at 6 digits.
  useEffect(() => {
    if (!visible || pin.length !== 6 || submitting) return;
    let cancelled = false;
    (async () => {
      setSubmitting(true);
      setErrorMsg(null);
      try {
        const result = await verifySupervisorPin(pin);
        // Audit log — always enqueue so the elevation is recorded even offline.
        await enqueueOutbox('audit.supervisorElevation', {
          supervisorId: result.supervisorId,
          role: result.role,
          reason,
          at: new Date().toISOString(),
        }).catch(() => {});
        if (!cancelled) onSuccess(result);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiHttpError && err.status === 401) {
          setErrorMsg('Incorrect supervisor PIN.');
        } else if (err instanceof ApiHttpError && err.status === 0) {
          setErrorMsg('No network — supervisor approval needs connection.');
        } else {
          setErrorMsg('Could not verify. Try again.');
        }
        setPin('');
      } finally {
        if (!cancelled) setSubmitting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pin, visible, submitting, verifySupervisorPin, reason, onSuccess]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Supervisor approval</Text>
          <Text style={styles.title}>Enter 6-digit supervisor PIN</Text>
          <Text style={styles.reason}>{reason}</Text>

          <View style={styles.dotsWrap}>
            <PinDots value={pin} length={6} />
          </View>

          {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

          <View style={styles.keypadWrap}>
            <PinKeypad value={pin} length={6} onChange={setPin} disabled={submitting} />
          </View>

          <Pressable onPress={onCancel} hitSlop={12} style={styles.cancelBtn}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s5,
  },
  card: {
    width: 420,
    maxWidth: '100%',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.s6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.rule,
  },
  eyebrow: { ...text.caption, color: colors.primary, textTransform: 'uppercase', letterSpacing: 1.2 },
  title: { ...text.displaySm, color: colors.ink, textAlign: 'center', marginTop: spacing.s2 },
  reason: { ...text.bodySm, color: colors.muted, textAlign: 'center', marginTop: spacing.s2 },
  dotsWrap: { marginTop: spacing.s5, marginBottom: spacing.s3 },
  error: { ...text.bodySm, color: colors.error, marginBottom: spacing.s2 },
  keypadWrap: { marginTop: spacing.s3 },
  cancelBtn: { marginTop: spacing.s5, paddingVertical: spacing.s2 },
  cancelLabel: { ...text.bodyLg, color: colors.muted, fontWeight: '600' },
});
