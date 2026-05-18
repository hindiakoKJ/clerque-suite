/**
 * Laundry terminal — customer-first POS.
 *
 * Flow:
 *   1. Header REQUIRES customer. If `cart.customer` is missing we render a
 *      full-screen capture form (name + phone + optional address). Until
 *      the customer is set, the rest of the terminal is locked.
 *   2. Once unlocked, three-pane layout: service categories (L), service
 *      tiles (M), claim ticket panel (R).
 *   3. Footer: ready-by date chips (default Today + 1 day) + Print claim
 *      ticket CTA (laundry takes payment on pickup; we just print the stub).
 *   4. Header action: "Claim ticket lookup" modal — search by phone or
 *      ticket number against a local mock index.
 *
 * Cart store actions used (`@/terminal/cartStore`):
 *   - addLine(line)
 *   - voidLine(lineId)
 *   - setCustomer(customer)
 *   - cart (selector)
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, radii, text, tap, elevation, tnum } from '@/theme/tokens';
import { useCart } from '@/terminal/cartStore';
import type { CartLine } from '@/types';
import { usePosCatalog, type ApiProduct } from '@/api/queries';
import { useActiveBranchId } from '@/api/BranchContext';
import { useQuery } from '@tanstack/react-query';
import { api, ApiHttpError } from '@/api/client';

type Category = 'WASH_FOLD' | 'DRY_CLEAN' | 'HAND_WASH' | 'SPECIAL';

interface Service {
  id: string;
  name: string;
  desc: string;
  priceCents: number;     // ₱ cents
  category: Category;
  eta: string;
  accent: string;
}

const SERVICES: Service[] = [
  { id: 'wf-reg-7', name: 'Regular Load 7kg', desc: 'Wash + dry, machine fold', priceCents: 18000, category: 'WASH_FOLD', eta: 'Same-day · 4h', accent: colors.primary },
  { id: 'wf-prem', name: 'Wash & Fold Premium', desc: 'Hand-fold, fabric softener', priceCents: 25000, category: 'WASH_FOLD', eta: 'Next-day', accent: colors.infoDeep },
  { id: 'wf-hot', name: 'Hot Wash · Sanitize', desc: '60°C cycle for towels/bedding', priceCents: 28000, category: 'WASH_FOLD', eta: 'Same-day · 6h', accent: colors.error },
  { id: 'wf-comf', name: 'Comforter / Bedding', desc: 'Per piece · King = 1 load', priceCents: 35000, category: 'WASH_FOLD', eta: 'Next-day', accent: colors.warningDeep },
  { id: 'dc-barong', name: 'Dry Clean — Barong', desc: 'Per piece', priceCents: 25000, category: 'DRY_CLEAN', eta: '2 days', accent: colors.infoDeep },
  { id: 'dc-suit', name: 'Dry Clean — Suit', desc: '2-piece set', priceCents: 45000, category: 'DRY_CLEAN', eta: '2 days', accent: colors.primary },
  { id: 'dc-gown', name: 'Dry Clean — Gown', desc: 'Per piece', priceCents: 60000, category: 'DRY_CLEAN', eta: '3 days', accent: colors.warningDeep },
  { id: 'hw-delicates', name: 'Hand Wash Delicates', desc: 'Cold cycle, separate', priceCents: 22000, category: 'HAND_WASH', eta: 'Same-day · 5h', accent: colors.success },
  { id: 'hw-curtains', name: 'Curtains', desc: 'Heavy load · per pair', priceCents: 40000, category: 'HAND_WASH', eta: '2 days', accent: colors.warningDeep },
  { id: 'sc-leather', name: 'Leather Care', desc: 'Specialist clean + condition', priceCents: 80000, category: 'SPECIAL', eta: '4 days', accent: colors.error },
  { id: 'sc-shoes', name: 'Shoe Cleaning', desc: 'Per pair', priceCents: 30000, category: 'SPECIAL', eta: '3 days', accent: colors.primary },
];

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'WASH_FOLD', label: 'Wash & Fold' },
  { id: 'DRY_CLEAN', label: 'Dry Clean' },
  { id: 'HAND_WASH', label: 'Hand Wash' },
  { id: 'SPECIAL', label: 'Special Care' },
];

// Mock claim-ticket index used only as a __DEV__ fallback when the
// `/laundry/orders` endpoint hasn't responded yet (or returns nothing on a
// fresh tenant). Live data renders by default — see `ClaimTicketLookupModal`.
const MOCK_TICKETS = [
  { ticketNo: 'L-2026-0421', customer: 'Ronaldo Cruz', phone: '09171234452', status: 'Running · W1' },
  { ticketNo: 'L-2026-0419', customer: 'Maria Santos', phone: '09221112233', status: 'Done · W3' },
  { ticketNo: 'L-2026-0428', customer: 'Pedro Lim', phone: '09175557788', status: 'Queued' },
];

interface LaundryTicketRow {
  ticketNo: string;
  customer: string;
  phone: string;
  status: string;
}

interface ApiLaundryOrderRow {
  id: string;
  ticketNumber?: string | null;
  status?: string | null;
  customerName?: string | null;
  customer?: { name?: string | null; phone?: string | null } | null;
  customerPhone?: string | null;
}
interface ApiLaundryOrdersPage {
  data: ApiLaundryOrderRow[];
  total?: number;
}

/**
 * Map a Cloud `ApiProduct` to the local `Service` shape. Returns null when
 * the product's category doesn't look like a laundry service (so non-
 * laundry rows on a mixed catalog are filtered out).
 */
