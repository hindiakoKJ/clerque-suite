'use client';

/**
 * Demo POS Terminal — /demo/pos/terminal
 *
 * Self-contained sell flow: product grid → cart → payment → receipt.
 * Reads + writes useDemoStore directly.  No api, no auth-store coupling,
 * no Dexie, no offline sync.  Foundation for the future Capacitor-wrapped
 * Android POS app — same store, same UI, deployed to Play Store.
 */

import { useState, useMemo } from 'react';
import { Plus, Minus, Trash2, X, Search } from 'lucide-react';
import { useDemoStore } from '@/lib/demo/store';
import type { DemoProduct, DemoOrder } from '@/lib/demo/types';

interface CartLine {
  productId: string;
  product: DemoProduct;
  quantity: number;
}

type PaymentMethod = 'CASH' | 'GCASH_BUSINESS' | 'MAYA_BUSINESS' | 'QR_PH' | 'CHARGE';

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  GCASH_BUSINESS: 'GCash Business',
  MAYA_BUSINESS: 'Maya Business',
  QR_PH: 'QR Ph',
  CHARGE: 'Charge to Customer (B2B)',
};

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DemoPosTerminal() {
  const products = useDemoStore((s) => s.products);
  const customers = useDemoStore((s) => s.customers);
  const recordOrder = useDemoStore((s) => s.recordOrder);

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState<DemoOrder | null>(null);

  // Derive unique categories from products
  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of products) seen.set(p.categoryId, p.categoryName);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [products]);

  // Filtered product list
  const visibleProducts = useMemo(() => {
    let items = products.filter((p) => p.isActive);
    if (activeCategory !== 'all') {
      items = items.filter((p) => p.categoryId === activeCategory);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku?.toLowerCase().includes(q) ?? false) ||
        (p.barcode?.toLowerCase().includes(q) ?? false),
      );
    }
    return items;
  }, [products, activeCategory, search]);

  // Cart math (12% VAT inclusive)
  const totals = useMemo(() => {
    const subtotalGross = cart.reduce((s, l) => s + l.product.price * l.quantity, 0);
    const subtotalNet = Math.round((subtotalGross / 1.12) * 100) / 100;
    const vat = Math.round((subtotalGross - subtotalNet) * 100) / 100;
    return {
      subtotalGross: Math.round(subtotalGross * 100) / 100,
      subtotalNet,
      vat,
      total: Math.round(subtotalGross * 100) / 100,
      itemCount: cart.reduce((s, l) => s + l.quantity, 0),
    };
  }, [cart]);

  function addToCart(product: DemoProduct) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.productId === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { productId: product.id, product, quantity: 1 }];
    });
  }

  function changeQty(productId: string, delta: number) {
    setCart((prev) => {
      const next = prev
        .map((l) =>
          l.productId === productId ? { ...l, quantity: l.quantity + delta } : l,
        )
        .filter((l) => l.quantity > 0);
      return next;
    });
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  function clearCart() {
    setCart([]);
  }

  function handlePayment(method: PaymentMethod, customerId: string | null) {
    try {
      const order = recordOrder({
        items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        paymentMethod: method,
        customerId,
      });
      setShowPayment(false);
      setShowReceipt(order);
      setCart([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Demo: order could not be recorded.';
      alert(msg);
    }
  }

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-44px-58px)] min-h-[600px]">
      {/* ── Left: Product grid ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-stone-50 dark:bg-stone-900/30">
        <div className="p-4 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 dark:text-stone-500" />
            <input
              type="text"
              placeholder="Search products by name or barcode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border border-stone-300 dark:border-stone-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                activeCategory === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
              }`}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                  activeCategory === c.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 dark:bg-stone-700'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {visibleProducts.length === 0 ? (
            <div className="text-center py-12 text-stone-500 dark:text-stone-500">No products match.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {visibleProducts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  disabled={p.inventoryQty <= 0}
                  className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg p-3 text-left hover:border-blue-400 hover:shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <p className="text-xs text-stone-400 dark:text-stone-500 uppercase tracking-wide truncate">
                    {p.categoryName}
                  </p>
                  <p className="font-semibold text-stone-900 dark:text-stone-100 mt-0.5 line-clamp-2 min-h-[40px]">
                    {p.name}
                  </p>
                  <div className="mt-2 flex items-end justify-between gap-1">
                    <p className="font-bold text-stone-800 dark:text-stone-200">{peso(p.price)}</p>
                    <p
                      className={`text-[10px] ${
                        p.inventoryQty <= p.lowStockAlert ? 'text-red-600' : 'text-stone-500 dark:text-stone-500'
                      }`}
                    >
                      {p.inventoryQty} left
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Cart panel ─────────────────────────────────────────── */}
      <div className="w-full lg:w-96 lg:border-l border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 flex flex-col">
        <div className="p-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-stone-900 dark:text-stone-100">Current Order</h2>
            <p className="text-xs text-stone-500 dark:text-stone-500">{totals.itemCount} item(s)</p>
          </div>
          {cart.length > 0 && (
            <button
              onClick={clearCart}
              className="text-stone-400 dark:text-stone-500 hover:text-red-600 text-xs"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="p-8 text-center text-sm text-stone-500 dark:text-stone-500">
              Pick products from the left to start an order.
            </div>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {cart.map((line) => (
                <li key={line.productId} className="px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-stone-900 dark:text-stone-100 truncate">
                      {line.product.name}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-stone-500">{peso(line.product.price)}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => changeQty(line.productId, -1)}
                      className="w-6 h-6 rounded bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 dark:bg-stone-700 inline-flex items-center justify-center"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-6 text-center text-sm font-semibold">{line.quantity}</span>
                    <button
                      onClick={() => changeQty(line.productId, 1)}
                      className="w-6 h-6 rounded bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 dark:bg-stone-700 inline-flex items-center justify-center"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => removeLine(line.productId)}
                      className="ml-1 text-stone-400 dark:text-stone-500 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {cart.length > 0 && (
          <div className="border-t border-stone-200 dark:border-stone-800 p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-stone-600 dark:text-stone-400">Subtotal (VAT excl.)</span>
              <span className="font-medium">{peso(totals.subtotalNet)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-stone-600 dark:text-stone-400">VAT (12%)</span>
              <span className="font-medium">{peso(totals.vat)}</span>
            </div>
            <div className="flex items-center justify-between text-base font-bold pt-2 border-t border-stone-100 dark:border-stone-800">
              <span>Total</span>
              <span>{peso(totals.total)}</span>
            </div>
            <button
              onClick={() => setShowPayment(true)}
              className="w-full mt-3 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
            >
              Pay {peso(totals.total)}
            </button>
          </div>
        )}
      </div>

      {showPayment && (
        <PaymentModal
          total={totals.total}
          customers={customers}
          onClose={() => setShowPayment(false)}
          onConfirm={handlePayment}
        />
      )}
      {showReceipt && (
        <ReceiptModal order={showReceipt} onClose={() => setShowReceipt(null)} />
      )}
    </div>
  );
}

// ── Payment Modal ───────────────────────────────────────────────────────────

interface PaymentModalProps {
  total: number;
  customers: { id: string; name: string }[];
  onClose: () => void;
  onConfirm: (method: PaymentMethod, customerId: string | null) => void;
}

function PaymentModal({ total, customers, onClose, onConfirm }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [tendered, setTendered] = useState<number>(total);

  const change = method === 'CASH' ? tendered - total : 0;
  const canConfirm =
    method !== 'CHARGE'
      ? method !== 'CASH' || tendered >= total
      : !!customerId;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-stone-900 rounded-xl max-w-md w-full p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg text-stone-900 dark:text-stone-100">Take Payment</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 dark:text-stone-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-stone-50 dark:bg-stone-900/30 rounded-lg p-4 mb-4 text-center">
          <p className="text-xs text-stone-500 dark:text-stone-500 uppercase">Amount Due</p>
          <p className="text-3xl font-bold text-stone-900 dark:text-stone-100">{peso(total)}</p>
        </div>

        <p className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-2">Payment method</p>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`p-2.5 rounded-lg border text-sm font-medium ${
                method === m
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800/50 dark:bg-stone-900/30'
              }`}
            >
              {PAYMENT_LABELS[m]}
            </button>
          ))}
        </div>

        {method === 'CASH' && (
          <div className="mb-4">
            <p className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-2">Cash tendered</p>
            <input
              type="number"
              value={tendered}
              onChange={(e) => setTendered(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 rounded-lg text-lg font-semibold"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[total, 50, 100, 500, 1000].map((v) => (
                <button
                  key={v}
                  onClick={() => setTendered((prev) => v === total ? total : prev + v)}
                  className="px-3 py-1 text-xs bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 dark:bg-stone-700 rounded"
                >
                  {v === total ? 'Exact' : `+₱${v}`}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-sm bg-stone-50 dark:bg-stone-900/30 rounded p-2">
              <span className="text-stone-600 dark:text-stone-400">Change</span>
              <span className="font-bold">
                {peso(Math.max(0, change))}
              </span>
            </div>
          </div>
        )}

        {method === 'CHARGE' && (
          <div className="mb-4">
            <p className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-2">B2B Customer</p>
            <select
              value={customerId ?? ''}
              onChange={(e) => setCustomerId(e.target.value || null)}
              className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 rounded-lg text-sm"
            >
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-stone-500 dark:text-stone-500 mt-1">
              CHARGE invoices show as receivables in Ledger AR aging.
            </p>
          </div>
        )}

        {(method === 'GCASH_BUSINESS' || method === 'MAYA_BUSINESS' || method === 'QR_PH') && (
          <p className="text-xs text-stone-500 dark:text-stone-500 mb-4 italic">
            Demo: a real digital wallet payment would prompt for a reference number.
          </p>
        )}

        <button
          onClick={() => onConfirm(method, customerId)}
          disabled={!canConfirm}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Complete Payment
        </button>
      </div>
    </div>
  );
}

// ── Receipt Modal ───────────────────────────────────────────────────────────

interface ReceiptModalProps {
  order: DemoOrder;
  onClose: () => void;
}

function ReceiptModal({ order, onClose }: ReceiptModalProps) {
  const date = new Date(order.createdAt);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-stone-900 rounded-xl max-w-sm w-full p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg text-stone-900 dark:text-stone-100">Receipt</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 dark:text-stone-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="font-mono text-xs space-y-1 bg-stone-50 dark:bg-stone-900/30 rounded-lg p-4">
          <div className="border-2 border-dashed border-red-500 bg-red-50 text-red-700 rounded px-2 py-1.5 mb-3 text-center">
            <p className="font-extrabold tracking-widest text-[11px]">⚠ DEMO RECEIPT ⚠</p>
            <p className="text-[9px]">NOT A VALID OFFICIAL RECEIPT — sample only</p>
          </div>

          <div className="text-center space-y-0.5 mb-3">
            <p className="font-bold">Bambu Coffee</p>
            <p className="text-stone-500 dark:text-stone-500 text-[10px]">123 Demo St., Quezon City</p>
            <p className="text-stone-500 dark:text-stone-500 text-[10px]">TIN: 012-345-678-000</p>
            <p className="font-semibold text-stone-700 dark:text-stone-300 text-[11px] uppercase tracking-wide mt-1">
              {order.invoiceType === 'CHARGE' ? 'CHARGE INVOICE' : 'VAT OFFICIAL RECEIPT'}
            </p>
            <p className="text-stone-500 dark:text-stone-500">
              {date.toLocaleDateString('en-PH')} {date.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="font-medium">#{order.orderNumber}</p>
          </div>

          {order.invoiceType === 'CHARGE' && order.customerName && (
            <div className="border border-dashed border-stone-300 dark:border-stone-700 rounded p-2 mb-2">
              <p className="text-stone-400 dark:text-stone-500 uppercase text-[9px]">Bill To</p>
              <p className="font-semibold">{order.customerName}</p>
              {order.customerTin && <p className="text-[9px]">TIN: {order.customerTin}</p>}
            </div>
          )}

          <div className="border-t border-b border-dashed border-stone-300 dark:border-stone-700 py-2 my-2 space-y-0.5">
            {order.items.map((item) => (
              <div key={item.id} className="flex justify-between gap-2">
                <span className="flex-1 truncate">
                  {item.quantity}× {item.productName}
                </span>
                <span>{peso(item.lineTotal)}</span>
              </div>
            ))}
          </div>

          <div className="space-y-0.5">
            <div className="flex justify-between">
              <span>VATable Sales</span>
              <span>{peso(order.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>VAT (12%)</span>
              <span>{peso(order.vatAmount)}</span>
            </div>
            <div className="flex justify-between font-bold text-sm pt-1 border-t border-dashed border-stone-300 dark:border-stone-700 mt-1">
              <span>TOTAL</span>
              <span>{peso(order.totalAmount)}</span>
            </div>
            {order.payments.map((p) => (
              <div key={p.id} className="flex justify-between">
                <span>Paid ({PAYMENT_LABELS[p.method as PaymentMethod] ?? p.method})</span>
                <span>{peso(p.amount)}</span>
              </div>
            ))}
            {order.amountDue > 0 && (
              <div className="flex justify-between font-semibold text-red-700">
                <span>BALANCE DUE</span>
                <span>{peso(order.amountDue)}</span>
              </div>
            )}
          </div>

          <p className="text-center text-stone-400 dark:text-stone-500 text-[9px] mt-3">
            Thank you for trying Clerque!
          </p>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full py-2.5 bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 text-stone-800 dark:text-stone-200 font-semibold rounded-lg"
        >
          Close
        </button>
      </div>
    </div>
  );
}
