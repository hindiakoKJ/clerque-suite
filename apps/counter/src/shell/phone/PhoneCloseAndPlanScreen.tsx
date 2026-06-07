/**
 * Clerque Counter — Phone Close & Plan
 *
 * Mobile evening routine for bakery owners. Mirrors the web admin page
 * at /pos/close-and-plan but as a native React Native screen so the
 * owner can use either surface depending on where they are at night.
 *
 * Sections (vertical scroll):
 *   1. Today recap (gross sales, orders, voids, shift status)
 *   2. Today's deliveries (optional, with live duplicate detection)
 *   3. Tomorrow's plan (bake list / use-first / pickups)
 *   4. Print morning briefing (via BluetoothPrinterService.printRaw)
 *
 * Duplicate detection: when the owner adds a delivery line, hits the
 * API check. If candidates returned, the line shows an amber warning
 * card; "Skip" removes the draft, "Save anyway" overrides.
 */
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { api } from '@/api/client';
import { useBranchContext } from '@/api/BranchContext';
import { getPrinterService } from '@/receipt/printerService';
import { formatPeso } from '@/components/Money';
import { colors, radii, spacing, text as textTokens, tnum } from '@/theme';

interface BakeItem {
  productName:    string;
  recommendedQty: number;
  reason?:        string;
  unit?:          string;
}
interface UseFirstItem {
  rawMaterialName: string;
  lotCode:         string;
  qtyRemaining:    number;
  unit:            string;
  expirationDate:  string | null;
  tier:            'USE_FIRST' | 'EXPIRING_SOON' | 'EXPIRED' | 'NORMAL';
}
interface Pickup { time: string; customerName: string; details: string }
interface DaySummary {
  date:                   string;
  bakeryName:             string;
  grossSalesCents:        number;
  netSalesCents:          number;
  orderCount:             number;
  voidCount:              number;
  shiftStatus:            'OPEN' | 'CLOSED' | 'NONE';
  bakeListTomorrow:       BakeItem[];
  useFirstTomorrow:       UseFirstItem[];
  pickupsTomorrow:        Pickup[];
  pickupsCount:           number;
  stickersNeedingReprint: number;
}

interface RawMaterial { id: string; name: string; unit?: string | null; costPrice?: number }

interface DupeCandidate {
  id:              string;
  rawMaterialName: string;
  qtyReceived:     number;
  qtyRemaining:    number;
  expirationDate:  string | null;
  receivedAt:      string;
  ageMinutes:      number;
  score:           number;
}

interface Draft {
  key:             string;
  rawMaterialId:   string;
  rawMaterialName: string;
  qtyReceived:     number;
  unitCost:        number;
  expirationDate:  string;
  unit?:           string;
  dupesPending?:   DupeCandidate[];
  dupeOverride?:   boolean;
  saved?:          boolean;
}

