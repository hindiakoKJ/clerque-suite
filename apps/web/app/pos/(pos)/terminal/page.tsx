'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, X } from 'lucide-react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { ProductGrid } from '@/components/pos/ProductGrid';
import { CartPanel } from '@/components/pos/CartPanel';
import { PaymentModal, type PaymentEntry, type B2bOrderInfo } from '@/components/pos/PaymentModal';
import { PwdScModal } from '@/components/pos/PwdScModal';
import { ReceiptModal, type ReceiptData } from '@/components/pos/ReceiptModal';
import { ParkedSalesModal } from '@/components/pos/ParkedSalesModal';
import { useCartStore } from '@/store/pos/cart';
import { useAuthStore } from '@/store/auth';
import { useOnlineStatus } from '@/hooks/pos/useOnlineStatus';
import { useShiftStore } from '@/store/pos/shift';
import { useActivePromotions } from '@/hooks/pos/useActivePromotions';
import { useSound } from '@/hooks/pos/useSound';
import { useBarcodeScanner } from '@/hooks/pos/useBarcodeScanner';
import { api } from '@/lib/api';
import { db } from '@/lib/pos/db';
import { computeVat } from '@/lib/pos/utils';
import { dispatchOrderToStations, toastDispatchSummary } from '@/lib/pos/printer-dispatch';
import { useFloorLayout } from '@/hooks/useFloorLayout';
import { useCustomerDisplaySync } from '@/hooks/pos/useCustomerDisplaySync';
import { publishCustomerDisplay, resetCustomerDisplay } from '@/lib/pos/customer-display-channel';
import type { CachedProduct, CachedCategory } from '@/lib/pos/db';

