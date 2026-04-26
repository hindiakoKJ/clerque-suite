'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, X } from 'lucide-react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { ProductGrid } from '@/components/pos/ProductGrid';
import { CartPanel } from '@/components/pos/CartPanel';
import { PaymentModal, type PaymentEntry, type B2bOrderInfo } from '@/components/pos/PaymentModal';
import { PwdScModal } from '@/components/pos/PwdScModal';
import { ReceiptModal, type ReceiptData } from '@/components/pos/ReceiptModal';
import { useCartStore } from '@/store/pos/cart';
import { useAuthStore } from '@/store/auth';
import { useOnlineStatus } from '@/hooks/pos/useOnlineStatus';
import { useShiftStore } from '@/store/pos/shift';
import { api } from '@/lib/api';
import { db } from '@/lib/pos/db';
import { computeVat } from '@/lib/pos/utils';
import type { CachedProduct, CachedCategory } from '@/lib/pos/db';

export default function PosTerminal() {
  const [showPayment, setShowPayment] = useState(false);
  const [showPwdSc,   setShowPwdSc]   = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  const isOnline    = useOnlineStatus();
  const queryClient = useQueryClient();
  const activeShift = useShiftStore((s) => s.activeShift);

  const user     = useAuthStore((s) => s.user);
  const branchId = useCartStore((s) => s.branchId);
  const { lines, orderDiscount, grandTotal, vatAmount, subtotal, totalDiscount, clearCart } = useCartStore();

  const activeBranchId = branchId ?? user?.branchId ?? '';
  const tenantId       = user?.tenantId ?? '';
  const cartCount      = lines.reduce((s, l) => s + l.quantity, 0);

  // ── Products (write-through to Dexie) ──────────────────────────────────
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
    staleTime: 60_000,
    retry: isOnline ? 3 : false,
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
        vatAmount: l.product.isVatable ? computeVat(l.unitPrice * l.quantity).vat : 0,
        lineTotal: (l.unitPrice - l.itemDiscount) * l.quantity,
        costPrice: l.product.costPrice,
        isVatable: l.product.isVatable,
        modifiers: l.modifiers ?? [],
      })),
      payments,
      discounts: orderDiscount ? [{
        discountType: orderDiscount.type,
        discountAmount: orderDiscount.discountOnBase,
        discountPercent: orderDiscount.percent,
        reason: `${orderDiscount.label} — 20% of VAT-excl ₱${orderDiscount.vatExclusiveBase.toFixed(2)}`,
      }] : [],
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
      toast.warning('Order saved offline — will sync when reconnected.');
      return;
    }

    try {
      const { data: order } = await api.post('/orders', { order: orderPayload });
      setShowPayment(false);
      setMobileCartOpen(false);
      setReceiptData({ ...receiptBase, orderNumber: order.orderNumber, isOffline: false });
      clearCart();
      toast.success(`Order #${order.orderNumber} completed`);
    } catch (err: unknown) {
      const isNetworkError =
        (err as { code?: string })?.code === 'ERR_NETWORK' ||
        (err as { code?: string })?.code === 'ECONNABORTED';
      if (isNetworkError) {
        await saveOffline();
        toast.warning('Connection lost — order saved offline and will sync automatically.');
        return;
      }
      // Re-throw so PaymentModal can display the backend error message
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

      <ReceiptModal
        open={!!receiptData}
        data={receiptData}
        onClose={() => setReceiptData(null)}
      />
    </div>
  );
}