export default function PhoneCloseAndPlanScreen(): React.ReactElement {
  const { activeBranch } = useBranchContext();
  const branchId = activeBranch?.id ?? '';
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();

  const summaryQ = useQuery<DaySummary>({
    queryKey: ['close-and-plan', 'summary', branchId],
    enabled:  !!branchId,
    queryFn:  () => api.get<DaySummary>(
      `/close-and-plan/summary?branchId=${encodeURIComponent(branchId)}`,
    ),
    staleTime: 60_000,
  });

  const materialsQ = useQuery<RawMaterial[]>({
    queryKey: ['raw-materials'],
    queryFn:  () => api.get<RawMaterial[]>('/inventory/raw-materials'),
    staleTime: 300_000,
  });

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [picker, setPicker] = useState({
    rawMaterialId: '', qtyReceived: '1', unitCost: '0', expirationDate: '',
  });
  const [printing, setPrinting] = useState(false);

  const addDraft = async () => {
    if (!picker.rawMaterialId) return;
    const material = materialsQ.data?.find((m) => m.id === picker.rawMaterialId);
    if (!material) return;
    const qty = Number(picker.qtyReceived);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const cost = Number(picker.unitCost);
    let dupes: DupeCandidate[] = [];
    try {
      dupes = await api.post<DupeCandidate[]>('/close-and-plan/check-duplicate', {
        branchId,
        rawMaterialId:  picker.rawMaterialId,
        qtyReceived:    qty,
        expirationDate: picker.expirationDate || null,
      });
    } catch {
      /* best-effort */
    }
    setDrafts((d) => [...d, {
      key:             `${Date.now()}-${Math.random()}`,
      rawMaterialId:   picker.rawMaterialId,
      rawMaterialName: material.name,
      qtyReceived:     qty,
      unitCost:        Number.isFinite(cost) ? cost : 0,
      expirationDate:  picker.expirationDate,
      unit:            material.unit ?? '',
      dupesPending:    dupes.length > 0 ? dupes : undefined,
    }]);
    setPicker({ rawMaterialId: '', qtyReceived: '1', unitCost: '0', expirationDate: '' });
    setShowAdd(false);
  };

  const removeDraft = (key: string) => setDrafts((d) => d.filter((x) => x.key !== key));
  const overrideDupe = (key: string) =>
    setDrafts((d) => d.map((x) => x.key === key ? { ...x, dupesPending: undefined, dupeOverride: true } : x));

  const saveM = useMutation({
    mutationFn: async () => {
      return await api.post<{ saved: { lotId: string; rawMaterialId: string; stickerTier: string }[] }>(
        '/close-and-plan/batch-receive',
        {
          branchId,
          lines: drafts.filter((d) => !d.saved).map((d) => ({
            rawMaterialId:  d.rawMaterialId,
            qtyReceived:    d.qtyReceived,
            unitCost:       d.unitCost,
            expirationDate: d.expirationDate || null,
            dupeOverride:   !!d.dupeOverride,
          })),
        },
      );
    },
    onSuccess: (res) => {
      setDrafts((d) => d.map((x) => {
        const hit = res.saved?.find((s) => s.rawMaterialId === x.rawMaterialId);
        return hit ? { ...x, saved: true } : x;
      }));
      qc.invalidateQueries({ queryKey: ['close-and-plan', 'summary'] });
    },
  });

  const handlePrint = async () => {
    if (!branchId) return;
    setPrinting(true);
    try {
      const res = await api.post<{ base64: string; length: number }>(
        '/close-and-plan/briefing/print',
        { branchId },
      );
      // Decode base64 → Uint8Array
      const binary = globalThis.atob(res.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      await getPrinterService().printRaw(bytes);
      Alert.alert('Briefing sent', 'Pull the printed sheet and stick it on the kitchen wall.');
    } catch (err) {
      Alert.alert('Print failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPrinting(false);
    }
  };

  const s = summaryQ.data;
  const hasPendingDupes = drafts.some((d) => d.dupesPending && d.dupesPending.length > 0);
  const draftsToSave = drafts.filter((d) => !d.saved && !d.dupesPending);

  return (
    <View style={styles.root}>
      <PhoneHeader title="Close & Plan" subtitle="Evening routine" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.s8 }]}
      >
        {/* Eyebrow */}
        <View style={styles.eyebrow}>
          <MaterialCommunityIcons name="weather-night" size={18} color={colors.warning} />
          <Text style={styles.eyebrowText}>EVENING ROUTINE</Text>
        </View>
        <Text style={styles.intro}>
          Take 5-15 minutes to wrap up today and prep tomorrow. The printed briefing goes on the kitchen wall.
        </Text>

        {/* ── Section 1: Today recap ── */}
        <Section icon="trending-up" title="Today recap">
          {summaryQ.isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : !s ? (
            <Text style={styles.muted}>No data yet for today.</Text>
          ) : (
            <View style={styles.statRow}>
              <Stat label="Gross sales" value={formatPeso(s.grossSalesCents)} highlight />
              <Stat label="Orders"      value={String(s.orderCount)} />
              <Stat label="Voids"       value={String(s.voidCount)} />
              <Stat label="Shift"       value={s.shiftStatus === 'OPEN' ? 'Open' : s.shiftStatus === 'CLOSED' ? 'Closed' : '—'} />
            </View>
          )}
        </Section>

        {/* ── Section 2: Add deliveries ── */}
        <Section icon="package-variant" title="Today's deliveries">
          {drafts.length === 0 && !showAdd && (
            <Text style={styles.muted}>No deliveries to record? You can skip this section.</Text>
          )}

          {drafts.map((d) => (
            <View key={d.key} style={[styles.draftCard, d.saved && styles.draftCardSaved]}>
              <View style={styles.row}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.draftName} numberOfLines={1}>{d.rawMaterialName}</Text>
                  <Text style={styles.draftMeta}>
                    {d.qtyReceived} {d.unit} · {formatPeso(d.unitCost * 100)}/{d.unit ?? 'unit'}
                    {d.expirationDate ? ` · exp ${d.expirationDate}` : ''}
                  </Text>
                </View>
                {d.saved ? (
                  <View style={styles.savedBadge}>
                    <MaterialCommunityIcons name="check" size={16} color={colors.successDeep} />
                    <Text style={styles.savedText}>Saved</Text>
                  </View>
                ) : (
                  <Pressable onPress={() => removeDraft(d.key)} hitSlop={8}>
                    <MaterialCommunityIcons name="close" size={20} color={colors.muted} />
                  </Pressable>
                )}
              </View>

              {d.dupesPending && d.dupesPending.length > 0 && (
                <View style={styles.dupeBox}>
                  <View style={styles.dupeHeader}>
                    <MaterialCommunityIcons name="alert" size={16} color={colors.warningDeep} />
                    <Text style={styles.dupeTitle}>Possible duplicate</Text>
                  </View>
                  <Text style={styles.dupeBody}>
                    You already entered a similar receive {Math.round(d.dupesPending[0].ageMinutes)} min ago:
                    {' '}{d.dupesPending[0].qtyReceived} {d.unit}
                    {d.dupesPending[0].expirationDate ? `, exp ${d.dupesPending[0].expirationDate.slice(0, 10)}` : ''}.
                  </Text>
                  <View style={styles.dupeButtons}>
                    <Pressable onPress={() => removeDraft(d.key)} style={[styles.dupeBtn, styles.dupeBtnGhost]}>
                      <Text style={styles.dupeBtnGhostText}>Skip - duplicate</Text>
                    </Pressable>
                    <Pressable onPress={() => overrideDupe(d.key)} style={[styles.dupeBtn, styles.dupeBtnSolid]}>
                      <Text style={styles.dupeBtnSolidText}>Save anyway</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          ))}

          {showAdd ? (
            <View style={styles.addCard}>
              <Text style={styles.addLabel}>Raw material</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.s2 }}>
                {(materialsQ.data ?? []).slice(0, 30).map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => setPicker({
                      ...picker,
                      rawMaterialId: m.id,
                      unitCost: String(m.costPrice ?? 0),
                    })}
                    style={[
                      styles.chip,
                      picker.rawMaterialId === m.id && styles.chipActive,
                    ]}
                  >
                    <Text style={[styles.chipText, picker.rawMaterialId === m.id && styles.chipTextActive]}>
                      {m.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={styles.fieldRow}>
                <View style={{ flex: 1, marginRight: spacing.s2 }}>
                  <Text style={styles.addLabel}>Quantity</Text>
                  <TextInput
                    value={picker.qtyReceived}
                    onChangeText={(t) => setPicker({ ...picker, qtyReceived: t })}
                    keyboardType="decimal-pad"
                    style={styles.input}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addLabel}>Cost / unit</Text>
                  <TextInput
                    value={picker.unitCost}
                    onChangeText={(t) => setPicker({ ...picker, unitCost: t })}
                    keyboardType="decimal-pad"
                    style={styles.input}
                  />
                </View>
              </View>

              <Text style={styles.addLabel}>Expiration (YYYY-MM-DD, optional)</Text>
              <TextInput
                value={picker.expirationDate}
                onChangeText={(t) => setPicker({ ...picker, expirationDate: t })}
                placeholder="2026-05-25"
                placeholderTextColor={colors.faint}
                style={styles.input}
              />

              <View style={styles.addButtons}>
                <Pressable onPress={() => setShowAdd(false)} style={[styles.cancelBtn]}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={addDraft}
                  disabled={!picker.rawMaterialId}
                  style={[styles.addBtn, !picker.rawMaterialId && styles.addBtnDisabled]}
                >
                  <Text style={styles.addBtnText}>Add</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => setShowAdd(true)} style={styles.addRow}>
              <MaterialCommunityIcons name="plus" size={20} color={colors.warningDeep} />
              <Text style={styles.addRowText}>Add a delivery</Text>
            </Pressable>
          )}

          {draftsToSave.length > 0 && (
            <Pressable
              onPress={() => saveM.mutate()}
              disabled={saveM.isPending || hasPendingDupes}
              style={[styles.saveBtn, (saveM.isPending || hasPendingDupes) && styles.saveBtnDisabled]}
            >
              {saveM.isPending ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.saveBtnText}>
                  Save {draftsToSave.length} delivery item{draftsToSave.length === 1 ? '' : 's'}
                </Text>
              )}
            </Pressable>
          )}
        </Section>

        {/* ── Section 3: Tomorrow plan ── */}
        <Section icon="clipboard-list" title="Tomorrow's plan">
          {/* Bake list */}
          <SubHeader icon="chef-hat" text="Bake list" />
          {(s?.bakeListTomorrow?.length ?? 0) === 0 ? (
            <Text style={styles.muted}>No products with recent sales yet.</Text>
          ) : (
            s!.bakeListTomorrow.map((b, i) => (
              <View key={i} style={styles.bakeRow}>
                <Text style={styles.bakeName}>{b.productName}</Text>
                <Text style={[styles.bakeQty, tnum]}>{b.recommendedQty}{b.unit ? ' ' + b.unit : ''}</Text>
              </View>
            ))
          )}

          {/* Use first */}
          <View style={{ height: spacing.s3 }} />
          <SubHeader icon="alert-circle" text="Use first" />
          {(s?.useFirstTomorrow?.length ?? 0) === 0 ? (
            <Text style={styles.muted}>Nothing flagged.</Text>
          ) : (
            s!.useFirstTomorrow.map((u, i) => (
              <View
                key={i}
                style={[
                  styles.useFirstRow,
                  u.tier === 'USE_FIRST'     && styles.useFirstUF,
                  u.tier === 'EXPIRING_SOON' && styles.useFirstSoon,
                  u.tier === 'EXPIRED'       && styles.useFirstExp,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.useFirstName}>{u.rawMaterialName}</Text>
                  <Text style={styles.useFirstMeta}>
                    Lot {u.lotCode} · {u.qtyRemaining} {u.unit}
                    {u.expirationDate ? ` · exp ${u.expirationDate.slice(0, 10)}` : ''}
                  </Text>
                </View>
                <Text style={[
                  styles.useFirstTag,
                  u.tier === 'USE_FIRST'     && { color: colors.warningDeep },
                  u.tier === 'EXPIRING_SOON' && { color: colors.warning    },
                  u.tier === 'EXPIRED'       && { color: colors.error      },
                ]}>
                  {u.tier === 'USE_FIRST' ? 'USE FIRST'
                    : u.tier === 'EXPIRING_SOON' ? 'SOON'
                    : u.tier === 'EXPIRED' ? 'EXPIRED' : ''}
                </Text>
              </View>
            ))
          )}

          {/* Pickups */}
          <View style={{ height: spacing.s3 }} />
          <SubHeader icon="shopping" text="Pickups" />
          {(s?.pickupsTomorrow?.length ?? 0) === 0 ? (
            <Text style={styles.muted}>No scheduled pickups.</Text>
          ) : (
            s!.pickupsTomorrow.map((p, i) => (
              <View key={i} style={styles.pickupRow}>
                <Text style={styles.pickupTime}>{p.time}</Text>
                <Text style={styles.pickupName}>{p.customerName}</Text>
                <Text style={styles.pickupDetails}>{p.details}</Text>
              </View>
            ))
          )}
        </Section>

        {/* ── Section 4: Print briefing ── */}
        <View style={styles.printCard}>
          <Text style={styles.printTitle}>Done with tonight?</Text>
          <Text style={styles.printBody}>
            Print the morning briefing — one sheet for the cook. Stick it on the kitchen wall before you go to bed.
          </Text>
          <Pressable
            onPress={handlePrint}
            disabled={printing}
            style={[styles.printBtn, printing && styles.printBtnDisabled]}
          >
            {printing ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <>
                <MaterialCommunityIcons name="printer" size={20} color={colors.onPrimary} />
                <Text style={styles.printBtnText}>Print morning briefing</Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────
function Section({
  icon, title, children,
}: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <MaterialCommunityIcons name={icon} size={16} color={colors.muted} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function SubHeader({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.subHeader}>
      <MaterialCommunityIcons name={icon} size={14} color={colors.warningDeep} />
      <Text style={styles.subHeaderText}>{text}</Text>
    </View>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={[styles.stat, highlight && styles.statHighlight]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tnum, highlight && styles.statValueHighlight]}>{value}</Text>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.s4, gap: spacing.s4 },

  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  eyebrowText: { ...textTokens.caption, color: colors.warningDeep, fontWeight: '700', letterSpacing: 1.2 },
  intro: { ...textTokens.bodySm, color: colors.muted },

  section: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.s4,
    gap: spacing.s2,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  sectionTitle: { ...textTokens.caption, color: colors.muted, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },

  subHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2, marginBottom: spacing.s1 },
  subHeaderText: { ...textTokens.body, color: colors.ink, fontWeight: '600' },

  muted: { ...textTokens.bodySm, color: colors.muted, fontStyle: 'italic' },

  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s2 },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 100,
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    padding: spacing.s3,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  statHighlight: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  statLabel: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { ...textTokens.displaySm, color: colors.ink, fontSize: 18, fontWeight: '700' },
  statValueHighlight: { color: colors.warningDeep },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.s2 },

  draftCard: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    padding: spacing.s3,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  draftCardSaved: { backgroundColor: colors.successSoft, borderColor: colors.successDeep },
  draftName: { ...textTokens.body, color: colors.ink, fontWeight: '600' },
  draftMeta: { ...textTokens.caption, color: colors.muted, marginTop: 2 },
  savedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  savedText: { ...textTokens.caption, color: colors.successDeep, fontWeight: '600' },

  dupeBox: {
    marginTop: spacing.s3,
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.s3,
    gap: spacing.s2,
  },
  dupeHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dupeTitle: { ...textTokens.bodySm, color: colors.warningDeep, fontWeight: '700' },
  dupeBody: { ...textTokens.caption, color: colors.ink, lineHeight: 18 },
  dupeButtons: { flexDirection: 'row', gap: spacing.s2, marginTop: spacing.s1 },
  dupeBtn: { flex: 1, paddingVertical: 10, borderRadius: radii.sm, alignItems: 'center' },
  dupeBtnGhost: { backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.warning },
  dupeBtnGhostText: { ...textTokens.caption, color: colors.warningDeep, fontWeight: '600' },
  dupeBtnSolid: { backgroundColor: colors.warningDeep },
  dupeBtnSolidText: { ...textTokens.caption, color: colors.onPrimary, fontWeight: '600' },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s2,
    backgroundColor: colors.bg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.rule,
    borderRadius: radii.md,
    padding: spacing.s3,
  },
  addRowText: { ...textTokens.body, color: colors.warningDeep, fontWeight: '600' },

  addCard: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    padding: spacing.s3,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: spacing.s2,
  },
  addLabel: { ...textTokens.caption, color: colors.muted, marginBottom: 4 },
  chip: {
    paddingHorizontal: spacing.s3,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.rule,
    marginRight: spacing.s2,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.warningDeep, borderColor: colors.warningDeep },
  chipText: { ...textTokens.caption, color: colors.ink },
  chipTextActive: { color: colors.onPrimary, fontWeight: '700' },
  fieldRow: { flexDirection: 'row' },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s2,
    ...textTokens.body,
    color: colors.ink,
  },
  addButtons: { flexDirection: 'row', gap: spacing.s2, marginTop: spacing.s2 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.rule, alignItems: 'center' },
  cancelText: { ...textTokens.body, color: colors.ink, fontWeight: '600' },
  addBtn: { flex: 1, backgroundColor: colors.warningDeep, paddingVertical: 12, borderRadius: radii.sm, alignItems: 'center' },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { ...textTokens.body, color: colors.onPrimary, fontWeight: '700' },

  saveBtn: {
    backgroundColor: colors.successDeep,
    paddingVertical: 14,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: spacing.s2,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { ...textTokens.body, color: colors.onPrimary, fontWeight: '700' },

  bakeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  bakeName: { ...textTokens.body, color: colors.ink },
  bakeQty: { ...textTokens.body, color: colors.ink, fontWeight: '700' },

  useFirstRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.s3,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.rule,
    marginBottom: spacing.s2,
  },
  useFirstUF: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  useFirstSoon: { backgroundColor: colors.warningSoft, borderColor: colors.warning, opacity: 0.85 },
  useFirstExp: { backgroundColor: colors.errorSoft, borderColor: colors.error },
  useFirstName: { ...textTokens.body, color: colors.ink, fontWeight: '600' },
  useFirstMeta: { ...textTokens.caption, color: colors.muted, marginTop: 2 },
  useFirstTag: { ...textTokens.caption, fontWeight: '700', letterSpacing: 0.6 },

  pickupRow: { paddingVertical: 6 },
  pickupTime: { ...textTokens.bodySm, color: colors.warningDeep, fontWeight: '700' },
  pickupName: { ...textTokens.body, color: colors.ink, fontWeight: '600' },
  pickupDetails: { ...textTokens.caption, color: colors.muted },

  printCard: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning,
    borderWidth: 2,
    borderRadius: radii.lg,
    padding: spacing.s4,
    gap: spacing.s2,
  },
  printTitle: { ...textTokens.bodyLg, color: colors.warningDeep, fontWeight: '700' },
  printBody: { ...textTokens.bodySm, color: colors.ink },
  printBtn: {
    backgroundColor: colors.warningDeep,
    paddingVertical: 16,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s2,
    marginTop: spacing.s2,
  },
  printBtnDisabled: { opacity: 0.5 },
  printBtnText: { ...textTokens.body, color: colors.onPrimary, fontWeight: '700' },
});
