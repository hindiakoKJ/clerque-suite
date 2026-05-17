/**
 * Clerque Counter — Settings → Displays
 *
 * Cashier-facing pairing-code generator. Owner / Branch Manager taps a role
 * (Customer / Kitchen / Bar), backend mints a one-shot 4-digit code valid
 * 15 min, and we render the code at 80pt + a QR encoding
 * `clerque.com/pair?code=XXXX&tenant=<slug>` so the secondary device can
 * scan it instead of typing.
 *
 * Paired devices are listed with a revoke action — revocation kicks the
 * device on its next poll.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { api, ApiHttpError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import TopBar from '@/shell/TopBar';
import QrCode from '@/device-mode/QrCode';
import { colors, radii, spacing, tap, text, tnum } from '@/theme';

interface PairingRow {
  id:         string;
  code:       string | null;
  role:       string;
  stationId:  string | null;
  label:      string | null;
  expiresAt:  string;
  redeemedAt: string | null;
  lastSeenAt: string | null;
  createdAt:  string;
}

interface RoleOption {
  role:  string;
  label: string;
  icon:  React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}

const ROLE_OPTIONS: RoleOption[] = [
  { role: 'CUSTOMER_DISPLAY', label: 'Customer display', icon: 'television' },
  { role: 'KDS_KITCHEN',      label: 'Kitchen display',  icon: 'silverware-fork-knife' },
  { role: 'KDS_BAR',          label: 'Bar display',      icon: 'coffee' },
];

interface Props { onMenuPress?: () => void }

export default function DisplaysScreen({ onMenuPress }: Props): React.ReactElement {
  const { tenant } = useAuth();
  const [rows, setRows] = useState<PairingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [modalCode, setModalCode] = useState<PairingRow | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const tenantSlug = (tenant as unknown as { slug?: string } | null)?.slug ?? tenant?.id ?? '';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.get<PairingRow[]>('/display-pairing');
      setRows(list);
      setErrMsg(null);
    } catch (err) {
      setErrMsg(err instanceof ApiHttpError ? err.message : 'Could not load paired devices.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const generate = async (role: string) => {
    setGenerating(role);
    setErrMsg(null);
    try {
      const row = await api.post<PairingRow>('/display-pairing/codes', { role });
      setModalCode(row);
      await refresh();
    } catch (err) {
      setErrMsg(err instanceof ApiHttpError ? err.message : 'Could not generate code.');
    } finally {
      setGenerating(null);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.del(`/display-pairing/${id}`);
      await refresh();
    } catch (err) {
      setErrMsg(err instanceof ApiHttpError ? err.message : 'Could not revoke device.');
    }
  };

  return (
    <View style={styles.root}>
      <TopBar onMenuPress={onMenuPress} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>Paired displays</Text>
        <Text style={styles.lead}>
          Hand a code to whoever is setting up a second device (customer screen,
          kitchen monitor, etc.). The code is good for 15 minutes and works once.
        </Text>

        <View style={styles.generateRow}>
          {ROLE_OPTIONS.map((opt) => (
            <Pressable
              key={opt.role}
              onPress={() => generate(opt.role)}
              disabled={!!generating}
              style={({ pressed }) => [
                styles.generateBtn,
                pressed && styles.generateBtnPressed,
                generating === opt.role && styles.generateBtnLoading,
              ]}
            >
              <MaterialCommunityIcons name={opt.icon} size={24} color={colors.primary} />
              <Text style={styles.generateBtnLabel}>{opt.label}</Text>
              <Text style={styles.generateBtnHint}>
                {generating === opt.role ? 'Generating…' : 'Generate code'}
              </Text>
            </Pressable>
          ))}
        </View>

        {errMsg ? <Text style={styles.errText}>{errMsg}</Text> : null}

        <Text style={styles.subhead}>Paired & pending</Text>
        {loading && rows.length === 0 ? (
          <Text style={styles.emptyText}>Loading…</Text>
        ) : rows.length === 0 ? (
          <Text style={styles.emptyText}>No displays yet.</Text>
        ) : (
          <View style={styles.list}>
            {rows.map((r) => (
              <View key={r.id} style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listRowTitle}>
                    {r.label ?? prettyRole(r.role)}
                  </Text>
                  <Text style={styles.listRowSub}>
                    {r.redeemedAt
                      ? `Paired ${new Date(r.redeemedAt).toLocaleString()}`
                      : `Pending — code expires ${new Date(r.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                  </Text>
                </View>
                <Pressable onPress={() => revoke(r.id)} style={styles.revokeBtn}>
                  <Text style={styles.revokeBtnText}>Revoke</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!modalCode} transparent animationType="fade" onRequestClose={() => setModalCode(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Pairing code</Text>
            <Text style={styles.modalSub}>
              Enter on the new device, or scan the QR with the camera.
            </Text>
            <Text style={styles.bigCode}>{modalCode?.code ?? '—'}</Text>
            <View style={styles.qrWrap}>
              {modalCode?.code ? (
                <QrCode
                  size={220}
                  value={`https://clerque.com/pair?code=${encodeURIComponent(modalCode.code)}&tenant=${encodeURIComponent(tenantSlug)}`}
                />
              ) : null}
            </View>
            <Text style={styles.modalHint}>
              Expires in 15 minutes. Single-use.
            </Text>
            <Button
              mode="contained"
              onPress={() => setModalCode(null)}
              style={styles.modalDone}
              contentStyle={styles.modalDoneContent}
              labelStyle={styles.modalDoneLabel}
            >
              Done
            </Button>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function prettyRole(role: string): string {
  return role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg },
  scroll:  { padding: spacing.s5, gap: spacing.s3 },
  heading: { ...text.displayMd, color: colors.ink },
  lead:    { ...text.bodySm, color: colors.muted, marginBottom: spacing.s4 },

  generateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s3, marginBottom: spacing.s4 },
  generateBtn: {
    flexBasis: 200, flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.rule,
    padding: spacing.s4,
    alignItems: 'center', gap: spacing.s2,
  },
  generateBtnPressed: { backgroundColor: colors.creamSoft, borderColor: colors.ruleStrong },
  generateBtnLoading: { opacity: 0.6 },
  generateBtnLabel:   { ...text.body, color: colors.ink, fontWeight: '600' },
  generateBtnHint:    { ...text.caption, color: colors.primary, textTransform: 'uppercase', letterSpacing: 1 },

  errText: { ...text.bodySm, color: colors.errorDeep, marginBottom: spacing.s2 },

  subhead:  { ...text.displaySm, color: colors.ink, marginTop: spacing.s4, marginBottom: spacing.s2 },
  emptyText:{ ...text.bodySm, color: colors.muted },

  list: { gap: spacing.s2 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.rule,
    paddingHorizontal: spacing.s4,
    paddingVertical:   spacing.s3,
    gap: spacing.s3,
    minHeight: 56,
  },
  listRowTitle: { ...text.body, color: colors.ink, fontWeight: '600' },
  listRowSub:   { ...text.caption, color: colors.muted, marginTop: 2 },
  revokeBtn: {
    paddingHorizontal: spacing.s3,
    paddingVertical:   spacing.s2,
    borderRadius: radii.sm,
    backgroundColor: colors.errorSoft,
  },
  revokeBtnText: { ...text.caption, color: colors.errorDeep, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.s5 },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.s6,
    alignItems: 'center',
    width: '100%',
    maxWidth: 420,
  },
  modalTitle:  { ...text.displaySm, color: colors.ink },
  modalSub:    { ...text.bodySm, color: colors.muted, textAlign: 'center', marginTop: spacing.s2, marginBottom: spacing.s4 },
  bigCode: {
    fontFamily: 'PlusJakartaSans',
    fontSize: 80,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 8,
    ...tnum,
  },
  qrWrap:      { marginTop: spacing.s4, padding: spacing.s3, backgroundColor: '#FFFFFF', borderRadius: radii.md },
  modalHint:   { ...text.caption, color: colors.faint, marginTop: spacing.s4 },
  modalDone:   { marginTop: spacing.s5, borderRadius: radii.md, alignSelf: 'stretch' },
  modalDoneContent: { height: tap.default },
  modalDoneLabel:   { ...text.body, fontWeight: '700' },
});
