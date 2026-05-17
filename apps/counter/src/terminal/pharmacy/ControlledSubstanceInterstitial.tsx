/**
 * ControlledSubstanceInterstitial — full-screen blocker shown BEFORE a
 * DDB_S2 (Schedule II) line is added to the cart.
 *
 * Shows the drug + dosage prominently, plus the regulatory citation
 * (RA 9165 §61 — Comprehensive Dangerous Drugs Act of 2002).
 *
 * Actions:
 *   - Cancel    → resolves with `null`, line is not added.
 *   - Authorize → calls `openSupervisorPin({ reason, requirePrcLicense: true })`.
 *     If the supervisor PIN check succeeds and the supervisor has an active
 *     PRC license, this resolves with the supervisor's id; otherwise null.
 *
 * The supervisor PIN modal is owned by another agent (see spec). We import
 * its async helper and pass the required-PRC flag.
 */

import React from 'react';
import { View, Text, Modal, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radii, text, tap, elevation } from '@/theme/tokens';
import { openSupervisorPin } from '@/auth/openSupervisorPin';

export interface ControlledAuthResult {
  supervisorId: string;
  role: string;
}

interface Props {
  visible: boolean;
  drugName: string;
  dosage: string;
  onCancel: () => void;
  onAuthorized: (result: ControlledAuthResult) => void;
}

export const ControlledSubstanceInterstitial: React.FC<Props> = ({
  visible,
  drugName,
  dosage,
  onCancel,
  onAuthorized,
}) => {
  const [submitting, setSubmitting] = React.useState(false);

  const handleAuthorize = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await openSupervisorPin({
        reason: `Dispense controlled drug · ${drugName}`,
        requirePrcLicense: true,
      });
      if (result) {
        onAuthorized(result);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Schedule II controlled drug · supervisor PIN required per RA 9165 §61
            </Text>
          </View>

          <View style={styles.body}>
            <Text style={styles.drugName}>{drugName}</Text>
            <Text style={styles.dosage}>{dosage}</Text>

            <Text style={styles.policy}>
              Adding this drug to the order requires a pharmacist with an active PRC
              license to authorize. The dispense will be recorded in the controlled-drug
              register and reported to FDA.
            </Text>

            <View style={styles.row}>
              <Pressable onPress={onCancel} style={[styles.secondaryBtn, { flex: 1 }]}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleAuthorize}
                disabled={submitting}
                style={[styles.primaryCta, submitting && styles.primaryCtaDisabled, { flex: 2 }]}
              >
                <Text style={styles.primaryCtaText}>
                  {submitting ? 'Awaiting PIN…' : 'Authorize'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.s5 },
  card: { width: '100%', maxWidth: 560, backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden', ...elevation.e4 },
  banner: { backgroundColor: colors.error, paddingHorizontal: spacing.s4, paddingVertical: spacing.s3 },
  bannerText: { ...text.bodySm, color: colors.onPrimary, fontWeight: '700' },
  body: { padding: spacing.s5 },
  drugName: { ...text.displayLg, color: colors.ink },
  dosage: { ...text.bodyLg, color: colors.muted, marginTop: spacing.s1 },
  policy: { ...text.body, color: colors.ink, marginTop: spacing.s4, lineHeight: 22 },
  row: { flexDirection: 'row', gap: spacing.s3, marginTop: spacing.s5 },
  primaryCta: {
    backgroundColor: colors.error,
    height: tap.cashierPrimary,
    borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryCtaDisabled: { backgroundColor: colors.ruleStrong },
  primaryCtaText: { ...text.cashierLg, color: colors.onPrimary },
  secondaryBtn: {
    height: tap.cashierPrimary,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.rule,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  secondaryBtnText: { ...text.body, color: colors.ink, fontWeight: '600' },
});

export default ControlledSubstanceInterstitial;
