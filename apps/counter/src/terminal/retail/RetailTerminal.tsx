import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput, ScrollView,
} from 'react-native';
import { colors, spacing, radii, text as textTokens, tap, elevation, tnum } from '@/theme/tokens';
import { formatPeso } from '@/components/Money';
import LineItem from '@/components/LineItem';
import Pill from '@/components/Pill';
import { openBarcodeScanner } from '@/components/BarcodeScannerSheet';
import { RETAIL_PRODUCTS, RETAIL_CATEGORIES, RetailProduct } from '../mockCatalog';
import { useCartStore } from '../cartStore';
import type { CartLine } from '@/types';
import { usePosCatalog, useCustomerLookup, type ApiProduct } from '@/api/queries';
import { useActiveBranchId } from '@/api/BranchContext';

/** Adapt the Cloud `ApiProduct` to the local table row shape. */
function toRetailProduct(p: ApiProduct): RetailProduct {
  const priceNum = typeof p.price === 'string' ? Number(p.price) : p.price;
  const initials = (p.name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return {
    id: p.id,
    sku: p.sku ?? p.barcode ?? p.id.slice(0, 6),
    name: p.name,
    initials,
    price: Math.round(priceNum * 100),
    stock: p.maxProducible ?? 0,
    lowStock: p.isLowStock,
    ageRestricted: false,
    category: p.category?.name ?? 'All',
  };
}

type SupervisorPinAPI = {
  openSupervisorPin: (args: { reason: string }) => Promise<{ supervisorId: string; role: string }>;
};
async function loadSupervisorPin(): Promise<SupervisorPinAPI | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/auth/SupervisorPinModal') as SupervisorPinAPI;
  } catch {
    return null;
  }
}

interface RetailTerminalProps {
  /** From AuthProvider/TenantConfig. Optional so the terminal can render standalone. */
  customerPhoneLookupEnabled?: boolean;
}