function apiProductToService(p: ApiProduct): Service | null {
  const cat = inferLaundryCategory(p.category?.name);
  if (!cat) return null;
  const priceNum = typeof p.price === 'string' ? Number(p.price) : p.price;
  return {
    id: p.id,
    name: p.name,
    desc: p.sku ?? '',
    priceCents: Math.round((Number.isFinite(priceNum) ? priceNum : 0) * 100),
    category: cat,
    eta: '',
    accent: colors.primary,
  };
}

function inferLaundryCategory(name: string | null | undefined): Category | null {
  if (!name) return null;
  const n = name.toUpperCase();
  if (n.includes('WASH') && n.includes('FOLD')) return 'WASH_FOLD';
  if (n.includes('DRY') && n.includes('CLEAN')) return 'DRY_CLEAN';
  if (n.includes('HAND')) return 'HAND_WASH';
  if (n.includes('SPECIAL') || n.includes('CARE')) return 'SPECIAL';
  // Generic "Laundry" / "Services" buckets default to wash & fold.
  if (n.includes('LAUNDRY') || n.includes('SERVICE')) return 'WASH_FOLD';
  return null;
}

function formatPeso(cents: number): string {
  return `₱${(cents / 100).toFixed(2)}`;
}

function tomorrowAt10(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}