export default function PosTerminal() {
  const [showPayment, setShowPayment]   = useState(false);
  const [showPwdSc,   setShowPwdSc]     = useState(false);
  const [showParked,  setShowParked]    = useState(false);
  const [receiptData, setReceiptData]   = useState<ReceiptData | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  const isOnline    = useOnlineStatus();
  const queryClient = useQueryClient();
  const activeShift = useShiftStore((s) => s.activeShift);
  const playSound   = useSound();

  const user      = useAuthStore((s) => s.user);
  const branchId  = useCartStore((s) => s.branchId);
  const taxStatus = useCartStore((s) => s.taxStatus);
  const { lines, orderDiscount, additionalPwdScEntries, grandTotal, vatAmount, subtotal, totalDiscount, clearCart, applyPromoDiscounts, addItem } = useCartStore();

  const activeBranchId = branchId ?? user?.branchId ?? '';
  const tenantId       = user?.tenantId ?? '';
  const cartCount      = lines.reduce((s, l) => s + l.quantity, 0);

  // Floor layout — used to split orders to station printers (kitchen / bar tickets).
  // Only F&B-tier coffee shops have non-empty stations; for everyone else this
  // is a no-op (dispatch sees zero stations with hasPrinter, prints nothing extra).
  const { stations: floorStations, printers: floorPrinters } = useFloorLayout();

  // Customer-facing display sync — publishes cart updates to /pos/customer-display
  // (open in another window/tablet). No-op when the tenant doesn't have a
  // customer display configured. Hook handles dedupe + WELCOME on empty cart.
  useCustomerDisplaySync();

  // ── Promotions: auto-apply best deal per cart line ──────────────────────
  // Track only lineKey + quantity so applyPromoDiscounts() (which modifies itemDiscount)
  // doesn't create a feedback loop with this memo.
  const lineFingerprint = useMemo(
    () => lines.map((l) => `${l.lineKey}:${l.quantity}`).join(','),
    [lines],
  );
  const productIds = useMemo(
    () => [...new Set(lines.map((l) => l.product.id))],
    [lineFingerprint], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { promotions } = useActivePromotions(productIds);

  // Re-apply whenever active promotions change OR cart line composition changes.
  // (itemDiscount changes don't affect lineFingerprint, so no infinite loop.)
  // Diff before/after so we can surface a toast when a promo is freshly applied —
  // otherwise the cashier sees the total drop with no explanation.
  useEffect(() => {
    const before = new Map(
      useCartStore.getState().lines.map((l) => [l.lineKey, l.promotionApplied?.promoId] as const),
    );
    applyPromoDiscounts(promotions);
    const after = useCartStore.getState().lines;
    const newlyApplied = new Map<string, { name: string; saved: number }>();
    for (const line of after) {
      const prevId = before.get(line.lineKey);
      const nowId  = line.promotionApplied?.promoId;
      if (nowId && nowId !== prevId) {
        const existing = newlyApplied.get(nowId);
        const saved = line.itemDiscount * line.quantity;
        if (existing) {
          existing.saved += saved;
        } else {
          newlyApplied.set(nowId, { name: line.promotionApplied!.promoName, saved });
        }
      }
    }
    if (newlyApplied.size > 0) {
      playSound('click');
      for (const { name, saved } of newlyApplied.values()) {
        toast.info(`Promo applied: ${name} — saved ₱${saved.toFixed(2)}`);
      }
    }
  }, [promotions, lineFingerprint]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Products (write-through to Dexie) ──────────────────────────────────
  // Poll every 15s while online so a sale on tablet POS-01 reflects on POS-02
  // within ~15 seconds (Iced Mocha sold here → chocolate syrup drops there →
  // Hot Mocha shows fewer "left" automatically). We also invalidate this query
  // immediately after our own checkout for instant local feedback.
  const { data: products = [], isLoading: loadingProducts } = useQuery<CachedProduct[]>({
    queryKey: ['products-pos', activeBranchId],
    queryFn: async () => {
      if (isOnline) {
        try {
          const { data } = await api.get(`/products/pos?branchId=${activeBranchId}`);
          const stamped = (data as CachedProduct[]).map((p) => ({
            ...p, branchId: activeBranchId, tenantId, cachedAt: Date.now(),
          }));
          await db.products.bulkPut(stamped);
          return stamped;
        } catch {}
      }
      const cached = await db.products.where('branchId').equals(activeBranchId).toArray();
      if (cached.length === 0 && !isOnline) toast.warning('No cached products. Connect at least once.');
      return cached;
    },
    enabled: !!activeBranchId,
    staleTime: 10_000,                    // serve cache for 10s, then refetch on next access
    refetchInterval: isOnline ? 15_000 : false,
    refetchIntervalInBackground: false,   // pause polling when tab not visible (saves battery)
    refetchOnWindowFocus: true,           // refresh when cashier comes back to tab
    retry: isOnline ? 3 : false,
  });

  // ── Barcode scanner (HID/Bluetooth keyboard-emulating) ─────────────────
  // On scan, look up the product by barcode and add it to the cart.
  // Skipped automatically when an input/textarea is focused so the search
  // box still works for keyboard typing.
  useBarcodeScanner({
    enabled: !showPayment && !showPwdSc && !showParked && !receiptData,
    onScan: (code) => {
      const match = (products as CachedProduct[]).find((p) => p.barcode === code);
      if (!match) {
        playSound('error');
        toast.error(`No product matches barcode ${code}`);
        return;
      }
      addItem(
        { id: match.id, name: match.name, price: match.price, costPrice: match.costPrice, isVatable: match.isVatable, categoryId: match.categoryId },
      );
      playSound('click');
      toast.success(`Added: ${match.name}`);
    },
  });

  // ── Categories (write-through) ──────────────────────────────────────────
  const { data: categories = [] } = useQuery<CachedCategory[]>({
    queryKey: ['categories'],
    queryFn: async () => {
      if (isOnline) {
        try {
          const { data } = await api.get('/categories');
          const stamped = (data as CachedCategory[]).map((c) => ({ ...c, tenantId, cachedAt: Date.now() }));
          await db.categories.bulkPut(stamped);
          return stamped;
        } catch {}
      }
      return db.categories.where('tenantId').equals(tenantId).toArray();
    },
    staleTime: 300_000,
    retry: isOnline ? 3 : false,
  });

  useEffect(() => {
    if (isOnline) {
      queryClient.invalidateQueries({ queryKey: ['products-pos'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    }
  }, [isOnline, queryClient]);

  // ── Checkout ────────────────────────────────────────────────────────────
  async function handleCheckout(payments: PaymentEntry[], b2b?: B2bOrderInfo) {
    const total      = grandTotal();
    const vat        = vatAmount();
    const sub        = subtotal();
    const disc       = totalDiscount();
    const clientUuid = uuidv4();

    const orderPayload = {
      clientUuid,
      branchId: activeBranchId,
      shiftId: activeShift?.id,
      items: lines.map((l) => ({
        productId: l.product.id,
        variantId: l.variantId,
        productName: l.product.name,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        discountAmount: l.itemDiscount * l.quantity,
        // Per-item VAT: only VAT-registered tenants collect VAT.
        // isVatable on the product is irrelevant for NON_VAT / UNREGISTERED tenants.
        vatAmount: taxStatus === 'VAT' && l.product.isVatable
          ? computeVat(l.unitPrice * l.quantity).vat
          : 0,
        lineTotal: (l.unitPrice - l.itemDiscount) * l.quantity,
        costPrice: l.product.costPrice,
        isVatable: l.product.isVatable,
        modifiers: l.modifiers ?? [],
        promoId:   l.promotionApplied?.promoId,
        promoName: l.promotionApplied?.promoName,
      })),
      payments,
      discounts: [
        // Per-line promo discounts (aggregated for the order-level discount list)
        ...lines
          .filter((l) => l.promotionApplied && l.itemDiscount > 0)
          .map((l) => ({
            discountType:    'PROMOTION' as const,
            discountAmount:  l.itemDiscount * l.quantity,
            discountPercent: undefined as number | undefined,
            reason: `Promo: ${l.promotionApplied!.promoName} on ${l.product.name}`,
          })),
        ...(orderDiscount ? [{
          discountType: orderDiscount.type,
          discountAmount: orderDiscount.discountOnBase,
          discountPercent: orderDiscount.percent,
          // CASHIER_APPLIED: cashier supplies a free-text reason captured in the modal.
          // PWD/SC: synthesize the regulator-compliant breakdown line.
          reason: orderDiscount.type === 'CASHIER_APPLIED'
            ? (orderDiscount.reason ?? orderDiscount.label)
            : taxStatus === 'VAT'
              ? `${orderDiscount.label} — 20% of VAT-excl base ₱${orderDiscount.vatExclusiveBase.toFixed(2)}`
              : `${orderDiscount.label} — 20% of gross ₱${orderDiscount.vatExclusiveBase.toFixed(2)}`,
          // Carries the first PWD/SC ID; subsequent IDs come from additionalPwdScEntries below.
          pwdScIdRef:       (orderDiscount.type === 'PWD' || orderDiscount.type === 'SENIOR_CITIZEN') ? orderDiscount.idRef       : undefined,
          pwdScIdOwnerName: (orderDiscount.type === 'PWD' || orderDiscount.type === 'SENIOR_CITIZEN') ? orderDiscount.idOwnerName : undefined,
        }] : []),
        // Additional PWD/SC entries — one OrderDiscount row each so BIR audit
        // sees every qualified individual on the same order.
        ...additionalPwdScEntries.map((e) => ({
          discountType:    e.type,
          discountAmount:  e.discountOnBase,
          discountPercent: 20,
          reason: taxStatus === 'VAT'
            ? `${e.type === 'PWD' ? 'PWD' : 'Senior'} ${e.idOwnerName} — 20% of VAT-excl base ₱${e.vatExclusiveBase.toFixed(2)}`
            : `${e.type === 'PWD' ? 'PWD' : 'Senior'} ${e.idOwnerName} — 20% of gross ₱${e.vatExclusiveBase.toFixed(2)}`,
          pwdScIdRef:       e.idRef,
          pwdScIdOwnerName: e.idOwnerName,
        })),
      ],
      subtotal: sub,
      discountAmount: disc,
      vatAmount: vat,
      totalAmount: total,
      isPwdScDiscount: !!orderDiscount && ['PWD', 'SENIOR_CITIZEN'].includes(orderDiscount.type),
      pwdScIdRef: orderDiscount?.idRef,
      pwdScIdOwnerName: orderDiscount?.idOwnerName,
      createdAt: new Date().toISOString(),
      // ── BIR CAS: B2B / CHARGE invoice fields (RR No. 1-2026) ──
      invoiceType:     b2b?.invoiceType,
      customerName:    b2b?.customerName,
      customerTin:     b2b?.customerTin,
      customerAddress: b2b?.customerAddress,
    };

    const receiptBase = {
      lines: lines.map((l) => ({
        productName: l.product.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: (l.unitPrice - l.itemDiscount) * l.quantity,
        discountAmount: l.itemDiscount * l.quantity,
        modifiers: l.modifiers?.map((m) => ({
          optionName: m.optionName,
          priceAdjustment: m.priceAdjustment,
        })),
      })),
      subtotal: sub,
      discountOnBase: orderDiscount?.discountOnBase,
      vatRelief: orderDiscount ? orderDiscount.totalSavings - orderDiscount.discountOnBase : 0,
      vatExclusiveBase: orderDiscount?.vatExclusiveBase,
      discountAmount: disc,
      vatAmount: vat,
      totalAmount: total,
      payments,
      isPwdScDiscount: orderPayload.isPwdScDiscount,
      pwdScIdRef: orderPayload.pwdScIdRef,
      pwdScIdOwnerName: orderPayload.pwdScIdOwnerName,
      additionalPwdScEntries: additionalPwdScEntries.map((e) => ({
        type:        e.type,
        idRef:       e.idRef,
        idOwnerName: e.idOwnerName,
        savings:     e.totalSavings,
      })),
      completedAt: orderPayload.createdAt,
      // B2B customer fields forwarded to receipt display
      invoiceType:     b2b?.invoiceType,
      customerName:    b2b?.customerName,
      customerTin:     b2b?.customerTin,
      customerAddress: b2b?.customerAddress,
    };

    async function saveOffline() {
      await db.pendingOrders.add({
        clientUuid,
        branchId: activeBranchId,
        payload: orderPayload,
        receiptSnapshot: receiptBase,
        queuedAt: Date.now(),
        retries: 0,
        status: 'PENDING',
      });
      setShowPayment(false);
      setMobileCartOpen(false);
      setReceiptData({ ...receiptBase, orderNumber: `LOCAL-${clientUuid.slice(0, 8).toUpperCase()}`, isOffline: true });
      clearCart();
    }

    if (!isOnline) {
      await saveOffline();
      playSound('warn');
      toast.warning('Order saved offline — will sync when reconnected.');
      return;
    }

    try {
      // Order create is a heavy transaction on the backend (auth check,
      // period lock, tax calc, inventory deduction, BOM drain with FIFO,
      // SALE + COGS AccountingEvents). On Railway cold-starts + flaky PH
      // internet it can legitimately take 8-15 seconds. The previous 3s
      // timeout was way too tight: the order would actually succeed on
      // the backend but the frontend gave up early, falling into the
      // offline-save path and creating a duplicate that fails dedup
      // when it tries to sync. 30s gives the heavy path comfortable
      // headroom; truly-offline cases fail with ERR_NETWORK in <1s
      // anyway and never wait the full timeout.
      const { data: order } = await api.post('/orders', { order: orderPayload }, { timeout: 30000 });
      setShowPayment(false);
      setMobileCartOpen(false);
      setReceiptData({ ...receiptBase, orderId: order.id, orderNumber: order.orderNumber, isOffline: false });
      clearCart();
      playSound('success');
      toast.success(`Order #${order.orderNumber} completed`);
      // Refresh stock immediately so this tablet sees the deduction.
      // Other tablets refetch on their next 15s poll cycle.
      queryClient.invalidateQueries({ queryKey: ['products-pos', activeBranchId] });

      // ── Dispatch station tickets (Sprint 3 Phase B) ─────────────────────
      // For coffee shops on CS_3+, this prints "Bar" / "Kitchen" tickets to
      // their respective printers. For CS_1/CS_2 / non-F&B, the dispatcher
      // sees zero printer-bearing stations and silently no-ops.
      // Failures are toasted but never block the sale.
      if (floorStations.length > 0) {
        try {
          const dispatchResults = await dispatchOrderToStations({
            order: {
              orderNumber: order.orderNumber,
              completedAt: orderPayload.createdAt,
              items: lines.map((l) => ({
                productName: l.product.name,
                quantity:    l.quantity,
                categoryId:  l.product.categoryId ?? null,
                modifiers:   l.modifiers?.map((m) => ({ optionName: m.optionName })),
              })),
            },
            stations: floorStations,
            printers: floorPrinters,
            // Web Serial printer not currently exposed here; Phase 3B follow-up
            // will wire it via usePrinterStore. RawBT path handles the common case.
            webSerialPrinter: null,
          });
          toastDispatchSummary(dispatchResults);
        } catch (dispatchErr) {
          // Should not throw (dispatch swallows errors), but defensively...
          console.warn('Station ticket dispatch failed:', dispatchErr);
        }
      }

      // ── Customer-facing display: show "Salamat" payment-complete state ──
      // Cashier-side cart was cleared (clearCart() above). Customer screen
      // shows the thank-you for ~8 seconds before reverting to WELCOME.
      publishCustomerDisplay({
        type: 'PAYMENT_COMPLETE',
        lines: receiptBase.lines.map((l) => ({
          productName: l.productName,
          quantity:    l.quantity,
          unitPrice:   l.unitPrice,
          lineTotal:   l.lineTotal,
        })),
        subtotal: sub,
        discount: disc,
        vatAmount: vat,
        total,
      });
      setTimeout(() => resetCustomerDisplay(), 8_000);
    } catch (err: unknown) {
      const isNetworkError =
        (err as { code?: string })?.code === 'ERR_NETWORK' ||
        (err as { code?: string })?.code === 'ECONNABORTED';
      if (isNetworkError) {
        await saveOffline();
        playSound('warn');
        toast.warning('Connection lost — order saved offline and will sync automatically.');
        return;
      }
      // Server rejected the order — give the cashier an audible cue before
      // PaymentModal surfaces the backend error message.
      playSound('error');
      throw err;
    }
  }

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* ── Product Grid (full width on mobile, flex-1 on desktop) ── */}
      <div className={`flex-1 min-w-0 ${mobileCartOpen ? 'hidden lg:flex' : 'flex'} flex-col`}>
        <ProductGrid products={products} categories={categories} loading={loadingProducts} />
      </div>

      {/* ── Cart Panel — Desktop: fixed right column ── */}
      <div className="hidden lg:flex w-80 shrink-0 flex-col">
        <CartPanel
          onCheckout={() => setShowPayment(true)}
          onApplyPwdSc={() => setShowPwdSc(true)}
          onOpenParkedSales={() => setShowParked(true)}
        />
      </div>

      {/* Mobile: full-screen cart overlay */}
      {mobileCartOpen && (
        <div className="lg:hidden absolute inset-0 z-30 flex flex-col bg-background">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background shrink-0">
            <h2 className="font-semibold text-foreground">Current Order</h2>
            <button
              onClick={() => setMobileCartOpen(false)}
              className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <CartPanel
              onCheckout={() => setShowPayment(true)}
              onApplyPwdSc={() => setShowPwdSc(true)}
              onOpenParkedSales={() => setShowParked(true)}
            />
          </div>
        </div>
      )}

      {/* Mobile floating cart button */}
      {!mobileCartOpen && cartCount > 0 && (
        <button
          onClick={() => setMobileCartOpen(true)}
          className="lg:hidden fixed bottom-6 right-4 z-20 flex items-center gap-2 hover:opacity-90 text-white rounded-2xl px-5 py-3.5 shadow-xl transition-all active:scale-95"
          style={{ background: 'var(--accent)' }}
        >
          <ShoppingCart className="h-5 w-5" />
          <span className="font-bold text-sm">{cartCount} item{cartCount > 1 ? 's' : ''}</span>
          <span className="bg-white/20 rounded-lg px-2 py-0.5 text-sm font-bold">
            ₱{grandTotal().toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </button>
      )}

      <PaymentModal
        open={showPayment}
        total={grandTotal()}
        isOffline={!isOnline}
        onConfirm={handleCheckout}
        onClose={() => setShowPayment(false)}
      />

      <PwdScModal open={showPwdSc} onClose={() => setShowPwdSc(false)} />

      <ParkedSalesModal open={showParked} onClose={() => setShowParked(false)} />

      <ReceiptModal
        open={!!receiptData}
        data={receiptData}
        onClose={() => setReceiptData(null)}
      />
    </div>
  );
}