export default function RetailTerminal({ customerPhoneLookupEnabled }: RetailTerminalProps) {
  const [query, setQuery] = useState('');
  const [tingiMode, setTingiMode] = useState(false);
  const [category, setCategory] = useState<string>('All');
  const [customerPhone, setCustomerPhone] = useState('');
  const [debouncedPhone, setDebouncedPhone] = useState('');
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const scanInputRef = useRef<TextInput>(null);

  const lines = useCartStore((s) => s.lines);
  const addLine = useCartStore((s) => s.addLine);
  const removeLine = useCartStore((s) => s.removeLine);
  const voidLine = useCartStore((s) => s.voidLine);
  const setCustomer = useCartStore((s) => s.setCustomer);
  const subtotal = useCartStore((s) => s.subtotal());
  const total = useCartStore((s) => s.total());
  const lineCount = useCartStore((s) => s.lineCount());

  // Live catalog with cached/mock fallback.
  const branchId = useActiveBranchId();
  const catalogQuery = usePosCatalog(branchId);
  const liveProducts = useMemo(
    () => (catalogQuery.data ?? []).map(toRetailProduct),
    [catalogQuery.data],
  );
  const useLive = liveProducts.length > 0;
  const sourceProducts: RetailProduct[] = useLive
    ? liveProducts
    : (__DEV__ ? RETAIL_PRODUCTS : []);

  // Categories: dedupe whatever the catalog exposes; fall back to mock list.
  const categoryList: readonly string[] = useLive
    ? ['All', ...Array.from(new Set(liveProducts.map((p) => p.category)))]
    : RETAIL_CATEGORIES;

  // Debounce phone input for the lookup (250ms).
  useEffect(() => {
    if (!customerPhoneLookupEnabled) return;
    const t = setTimeout(() => setDebouncedPhone(customerPhone), 250);
    return () => clearTimeout(t);
  }, [customerPhone, customerPhoneLookupEnabled]);

  const customerLookup = useCustomerLookup(
    debouncedPhone,
    !!customerPhoneLookupEnabled && showCustomerResults,
  );

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sourceProducts.filter((p) => {
      if (category !== 'All' && p.category !== category) return false;
      if (!q) return true;
      return p.sku.includes(q) || p.name.toLowerCase().includes(q);
    });
  }, [query, category, sourceProducts]);

  const showShimmer = catalogQuery.isLoading && sourceProducts.length === 0;

  const handleAdd = (p: RetailProduct) => {
    // tingi splits parent SKU pricing into per-piece. For demo: 1/10 of price.
    const unit = tingiMode ? Math.max(50, Math.round(p.price / 10)) : p.price;
    const name = tingiMode ? `${p.name} (tingi)` : p.name;
    addLine({
      productId: tingiMode ? `${p.id}-tingi` : p.id,
      productName: name,
      qty: 1,
      unitPrice: unit,
      variantName: tingiMode ? '1 pc' : undefined,
    });
  };

  const handleScanSubmit = () => {
    const q = query.trim();
    if (!q) return;
    const hit = sourceProducts.find((p) => p.sku === q);
    if (hit) {
      handleAdd(hit);
      setQuery('');
    }
  };

  const handleOpenScanner = async () => {
    try {
      const code = await openBarcodeScanner();
      if (!code) return;
      setQuery(code);
      // Let the SKU lookup fire on the next tick (state is async).
      const hit = sourceProducts.find((p) => p.sku === code);
      if (hit) {
        handleAdd(hit);
        setQuery('');
      } else {
        scanInputRef.current?.focus();
      }
    } catch {
      /* host not mounted yet — fallback to manual focus */
      scanInputRef.current?.focus();
    }
  };

  const handleLongPressLine = async (line: CartLine) => {
    const mod = await loadSupervisorPin();
    if (!mod) {
      voidLine(line.id, 'VOID', 'pending-supervisor');
      return;
    }
    try {
      const result = await mod.openSupervisorPin({ reason: 'VOID' });
      voidLine(line.id, 'VOID', result.supervisorId);
    } catch { /* cancelled */ }
  };

  const hasAgeRestricted = useMemo(
    () => lines.some((l) => !l.removed && !l.voidedAt && /18\+/.test(l.productName) === false && sourceProducts.find((p) => l.productId.startsWith(p.id))?.ageRestricted),
    [lines],
  );

  const visibleLines = lines.filter((l) => !l.removed || l.voidedAt);

  const renderRow = ({ item }: { item: RetailProduct }) => (
    <View style={styles.tableRow}>
      <Text style={styles.colSku}>{item.sku}</Text>
      <View style={styles.colName}>
        <Text style={styles.tableName}>{item.name}</Text>
        {item.ageRestricted && (
          <View style={styles.ageBadge}>
            <Text style={styles.ageBadgeText}>18+</Text>
          </View>
        )}
      </View>
      <Text style={[styles.colStock, item.lowStock && { color: colors.warningDeep, fontWeight: '700' }]}>
        {item.lowStock ? `Low · ${item.stock}` : item.stock}
      </Text>
      <Text style={[styles.colPrice, tnum]}>{formatPeso(item.price)}</Text>
      <Pressable
        onPress={() => handleAdd(item)}
        style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.addBtnText}>+</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.root}>
      {/* Customer phone lookup (gated by plan feature) */}
      {customerPhoneLookupEnabled && (
        <View style={styles.customerStrip}>
          <Text style={styles.customerLabel}>Customer phone</Text>
          <View style={{ flex: 1 }}>
            <TextInput
              value={customerPhone}
              onChangeText={(v) => {
                setCustomerPhone(v);
                setShowCustomerResults(true);
              }}
              onBlur={() => setTimeout(() => setShowCustomerResults(false), 150)}
              onFocus={() => setShowCustomerResults(true)}
              placeholder="09xx xxx xxxx"
              placeholderTextColor={colors.faint}
              style={styles.customerInput}
              keyboardType="phone-pad"
            />
            {showCustomerResults && (customerLookup.data?.length ?? 0) > 0 && (
              <View style={styles.lookupDropdown}>
                {(customerLookup.data ?? []).slice(0, 6).map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      setCustomer({ id: c.id, name: c.name, phone: c.phone ?? undefined, tin: c.tin ?? undefined });
                      setCustomerPhone(c.phone ?? '');
                      setShowCustomerResults(false);
                    }}
                    style={({ pressed }) => [styles.lookupItem, pressed && { backgroundColor: colors.creamSoft }]}
                  >
                    <Text style={styles.lookupName}>{c.name}</Text>
                    <Text style={styles.lookupPhone}>{c.phone ?? '—'}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </View>
      )}

      {/* Hero scan field */}
      <View style={styles.scanStrip}>
        <View style={styles.scanField}>
          <View>
            <Text style={styles.scanLabel}>Scan or search</Text>
            <TextInput
              ref={scanInputRef}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleScanSubmit}
              autoFocus
              placeholder="Tap product or scan SKU"
              placeholderTextColor={colors.faint}
              style={styles.scanInput}
            />
          </View>
          <View style={{ marginLeft: 'auto' }}>
            <Pill tone="success" dot>USB scanner ready</Pill>
          </View>
        </View>
        <Pressable
          onPress={handleOpenScanner}
          style={({ pressed }) => [styles.scanCta, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.scanCtaText}>Scan</Text>
        </Pressable>
        <Pressable
          onPress={() => setTingiMode((t) => !t)}
          style={({ pressed }) => [
            styles.tingiBtn,
            tingiMode && styles.tingiBtnActive,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={[styles.tingiText, tingiMode && styles.tingiTextActive]}>
            Tingi · loose pack
          </Text>
        </Pressable>
      </View>

      {/* Body */}
      <View style={styles.body}>
        <View style={styles.tableWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.catBar}
            contentContainerStyle={styles.catBarContent}
          >
            {categoryList.map((c) => {
              const active = category === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  style={[styles.catChip, active && styles.catChipActive]}
                >
                  <Text style={[styles.catChipText, active && styles.catChipTextActive]}>{c}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.tableHeader}>
            <Text style={[styles.headerCell, { flex: 0, width: 90 }]}>SKU</Text>
            <Text style={[styles.headerCell, { flex: 1 }]}>Product</Text>
            <Text style={[styles.headerCell, { width: 80, textAlign: 'right' }]}>Stock</Text>
            <Text style={[styles.headerCell, { width: 90, textAlign: 'right' }]}>Price</Text>
            <Text style={[styles.headerCell, { width: 60 }]}></Text>
          </View>

          {showShimmer ? (
            <View>
              {Array.from({ length: 6 }).map((_, i) => (
                <View key={`sh-${i}`} style={[styles.tableRow, styles.shimmerRow]} />
              ))}
            </View>
          ) : (
            <FlatList
              data={filteredProducts}
              keyExtractor={(p) => p.id}
              renderItem={renderRow}
              style={{ flex: 1 }}
            />
          )}
        </View>

        {/* Cart panel */}
        <View style={styles.cartPanel}>
          <View style={styles.cartHead}>
            <Text style={[textTokens.bodyLg, { fontWeight: '700', color: colors.ink }]}>Order</Text>
            <Text style={[textTokens.bodySm, { color: colors.muted }]}>
              {lineCount} {lineCount === 1 ? 'item' : 'items'} scanned
            </Text>
          </View>

          {hasAgeRestricted && (
            <View style={styles.ageBanner}>
              <Text style={styles.ageBannerText}>
                <Text style={{ fontWeight: '800' }}>18+ ID required at handoff (RA 9211).</Text>
                {'  '}Verify customer age before charging.
              </Text>
            </View>
          )}

          {visibleLines.length === 0 ? (
            <View style={styles.cartEmpty}>
              <Text style={[textTokens.body, { color: colors.muted }]}>
                Scan or tap [+] to add items.
              </Text>
            </View>
          ) : (
            <FlatList
              data={visibleLines}
              keyExtractor={(l) => l.id}
              style={{ flex: 1 }}
              renderItem={({ item }) => {
                const catalogItem = sourceProducts.find((p) => item.productId.startsWith(p.id));
                return (
                  <LineItem
                    line={item}
                    onLongPress={handleLongPressLine}
                    onSwipeRemove={(l) => removeLine(l.id)}
                    codeLabel={catalogItem?.sku}
                    ageRestricted={catalogItem?.ageRestricted}
                  />
                );
              }}
            />
          )}

          <View style={styles.totalsBlock}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={[styles.totalValue, tnum]}>{formatPeso(subtotal)}</Text>
            </View>
            <View style={[styles.totalRow, styles.grandRow]}>
              <Text style={styles.grandLabel}>Total</Text>
              <Text style={[styles.grandValue, tnum]}>{formatPeso(total)}</Text>
            </View>
          </View>

          <Pressable
            disabled={total === 0}
            style={({ pressed }) => [
              styles.chargeBtn,
              { opacity: total === 0 ? 0.4 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.chargeBtnText}>Charge {formatPeso(total)} →</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  customerStrip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.s3,
    padding: spacing.s3, paddingHorizontal: spacing.s5,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.rule,
  },
  customerLabel: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase' },
  customerInput: {
    flex: 1,
    ...textTokens.body,
    color: colors.ink,
    paddingVertical: spacing.s2,
  },

  scanStrip: {
    padding: spacing.s4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    backgroundColor: colors.creamSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  scanField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.primary,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
    gap: spacing.s3,
    minHeight: 68,
  },
  scanLabel: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase' },
  scanInput: {
    ...textTokens.monoLg,
    ...tnum,
    color: colors.ink,
    padding: 0,
    minWidth: 240,
  },
  scanCta: {
    height: 68,
    paddingHorizontal: spacing.s5,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  scanCtaText: { ...textTokens.bodyLg, color: colors.onPrimary, fontWeight: '700' },
  tingiBtn: {
    height: 68, paddingHorizontal: spacing.s5,
    borderRadius: radii.lg, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.rule,
    alignItems: 'center', justifyContent: 'center',
  },
  tingiBtnActive: { backgroundColor: colors.primaryContainer, borderColor: colors.primary },
  tingiText: { ...textTokens.bodyLg, fontWeight: '700', color: colors.ink },
  tingiTextActive: { color: colors.primaryInk },

  body: { flex: 1, flexDirection: 'row' },
  tableWrap: { flex: 1, padding: spacing.s4 },

  catBar: { flexGrow: 0, marginBottom: spacing.s3 },
  catBarContent: { gap: spacing.s2 },
  catChip: {
    paddingHorizontal: spacing.s3, paddingVertical: spacing.s2,
    backgroundColor: colors.creamSoft, borderWidth: 1, borderColor: colors.creamDeep,
    borderRadius: radii.sm, marginRight: spacing.s2,
  },
  catChipActive: { backgroundColor: colors.primaryContainer, borderColor: colors.primary },
  catChipText: { ...textTokens.bodySm, fontWeight: '600', color: colors.muted },
  catChipTextActive: { color: colors.primaryInk, fontWeight: '700' },

  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: spacing.s4, paddingVertical: spacing.s3,
    backgroundColor: colors.creamSoft,
    borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md,
    borderBottomWidth: 1, borderBottomColor: colors.rule,
  },
  headerCell: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase', fontWeight: '700' },

  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.s4,
    height: 56,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    gap: spacing.s2,
  },
  colSku: { ...textTokens.mono, fontSize: 11, color: colors.muted, width: 90 },
  colName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  tableName: { ...textTokens.bodySm, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  colStock: { ...textTokens.bodySm, color: colors.muted, width: 80, textAlign: 'right' },
  colPrice: { ...textTokens.bodySm, color: colors.primary, fontWeight: '700', width: 90, textAlign: 'right' },
  addBtn: {
    width: 50, height: 36,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: spacing.s2,
  },
  addBtnText: { color: colors.onPrimary, fontSize: 18, fontWeight: '700' },

  ageBadge: {
    backgroundColor: colors.errorSoft,
    borderRadius: radii.xs,
    paddingHorizontal: 6, paddingVertical: 1,
  },
  ageBadgeText: { color: colors.errorDeep, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },

  cartPanel: {
    width: 460,
    backgroundColor: colors.creamSoft,
    borderLeftWidth: 1, borderLeftColor: colors.rule,
  },
  cartHead: {
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.rule,
  },
  cartEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.s5 },

  ageBanner: {
    padding: spacing.s3,
    backgroundColor: colors.warningSoft,
    borderBottomWidth: 1, borderBottomColor: colors.warning,
  },
  ageBannerText: { ...textTokens.bodySm, color: colors.warningDeep },

  totalsBlock: {
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.rule,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { ...textTokens.bodySm, color: colors.muted },
  totalValue: { ...textTokens.bodySm, color: colors.ink, fontWeight: '700' },
  grandRow: {
    paddingTop: spacing.s3, marginTop: spacing.s2,
    borderTopWidth: 1, borderTopColor: colors.rule,
  },
  grandLabel: { ...textTokens.displayMd, color: colors.ink },
  grandValue: { ...textTokens.displayLg, color: colors.ink },

  chargeBtn: {
    margin: spacing.s4,
    height: tap.cashierPrimary,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
    ...elevation.e2,
  },
  chargeBtnText: { ...textTokens.cashierLg, color: colors.onPrimary },

  lookupDropdown: {
    position: 'absolute',
    top: 32,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radii.sm,
    ...elevation.e2,
    zIndex: 10,
  },
  lookupItem: {
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  lookupName: { ...textTokens.body, color: colors.ink, fontWeight: '600' },
  lookupPhone: { ...textTokens.caption, color: colors.muted, marginTop: 2 },
  shimmerRow: { backgroundColor: colors.creamSoft, opacity: 0.6 },
});
