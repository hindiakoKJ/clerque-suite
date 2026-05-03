'use client';
import { useEffect, useState } from 'react';
import { Coffee, Sparkles, Receipt, ShoppingCart } from 'lucide-react';
import { formatPeso } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import {
  subscribeCustomerDisplay,
  type CustomerDisplayState,
} from '@/lib/pos/customer-display-channel';

const EMPTY: CustomerDisplayState = {
  type: 'WELCOME',
  lines: [],
  subtotal: 0,
  discount: 0,
  vatAmount: 0,
  total: 0,
  seq: 0,
  ts: 0,
};

export default function CustomerDisplayPage() {
  const tenantBusinessName = useAuthStore((s) => s.user?.businessName ?? null);
  const [state, setState] = useState<CustomerDisplayState>(EMPTY);

  useEffect(() => {
    const unsubscribe = subscribeCustomerDisplay(setState);
    return unsubscribe;
  }, []);

  const businessName = state.businessName ?? tenantBusinessName ?? 'Welcome';

  // Welcome screen — no active cart
  if (state.type === 'WELCOME' || state.lines.length === 0) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-12 text-center"
        style={{ background: 'linear-gradient(135deg, #6b3f1d 0%, #8b5e3c 100%)' }}
      >
        <Coffee className="h-24 w-24 text-amber-100 mb-6 opacity-90" />
        <h1 className="text-5xl sm:text-6xl font-bold text-white mb-3 tracking-tight">
          {businessName}
        </h1>
        <p className="text-amber-100 text-xl">Welcome — please order at the counter</p>
      </div>
    );
  }

  // Payment complete — thank you + change due
  if (state.type === 'PAYMENT_COMPLETE') {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-12 text-center"
        style={{ background: 'linear-gradient(135deg, #047857 0%, #10b981 100%)' }}
      >
        <Sparkles className="h-20 w-20 text-white mb-6" />
        <h1 className="text-5xl sm:text-6xl font-bold text-white mb-2">Salamat!</h1>
        <p className="text-emerald-50 text-2xl mb-10">Thank you for your order</p>

        <div className="bg-white/10 backdrop-blur rounded-2xl px-10 py-8 space-y-3 max-w-md w-full">
          <div className="flex justify-between text-emerald-50 text-lg">
            <span>Total Paid</span>
            <span className="font-semibold">{formatPeso(state.total)}</span>
          </div>
          {state.amountTendered != null && (
            <div className="flex justify-between text-emerald-50 text-lg">
              <span>Tendered</span>
              <span className="font-semibold">{formatPeso(state.amountTendered)}</span>
            </div>
          )}
          {state.changeDue != null && state.changeDue > 0 && (
            <div className="flex justify-between text-white text-3xl font-bold pt-3 border-t border-emerald-200/30">
              <span>Change Due</span>
              <span>{formatPeso(state.changeDue)}</span>
            </div>
          )}
        </div>

        <p className="text-emerald-100 text-sm mt-8 italic">Please come again</p>
      </div>
    );
  }

  // Active cart — show items + total
  return (
    <div className="min-h-screen flex flex-col bg-stone-900 text-white">
      {/* Header */}
      <header
        className="px-12 py-6 flex items-center justify-between border-b-4"
        style={{ background: '#6b3f1d', borderColor: '#8b5e3c' }}
      >
        <div className="flex items-center gap-3">
          <Coffee className="h-8 w-8 text-amber-200" />
          <h1 className="text-3xl font-bold tracking-tight">{businessName}</h1>
        </div>
        <div className="flex items-center gap-2 text-amber-200">
          <ShoppingCart className="h-5 w-5" />
          <span className="text-lg font-medium">Your Order</span>
        </div>
      </header>

      {/* Lines */}
      <div className="flex-1 overflow-y-auto px-12 py-6 space-y-1">
        {state.lines.map((line, idx) => (
          <div
            key={idx}
            className="flex items-baseline justify-between py-3 px-4 rounded-lg hover:bg-white/5 transition-colors"
          >
            <div className="flex items-baseline gap-4 flex-1 min-w-0">
              <span className="text-2xl font-bold tabular-nums text-amber-300 w-12 shrink-0">
                {line.quantity}×
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-2xl font-medium truncate">{line.productName}</p>
                {line.modifiers && line.modifiers.length > 0 && (
                  <p className="text-sm text-stone-400 mt-0.5">{line.modifiers.join(' · ')}</p>
                )}
              </div>
            </div>
            <span className="text-2xl font-semibold tabular-nums shrink-0 ml-6">
              {formatPeso(line.lineTotal)}
            </span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="px-12 py-6 bg-stone-800/50 border-t border-stone-700">
        {state.discount > 0 && (
          <div className="flex justify-between text-stone-300 text-lg mb-2">
            <span>Discount</span>
            <span className="text-emerald-400">-{formatPeso(state.discount)}</span>
          </div>
        )}
        {state.vatAmount > 0 && (
          <div className="flex justify-between text-stone-300 text-lg mb-2">
            <span>VAT (12%)</span>
            <span>{formatPeso(state.vatAmount)}</span>
          </div>
        )}
        <div className="flex justify-between items-baseline border-t border-stone-700 pt-4">
          <span className="text-xl text-stone-300 uppercase tracking-wide font-medium">Total</span>
          <span className="text-6xl font-bold tabular-nums text-amber-300">
            {formatPeso(state.total)}
          </span>
        </div>

        {state.type === 'PAYMENT_PENDING' && (
          <div className="mt-6 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/40 flex items-center gap-3">
            <Receipt className="h-5 w-5 text-amber-400" />
            <span className="text-amber-100 text-lg">Please confirm payment with your cashier</span>
          </div>
        )}
      </div>

      {/* Subtle attribution footer */}
      <footer className="px-12 py-2 text-center text-xs text-stone-500 italic">
        powered by Clerque
      </footer>
    </div>
  );
}
