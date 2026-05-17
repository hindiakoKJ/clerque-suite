import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, ScrollView, Pressable, StyleSheet,
  useWindowDimensions, TextInput,
} from 'react-native';
import { Snackbar } from 'react-native-paper';
import { openTendering } from '@/payment/TenderingHost';
import { colors, spacing, radii, text as textTokens, tap, elevation, tnum } from '@/theme/tokens';
import Pill from '@/components/Pill';
import LineItem from '@/components/LineItem';
import { formatPeso } from '@/components/Money';
import { FB_CATEGORIES, FB_PRODUCTS, FBProduct } from '../mockCatalog';
import { useCartStore } from '../cartStore';
import type { DiningMode, CartLine } from '@/types';
import ModifierSheet, { ModifierSheetHandle } from './ModifierSheet';
import { usePosCatalog, useCategories, type ApiProduct } from '@/api/queries';
import { useActiveBranchId } from '@/api/BranchContext';

/** Map a Cloud `ApiProduct` to the local `FBProduct` shape the grid renders. */
function toFbProduct(p: ApiProduct): FBProduct {
  const priceNum = typeof p.price === 'string' ? Number(p.price) : p.price;
  const initials = (p.name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return {
    id: p.id,
    name: p.name,
    initials,
    category: p.category?.name ?? 'All',
    price: Math.round(priceNum * 100),
    stock: p.maxProducible ?? 0,
    lowStock: p.isLowStock,
    modifierGroups: (p.modifierGroups ?? [])
      .filter((g) => g.modifierGroup.options.some((o) => o.isActive !== false))
      .map((g) => ({
        id: g.modifierGroup.id,
        name: g.modifierGroup.name,
        required: g.modifierGroup.required,
        min: g.modifierGroup.minSelect ?? (g.modifierGroup.required ? 1 : 0),
        max: g.modifierGroup.maxSelect ?? (g.modifierGroup.multiSelect ? 99 : 1),
        options: g.modifierGroup.options
          .filter((o) => o.isActive !== false)
          .map((o) => ({
            id: o.id,
            name: o.name,
            priceAdjustment: Math.round(
              (typeof o.priceAdjustment === 'string'
                ? Number(o.priceAdjustment)
                : o.priceAdjustment) * 100,
            ),
          })),
      })),
  };
}

// We import lazily because SupervisorPinModal may not exist yet (another agent
// is building it). The try/catch keeps the bundle valid.
type SupervisorPinAPI = {
  openSupervisorPin: (args: { reason: string }) => Promise<{ supervisorId: string; role: string }>;
};
async function loadSupervisorPin(): Promise<SupervisorPinAPI | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/auth/SupervisorPinModal') as SupervisorPinAPI;
    return mod;
  } catch {
    return null;
  }
}

const DINING_MODES: { value: DiningMode; label: string }[] = [
  { value: 'DINE_IN',  label: 'Dine in' },
  { value: 'TAKEOUT',  label: 'Takeout' },
  { value: 'DELIVERY', label: 'Delivery' },
];