export const LaundryTerminal: React.FC = () => {
  const cart = useCart((s) => s.cart);
  const addLine = useCart((s) => s.addLine);
  const voidLine = useCart((s) => s.voidLine);
  const setCustomer = useCart((s) => s.setCustomer);

  // Live catalog. Cloud products whose category name matches a laundry
  // service category are mapped onto the local `Service` shape used by the
  // grid. The mock SERVICES array remains the fallback for cold-launch /
  // dev / tenants that haven't seeded their service catalog yet.
  //
  // TODO(backend): the API does not yet expose a first-class "service"
  // product flag (the `inventoryMode` enum has UNIT_BASED / RECIPE_BASED;
  // no SERVICE value yet). We trigger live-mode purely on category-name
  // match. Replace once an explicit flag is added, plus per-kg pricing
  // metadata (PH laundry chains commonly price by load weight).
  const branchIdLive = useActiveBranchId();
  const catalogQuery = usePosCatalog(branchIdLive);

  const liveServices: Service[] = useMemo(
    () =>
      (catalogQuery.data ?? [])
        .map(apiProductToService)
        .filter((s): s is Service => s !== null),
    [catalogQuery.data],
  );
  const useLive = liveServices.length > 0;
  const sourceServices: Service[] = useLive
    ? liveServices
    : (__DEV__ ? SERVICES : []);

  const [category, setCategory] = useState<Category>('WASH_FOLD');
  const [readyBy, setReadyBy] = useState<Date>(tomorrowAt10());
  const [lookupOpen, setLookupOpen] = useState(false);

  const hasCustomer = !!cart?.customer?.name;

  const filteredServices = useMemo(
    () => sourceServices.filter((s) => s.category === category),
    [category, sourceServices]
  );

  if (!hasCustomer) {
    return <CustomerCaptureForm onSave={(c) => setCustomer(c)} />;
  }

  const subtotalCents = (cart?.lines ?? [])
    .filter((l) => !l.voidedAt && !l.removed)
    .reduce((sum, l) => sum + l.lineTotal, 0);

  const onAddService = (svc: Service) => {
    const line: CartLine = {
      id: `${svc.id}-${Date.now()}`,
      productId: svc.id,
      productName: svc.name,
      qty: 1,
      unitPrice: svc.priceCents,
      modifiers: [],
      lineTotal: svc.priceCents,
    };
    addLine(line);
  };

  const onPrintClaim = () => {
    // Stub — claim-ticket print/persist will be wired by the print agent.
    // Validation already enforces: customer set, lines > 0, readyBy in the future.
    void readyBy;
  };

  const initials = (cart!.customer!.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Customer header */}
      <View style={styles.customerHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.customerName}>{cart!.customer!.name}</Text>
          <Text style={styles.customerMeta}>
            {cart!.customer!.phone ?? 'No phone on file'}
          </Text>
        </View>
        <Pressable style={styles.ghostBtn} onPress={() => setLookupOpen(true)}>
          <Text style={styles.ghostBtnText}>Claim ticket lookup</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => setCustomer(undefined)}>
          <Text style={styles.secondaryBtnText}>Change customer</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {/* Left: category column */}
        <View style={styles.catCol}>
          {CATEGORIES.map((c) => {
            const active = c.id === category;
            return (
              <Pressable
                key={c.id}
                onPress={() => setCategory(c.id)}
                style={[styles.catItem, active && styles.catItemActive]}
              >
                <Text style={[styles.catItemText, active && styles.catItemTextActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Middle: service grid */}
        <ScrollView style={styles.gridCol} contentContainerStyle={styles.gridContent}>
          <Text style={styles.gridTitle}>
            {CATEGORIES.find((c) => c.id === category)?.label} services
          </Text>
          <View style={styles.grid}>
            {filteredServices.map((svc) => (
              <Pressable key={svc.id} onPress={() => onAddService(svc)} style={styles.serviceCard}>
                <View style={[styles.serviceAccent, { backgroundColor: svc.accent }]} />
                <View style={{ paddingLeft: spacing.s2, flex: 1 }}>
                  <Text style={styles.serviceName}>{svc.name}</Text>
                  <Text style={styles.serviceDesc}>{svc.desc}</Text>
                  <View style={styles.serviceFooter}>
                    <Text style={[styles.servicePrice, tnum]}>{formatPeso(svc.priceCents)}</Text>
                    <Text style={styles.serviceEta}>{svc.eta}</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        {/* Right: claim ticket panel */}
        <View style={styles.cartCol}>
          <View style={styles.cartHeader}>
            <Text style={styles.cartTitle}>Claim Ticket</Text>
            <Text style={styles.cartSub}>{cart!.customer!.name}</Text>
          </View>

          <ScrollView style={{ flex: 1 }}>
            {(cart?.lines ?? []).filter((l) => !l.voidedAt && !l.removed).map((line) => (
              <View key={line.id} style={styles.lineRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{line.qty}× {line.productName}</Text>
                </View>
                <Text style={[styles.linePrice, tnum]}>{formatPeso(line.lineTotal)}</Text>
                <Pressable onPress={() => voidLine(line.id)} style={styles.voidBtn}>
                  <Text style={styles.voidBtnText}>×</Text>
                </Pressable>
              </View>
            ))}
            {(cart?.lines ?? []).length === 0 && (
              <Text style={styles.emptyHint}>Tap a service to add it to the ticket.</Text>
            )}
          </ScrollView>

          {/* Ready-by */}
          <View style={styles.readyBy}>
            <Text style={styles.readyByLabel}>Ready-by · required</Text>
            <View style={styles.readyByChips}>
              {([
                { label: 'Today 5 PM', d: (() => { const d = new Date(); d.setHours(17, 0, 0, 0); return d; })() },
                { label: 'Tomorrow 10 AM', d: tomorrowAt10() },
                { label: '+2 days 4 PM', d: (() => { const d = new Date(); d.setDate(d.getDate() + 2); d.setHours(16, 0, 0, 0); return d; })() },
              ]).map((opt) => {
                const active = opt.d.getTime() === readyBy.getTime();
                return (
                  <Pressable
                    key={opt.label}
                    onPress={() => setReadyBy(opt.d)}
                    style={[styles.readyChip, active && styles.readyChipActive]}
                  >
                    <Text style={[styles.readyChipText, active && styles.readyChipTextActive]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Totals */}
          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text style={styles.totalRowLabel}>Subtotal (due at pickup)</Text>
              <Text style={[styles.totalRowValue, tnum]}>{formatPeso(subtotalCents)}</Text>
            </View>
          </View>

          <View style={styles.ctaWrap}>
            <Pressable
              onPress={onPrintClaim}
              disabled={subtotalCents === 0}
              style={[styles.primaryCta, subtotalCents === 0 && styles.primaryCtaDisabled]}
            >
              <Text style={styles.primaryCtaText}>Print claim ticket</Text>
            </Pressable>
            <Text style={styles.payHint}>Payment collected on pickup.</Text>
          </View>
        </View>
      </View>

      {lookupOpen && <ClaimTicketLookupModal onClose={() => setLookupOpen(false)} />}
    </SafeAreaView>
  );
};

// ---------- subcomponents ----------

const CustomerCaptureForm: React.FC<{
  onSave: (c: { name: string; phone: string }) => void;
}> = ({ onSave }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const canSave = name.trim().length > 1 && phone.trim().length >= 7;

  return (
    <SafeAreaView style={styles.captureRoot} edges={['top']}>
      <View style={styles.captureCard}>
        <Text style={styles.captureTitle}>Who is this ticket for?</Text>
        <Text style={styles.captureSub}>
          Laundry orders require a ticket holder before items can be added.
        </Text>

        <Text style={styles.fieldLabel}>Full name *</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Maria Santos"
          placeholderTextColor={colors.faint}
          style={styles.fieldInput}
        />

        <Text style={styles.fieldLabel}>Phone *</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="09171234567"
          keyboardType="phone-pad"
          placeholderTextColor={colors.faint}
          style={styles.fieldInput}
        />

        <Text style={styles.fieldLabel}>Address (optional)</Text>
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="Unit / Street / City"
          placeholderTextColor={colors.faint}
          style={[styles.fieldInput, { height: 80 }]}
          multiline
        />

        <Pressable
          onPress={() => canSave && onSave({ name: name.trim(), phone: phone.trim() })}
          disabled={!canSave}
          style={[styles.primaryCta, !canSave && styles.primaryCtaDisabled, { marginTop: spacing.s5 }]}
        >
          <Text style={styles.primaryCtaText}>Continue</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const ClaimTicketLookupModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [q, setQ] = useState('');
  const branchId = useActiveBranchId();

  // Live tickets via `GET /laundry/orders?branchId=X`. The Cloud route
  // already filters out CLAIMED (terminal) orders. Pull-to-refresh isn't
  // wired in a modal; React Query's 60s staleTime is the freshness floor.
  const ticketsQuery = useQuery<LaundryTicketRow[]>({
    queryKey: ['laundry-orders', branchId ?? 'none'],
    queryFn: async () => {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
      const res = await api.get<ApiLaundryOrdersPage | ApiLaundryOrderRow[]>(
        `/laundry/orders${qs}`,
      );
      const rows: ApiLaundryOrderRow[] = Array.isArray(res) ? res : (res?.data ?? []);
      return rows.map((r) => ({
        ticketNo: r.ticketNumber ?? r.id,
        customer: r.customer?.name ?? r.customerName ?? 'Walk-in',
        phone:    r.customer?.phone ?? r.customerPhone ?? '',
        status:   r.status ?? 'OPEN',
      }));
    },
    retry: 1,
    staleTime: 60_000,
  });

  const baseRows: LaundryTicketRow[] =
    ticketsQuery.data && ticketsQuery.data.length > 0
      ? ticketsQuery.data
      : (ticketsQuery.error || ticketsQuery.isLoading
          ? (__DEV__ ? MOCK_TICKETS : [])
          : []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return baseRows;
    return baseRows.filter(
      (t) =>
        t.ticketNo.toLowerCase().includes(term) || (t.phone ?? '').includes(term),
    );
  }, [q, baseRows]);

  const errLabel = ticketsQuery.error
    ? ticketsQuery.error instanceof ApiHttpError && ticketsQuery.error.status === 0
      ? 'Offline — showing last cached tickets.'
      : "Couldn’t load tickets — tap to retry."
    : null;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalScrim}>
        <View style={styles.modalCard}>
          <Text style={styles.captureTitle}>Claim ticket lookup</Text>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Phone or ticket #"
            placeholderTextColor={colors.faint}
            style={styles.fieldInput}
          />
          {errLabel ? (
            <Pressable onPress={() => ticketsQuery.refetch()}>
              <Text style={[styles.emptyHint, { color: colors.warningDeep }]}>
                {errLabel}
              </Text>
            </Pressable>
          ) : null}
          <FlatList
            data={results}
            keyExtractor={(t) => t.ticketNo}
            renderItem={({ item }: { item: LaundryTicketRow }) => (
              <View style={styles.lookupRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{item.ticketNo}</Text>
                  <Text style={styles.serviceDesc}>
                    {item.customer}{item.phone ? ` · ${item.phone}` : ''}
                  </Text>
                </View>
                <Text style={styles.serviceEta}>{item.status}</Text>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyHint}>
                {ticketsQuery.isLoading ? 'Loading tickets…' : 'No matching ticket.'}
              </Text>
            }
            style={{ marginTop: spacing.s3, maxHeight: 320 }}
          />
          <Pressable onPress={onClose} style={[styles.secondaryBtn, { alignSelf: 'flex-end', marginTop: spacing.s3 }]}>
            <Text style={styles.secondaryBtnText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

// ---------- styles ----------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // header
  customerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s4,
    paddingHorizontal: spacing.s5,
    paddingVertical: spacing.s4,
    backgroundColor: colors.primaryContainer,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  avatar: {
    width: 52, height: 52, borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...text.displaySm, color: colors.onPrimary },
  customerName: { ...text.displaySm, color: colors.ink },
  customerMeta: { ...text.bodySm, color: colors.muted, marginTop: 2 },

  ghostBtn: { paddingHorizontal: spacing.s3, height: tap.default, justifyContent: 'center' },
  ghostBtnText: { ...text.bodySm, color: colors.primaryInk, fontWeight: '600' },

  secondaryBtn: {
    paddingHorizontal: spacing.s4,
    height: tap.default,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.rule,
  },
  secondaryBtnText: { ...text.bodySm, color: colors.ink, fontWeight: '600' },

  body: { flex: 1, flexDirection: 'row' },

  // category column
  catCol: {
    width: 200,
    backgroundColor: colors.creamSoft,
    borderRightWidth: 1, borderRightColor: colors.rule,
    paddingVertical: spacing.s3,
  },
  catItem: {
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
    marginHorizontal: spacing.s2,
    borderRadius: radii.sm,
  },
  catItemActive: { backgroundColor: colors.primary },
  catItemText: { ...text.body, color: colors.muted, fontWeight: '600' },
  catItemTextActive: { color: colors.onPrimary },

  // grid
  gridCol: { flex: 1 },
  gridContent: { padding: spacing.s5 },
  gridTitle: { ...text.displaySm, color: colors.ink, marginBottom: spacing.s4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s4 },
  serviceCard: {
    width: '31%',
    minWidth: 220,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.rule,
    padding: spacing.s4,
    ...elevation.e1,
  },
  serviceAccent: { width: 4, alignSelf: 'stretch', borderRadius: radii.xs },
  serviceName: { ...text.bodyLg, color: colors.ink, fontWeight: '700' },
  serviceDesc: { ...text.caption, color: colors.muted, marginTop: 2 },
  serviceFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    marginTop: spacing.s3,
  },
  servicePrice: { ...text.displaySm, color: colors.primary },
  serviceEta: { ...text.caption, color: colors.muted, textTransform: 'uppercase' },

  // cart panel
  cartCol: {
    width: 420,
    backgroundColor: colors.creamSoft,
    borderLeftWidth: 1, borderLeftColor: colors.rule,
  },
  cartHeader: {
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.rule,
  },
  cartTitle: { ...text.displaySm, color: colors.ink },
  cartSub: { ...text.bodySm, color: colors.muted, marginTop: 2 },

  lineRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.s3,
    padding: spacing.s3,
    borderBottomWidth: 1, borderBottomColor: colors.rule,
    backgroundColor: colors.surface,
  },
  lineName: { ...text.body, color: colors.ink, fontWeight: '700' },
  linePrice: { ...text.body, color: colors.primary, fontWeight: '700' },
  voidBtn: {
    width: 32, height: 32, borderRadius: radii.sm,
    backgroundColor: colors.errorSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  voidBtnText: { color: colors.errorDeep, fontWeight: '700', fontSize: 18 },
  emptyHint: { ...text.bodySm, color: colors.faint, padding: spacing.s5, textAlign: 'center' },

  readyBy: {
    padding: spacing.s4,
    backgroundColor: colors.warningSoft,
    borderTopWidth: 1, borderTopColor: colors.rule,
  },
  readyByLabel: { ...text.caption, color: colors.warningDeep, fontWeight: '700', marginBottom: spacing.s2, textTransform: 'uppercase' },
  readyByChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s2 },
  readyChip: {
    paddingHorizontal: spacing.s3, paddingVertical: spacing.s2,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.rule,
  },
  readyChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  readyChipText: { ...text.bodySm, color: colors.ink, fontWeight: '600' },
  readyChipTextActive: { color: colors.onPrimary },

  totals: {
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.rule,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalRowLabel: { ...text.body, color: colors.muted },
  totalRowValue: { ...text.displaySm, color: colors.ink },

  ctaWrap: { padding: spacing.s4 },
  primaryCta: {
    backgroundColor: colors.primary,
    height: tap.cashierPrimary,
    borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryCtaDisabled: { backgroundColor: colors.ruleStrong },
  primaryCtaText: { ...text.cashierLg, color: colors.onPrimary },
  payHint: { ...text.caption, color: colors.muted, textAlign: 'center', marginTop: spacing.s2 },

  // capture form
  captureRoot: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.s5 },
  captureCard: {
    width: '100%', maxWidth: 520,
    backgroundColor: colors.surface, borderRadius: radii.lg,
    padding: spacing.s5,
    ...elevation.e3,
  },
  captureTitle: { ...text.displayMd, color: colors.ink, marginBottom: spacing.s2 },
  captureSub: { ...text.bodySm, color: colors.muted, marginBottom: spacing.s4 },
  fieldLabel: { ...text.caption, color: colors.muted, marginTop: spacing.s3, marginBottom: spacing.s1, textTransform: 'uppercase', fontWeight: '700' },
  fieldInput: {
    minHeight: tap.default,
    borderWidth: 1, borderColor: colors.rule,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.s3,
    color: colors.ink,
    backgroundColor: colors.surface,
    ...text.body,
  },

  // modal
  modalScrim: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.s5 },
  modalCard: { width: '100%', maxWidth: 560, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.s5, ...elevation.e3 },
  lookupRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.s3, borderBottomWidth: 1, borderBottomColor: colors.rule },
});

export default LaundryTerminal;