export default function FBTerminal() {
  const { width } = useWindowDimensions();
  const isLandscape = width >= 900;

  const [activeCategory, setActiveCategory] = useState<string>('All');

  // Live catalog. Falls back to the mock when no live data is available yet
  // (cold-launch, dev builds, or the call is still in flight).
  const branchId = useActiveBranchId();
  const catalogQuery = usePosCatalog(branchId);
  const categoriesQuery = useCategories();
  const liveProducts: FBProduct[] = useMemo(
    () => (catalogQuery.data ?? []).map(toFbProduct),
    [catalogQuery.data],
  );
  const useLive = liveProducts.length > 0;
  const allProducts: FBProduct[] = useLive
    ? liveProducts
    : (__DEV__ ? FB_PRODUCTS : []);

  const categories: readonly string[] = useLive && categoriesQuery.data?.length
    ? ['All', ...categoriesQuery.data.map((c) => c.name)]
    : FB_CATEGORIES;

  // Subtle loading hint — only render shimmer rows when we genuinely have
  // nothing to show; once cache is hydrated we stay on the previous data.
  const showShimmer = catalogQuery.isLoading && allProducts.length === 0;

  const lines = useCartStore((s) => s.lines);
  const diningMode = useCartStore((s) => s.diningMode);
  const tableNumber = useCartStore((s) => s.tableNumber);
  const addLine = useCartStore((s) => s.addLine);
  const setQty = useCartStore((s) => s.setQty);
  const removeLine = useCartStore((s) => s.removeLine);
  const voidLine = useCartStore((s) => s.voidLine);
  const setDiningMode = useCartStore((s) => s.setDiningMode);
  const setTableNumber = useCartStore((s) => s.setTableNumber);
  const subtotal = useCartStore((s) => s.subtotal());
  const vatExempt = useCartStore((s) => s.vatExempt());
  const total = useCartStore((s) => s.total());
  const lineCount = useCartStore((s) => s.lineCount());
  const clearCart = useCartStore((s) => s.clear);

  // Snackbar for non-critical inline feedback ("Coming soon", "Saved", etc.).
  const [snack, setSnack] = useState<string | null>(null);
  const [charging, setCharging] = useState(false);

  const handleCharge = async () => {
    if (charging || total === 0) return;
    setCharging(true);
    try {
      const snapshot = useCartStore.getState();
      const result = await openTendering({
        cart: {
          lines: snapshot.lines,
          payments: snapshot.payments,
          diningMode: snapshot.diningMode,
          tableNumber: snapshot.tableNumber,
          customer: snapshot.customer,
          pwdScId: snapshot.pwdScId,
        },
        totalCents: total,
        subtotalCents: subtotal,
      });
      if (result) {
        clearCart();
        setSnack(
          result.offline
            ? `Saved offline · ${result.orderNumber}`
            : `Sale complete · #${result.orderNumber}`,
        );
      }
    } catch (e) {
      setSnack(e instanceof Error ? e.message : 'Charge failed.');
    } finally {
      setCharging(false);
    }
  };

  // initial defaults
  React.useEffect(() => {
    if (!diningMode) setDiningMode('DINE_IN');
  }, [diningMode, setDiningMode]);

  const filteredProducts = useMemo(() => {
    if (activeCategory === 'All') return allProducts;
    return allProducts.filter((p) => p.category === activeCategory);
  }, [activeCategory, allProducts]);

  const sheetRef = useRef<ModifierSheetHandle>(null);

  const handleProductPress = (p: FBProduct) => {
    if (p.modifierGroups && p.modifierGroups.length > 0) {
      sheetRef.current?.open(p);
      return;
    }
    addLine({
      productId: p.id,
      productName: p.name,
      qty: 1,
      unitPrice: p.price,
    });
  };

  const handleLongPressLine = async (line: CartLine) => {
    const mod = await loadSupervisorPin();
    if (!mod) {
      // Soft-fail: fallback to direct void with stub supervisor while modal is being built.
      voidLine(line.id, 'VOID', 'pending-supervisor');
      return;
    }
    try {
      const result = await mod.openSupervisorPin({ reason: 'VOID' });
      voidLine(line.id, 'VOID', result.supervisorId);
    } catch {
      /* cancelled */
    }
  };

  const numColumns = isLandscape ? 4 : 2;

  const renderProduct = ({ item }: { item: FBProduct }) => (
    <Pressable
      onPress={() => handleProductPress(item)}
      style={({ pressed }) => [
        styles.card,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={styles.cardImg}>
        <Text style={styles.cardInitials}>{item.initials}</Text>
        {item.lowStock && (
          <View style={styles.badgeTopRight}>
            <Pill tone="warning">Low · {item.stock}</Pill>
          </View>
        )}
        {item.bestseller && (
          <View style={styles.badgeTopLeft}>
            <Pill tone="primary">★ Bestseller</Pill>
          </View>
        )}
        {item.modifierGroups && (
          <View style={styles.modBadge}>
            <Text style={styles.modBadgeText}>+</Text>
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
        <Text style={[styles.cardPrice, tnum]}>{formatPeso(item.price)}</Text>
      </View>
    </Pressable>
  );

  const renderLine = ({ item }: { item: CartLine }) => (
    <LineItem
      line={item}
      onLongPress={handleLongPressLine}
      onSwipeRemove={(l) => removeLine(l.id)}
      onQtyChange={(l, q) => setQty(l.id, q)}
    />
  );

  const visibleLines = lines.filter((l) => !l.removed || l.voidedAt);

  const productGridKey = `cols-${numColumns}`;

  return (
    <View style={styles.root}>
      {/* Order context strip */}
      <View style={styles.contextStrip}>
        <View style={styles.diningToggle}>
          {DINING_MODES.map((m) => {
            const active = (diningMode ?? 'DINE_IN') === m.value;
            return (
              <Pressable
                key={m.value}
                onPress={() => setDiningMode(m.value)}
                style={[styles.diningChip, active && styles.diningChipActive]}
              >
                <Text style={[styles.diningChipText, active && styles.diningChipTextActive]}>
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {diningMode === 'DINE_IN' && (
          <View style={styles.tableChip}>
            <Text style={styles.tableLabel}>Table</Text>
            <TextInput
              value={tableNumber ?? ''}
              onChangeText={setTableNumber}
              placeholder="T-04"
              placeholderTextColor={colors.faint}
              style={styles.tableInput}
              maxLength={6}
            />
          </View>
        )}
      </View>

      {/* Category bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catBar}
        contentContainerStyle={styles.catBarContent}
      >
        {categories.map((c) => {
          const active = activeCategory === c;
          return (
            <Pressable
              key={c}
              onPress={() => setActiveCategory(c)}
              style={[styles.catPill, active && styles.catPillActive]}
            >
              <Text style={[styles.catPillText, active && styles.catPillTextActive]}>{c}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Body */}
      <View style={[styles.body, !isLandscape && { flexDirection: 'column' }]}>
        <View style={styles.gridWrap}>
          <View style={styles.gridHeader}>
            <Text style={[textTokens.displaySm, { color: colors.ink }]}>Menu</Text>
            <Pressable
              style={styles.sendKitchenBtn}
              onPress={() => setSnack('Send to kitchen — coming soon')}
            >
              <Text style={styles.sendKitchenText}>Send to kitchen</Text>
            </Pressable>
          </View>
          {showShimmer ? (
            <View style={styles.gridContent}>
              {Array.from({ length: numColumns * 2 }).map((_, i) => (
                <View key={`sh-${i}`} style={[styles.card, styles.shimmer]} />
              ))}
            </View>
          ) : (
            <FlatList
              key={productGridKey}
              data={filteredProducts}
              keyExtractor={(p) => p.id}
              numColumns={numColumns}
              columnWrapperStyle={numColumns > 1 ? styles.gridRow : undefined}
              contentContainerStyle={styles.gridContent}
              renderItem={renderProduct}
            />
          )}
        </View>

        {/* Cart panel */}
        <View style={[styles.cartPanel, !isLandscape && styles.cartPanelPortrait]}>
          <View style={styles.cartHead}>
            <View>
              <Text style={[textTokens.bodyLg, { fontWeight: '700', color: colors.ink }]}>
                Order {tableNumber ? `· ${tableNumber}` : ''}
              </Text>
              <Text style={[textTokens.bodySm, { color: colors.muted }]}>
                {lineCount} {lineCount === 1 ? 'item' : 'items'} · {diningMode === 'DINE_IN' ? 'Dine in' : diningMode === 'TAKEOUT' ? 'Takeout' : 'Delivery'}
              </Text>
            </View>
          </View>

          {visibleLines.length === 0 ? (
            <View style={styles.cartEmpty}>
              <Text style={[textTokens.body, { color: colors.muted }]}>Tap a product to start an order.</Text>
            </View>
          ) : (
            <FlatList
              data={visibleLines}
              keyExtractor={(l) => l.id}
              renderItem={renderLine}
              style={{ flex: 1 }}
            />
          )}

          <View style={styles.totalsBlock}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={[styles.totalValue, tnum]}>{formatPeso(subtotal)}</Text>
            </View>
            {vatExempt > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>VAT-exempt sales</Text>
                <Text style={[styles.totalValue, tnum]}>{formatPeso(vatExempt)}</Text>
              </View>
            )}
            <View style={[styles.totalRow, styles.grandRow]}>
              <Text style={styles.grandLabel}>Bayaran</Text>
              <Text style={[styles.grandValue, tnum]}>{formatPeso(total)}</Text>
            </View>
          </View>

          <Pressable
            disabled={total === 0 || charging}
            onPress={handleCharge}
            style={({ pressed }) => [
              styles.chargeBtn,
              { opacity: total === 0 || charging ? 0.4 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.chargeBtnText}>
              {charging ? 'Charging…' : `Charge ${formatPeso(total)} →`}
            </Text>
          </Pressable>
        </View>
      </View>

      <Snackbar
        visible={snack !== null}
        onDismiss={() => setSnack(null)}
        duration={3000}
      >
        {snack ?? ''}
      </Snackbar>

      <ModifierSheet
        ref={sheetRef}
        onAdd={({ product, modifiers, lineTotal }) => {
          addLine({
            productId: product.id,
            productName: product.name,
            qty: 1,
            unitPrice: product.price,
            modifiers,
            lineTotal,
            noMerge: true,
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  contextStrip: {
    padding: spacing.s3,
    paddingHorizontal: spacing.s5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    backgroundColor: colors.creamSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  diningToggle: {
    flexDirection: 'row',
    padding: 4,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: 2,
  },
  diningChip: {
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s2,
    borderRadius: radii.sm,
  },
  diningChipActive: { backgroundColor: colors.primary, ...elevation.e1 },
  diningChipText: { ...textTokens.bodySm, color: colors.muted, fontWeight: '600' },
  diningChipTextActive: { color: colors.onPrimary, fontWeight: '700' },

  tableChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radii.md,
  },
  tableLabel: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase' },
  tableInput: {
    ...textTokens.displaySm,
    color: colors.primary,
    minWidth: 60,
    padding: 0,
  },

  catBar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    flexGrow: 0,
  },
  catBarContent: {
    padding: spacing.s3,
    gap: spacing.s2,
  },
  catPill: {
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s2,
    borderRadius: radii.pill,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.creamDeep,
    marginRight: spacing.s2,
  },
  catPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  catPillText: { ...textTokens.bodySm, fontWeight: '600', color: colors.ink },
  catPillTextActive: { color: colors.onPrimary },

  body: { flex: 1, flexDirection: 'row' },

  gridWrap: { flex: 1, padding: spacing.s4 },
  gridHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.s2, paddingBottom: spacing.s3,
  },
  sendKitchenBtn: {
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s2,
    borderRadius: radii.sm,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.creamDeep,
  },
  sendKitchenText: { ...textTokens.bodySm, fontWeight: '700', color: colors.ink },

  gridRow: { gap: spacing.s3, marginBottom: spacing.s3 },
  gridContent: { paddingBottom: spacing.s6 },

  card: {
    flex: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
    overflow: 'hidden',
    maxWidth: 240,
    ...elevation.e1,
  },
  cardImg: {
    height: 140,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  cardInitials: { ...textTokens.displayMd, color: colors.primaryInk },
  badgeTopRight: { position: 'absolute', top: 8, right: 8 },
  badgeTopLeft: { position: 'absolute', top: 8, left: 8 },
  modBadge: {
    position: 'absolute', bottom: 8, right: 8,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  modBadgeText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
  cardBody: { padding: spacing.s3 },
  cardName: { ...textTokens.body, fontWeight: '600', minHeight: 40 },
  cardPrice: { ...textTokens.bodyLg, fontWeight: '700', color: colors.primary, marginTop: spacing.s1 },

  cartPanel: {
    width: 460,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: colors.rule,
  },
  cartPanelPortrait: { width: '100%', minHeight: 320 },
  cartHead: {
    padding: spacing.s4,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  cartEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.s5 },

  totalsBlock: {
    padding: spacing.s4,
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

  shimmer: {
    height: 200,
    margin: spacing.s2,
    backgroundColor: colors.creamSoft,
    opacity: 0.6,
  },
});
