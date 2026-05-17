'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Coffee, Sparkles, Receipt, ShoppingCart, ChefHat } from 'lucide-react';
import { formatPeso } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import {
  subscribeCustomerDisplay,
  type CustomerDisplayState,
} from '@/lib/pos/customer-display-channel';
import {
  readDeviceToken,
  verifyDeviceToken,
  clearDeviceToken,
} from '@/lib/pos/device-token';

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
  const userId             = useAuthStore((s) => s.user?.sub ?? null);
  const searchParams       = useSearchParams();
  const [state, setState]  = useState<CustomerDisplayState>(EMPTY);

  // Sprint 7: two-phase PAYMENT_COMPLETE display.
  // Phase A (~5s):   green "Salamat!" + change due — the cashier just confirmed payment
  // Phase B (~30s):  amber "Preparing your order" with order number — gives the
  //                  customer a comfortable visual while they wait at the counter
  // After ~35s total, terminal publishes a WELCOME and the screen resets.
  const [paymentPhase, setPaymentPhase] = useState<'thanks' | 'preparing'>('thanks');
  const lastPaymentSeq = useRef<number | null>(null);
  useEffect(() => {
    if (state.type === 'PAYMENT_COMPLETE') {
      // Reset phase to 'thanks' on each new payment event (seq changes)
      if (lastPaymentSeq.current !== state.seq) {
        lastPaymentSeq.current = state.seq;
        setPaymentPhase('thanks');
        const t = setTimeout(() => setPaymentPhase('preparing'), 5_000);
        return () => clearTimeout(t);
      }
    } else {
      lastPaymentSeq.current = null;
      setPaymentPhase('thanks');
    }
  }, [state.type, state.seq]);

  // ── Cashier-id resolution (Sprint 25: paired-device aware) ──────────────
  // Priority chain:
  //   1. ?cashier=<id> URL override (wall-mounted screens pointing at one POS)
  //   2. Stored deviceToken in localStorage → /whoami → cashierId
  //   3. useAuthStore().user.sub  (logged-in single-tablet fallback)
  //   4. None → redirect to /pair so the operator can pair this device
  //
  // On a paired display the JWT may not exist at all (PUBLIC_PREFIXES allows
  // this route without auth), so #2/#3 are the real sources of truth. The
  // `useAuthStore()` call still works — it just returns null.
  const router = useRouter();
  const urlOverride = searchParams.get('cashier');
  const [pairedCashierId, setPairedCashierId] = useState<string | null>(null);
  const [tokenChecked,    setTokenChecked]    = useState(false);

  // Keep the stored token reactive — heartbeat below also depends on it.
  const storedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = readDeviceToken();
      if (!stored) {
        if (!cancelled) setTokenChecked(true);
        return;
      }
      storedTokenRef.current = stored.deviceToken;
      const who = await verifyDeviceToken(stored.deviceToken);
      if (cancelled) return;
      if (who) {
        setPairedCashierId(who.cashierId);
      } else {
        // Token revoked — drop it so the redirect path can run.
        clearDeviceToken();
        storedTokenRef.current = null;
      }
      setTokenChecked(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const cashierId = urlOverride ?? pairedCashierId ?? userId;

  // If we've checked the token and STILL have no source, bounce to /pair.
  // Wait for tokenChecked so we don't redirect during the brief whoami round-trip.
  useEffect(() => {
    if (!tokenChecked) return;
    if (!cashierId) {
      router.replace('/pair');
    }
  }, [tokenChecked, cashierId, router]);

  useEffect(() => {
    if (!cashierId) return;
    const unsubscribe = subscribeCustomerDisplay(setState, {
      cashierId,
      pollIntervalMs: 1000,
    });
    return unsubscribe;
  }, [cashierId]);

  // ── Heartbeat: ping /whoami every 30 s so lastSeenAt stays fresh in the
  // cashier's Settings → Displays table. Skipped when not in paired mode.
  useEffect(() => {
    if (!storedTokenRef.current) return;
    const id = setInterval(() => {
      const token = storedTokenRef.current;
      if (token) void verifyDeviceToken(token);
    }, 30_000);
    return () => clearInterval(id);
  }, [pairedCashierId]);

  const businessName = state.businessName ?? tenantBusinessName ?? 'Welcome';

  // Welcome screen — no active cart
  if (state.type === 'WELCOME' || (state.lines.length === 0 && state.type !== 'PAYMENT_PENDING')) {
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

  // Sprint 25 — Tendering screen on the customer side. When the cashier
  // picks Cash / GCash / PayMaya / Card / Split, this mirrors the brand
  // QR + amount so the customer can scan from the kiosk display.
  if (state.type === 'PAYMENT_PENDING') {
    const method = state.paymentMethod ?? 'CASH';
    const isEWallet = method === 'GCASH' || method === 'PAYMAYA';
    const brand =
      method === 'GCASH'   ? { name: 'GCash',   color: '#007BFC', bg: 'linear-gradient(135deg, #003F8C 0%, #007BFC 100%)' } :
      method === 'PAYMAYA' ? { name: 'PayMaya', color: '#00B14F', bg: 'linear-gradient(135deg, #00582A 0%, #00B14F 100%)' } :
      method === 'CARD'    ? { name: 'Card',    color: '#475569', bg: 'linear-gradient(135deg, #1e293b 0%, #475569 100%)' } :
      method === 'SPLIT'   ? { name: 'Split payment', color: '#6b3f1d', bg: 'linear-gradient(135deg, #6b3f1d 0%, #8b5e3c 100%)' } :
                             { name: 'Cash',    color: '#1F1B16', bg: 'linear-gradient(135deg, #1F1B16 0%, #5F564B 100%)' };
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-12 text-center text-white"
        style={{ background: brand.bg }}
      >
        <p className="text-white/70 text-xl uppercase tracking-widest mb-3">Amount due</p>
        <h1 className="text-7xl sm:text-8xl font-bold tracking-tight tabular-nums mb-10">
          {formatPeso(state.total)}
        </h1>
        {isEWallet ? (
          <div className="bg-white rounded-2xl p-6 mb-8 shadow-2xl">
            {state.qrImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={state.qrImageUrl} alt={`${brand.name} QR`} className="w-72 h-72 object-contain" />
            ) : (
              <div
                className="w-72 h-72 flex flex-col items-center justify-center font-bold"
                style={{ color: brand.color }}
              >
                <div className="text-3xl">{brand.name}</div>
                <div className="text-sm text-stone-400 mt-2 tracking-widest">QR CODE</div>
                <p className="text-xs text-stone-400 mt-6 px-6 leading-snug">
                  Ask your cashier to upload your business QR in Settings
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-white/80 text-2xl mb-8">
            Please pay <span className="font-semibold">{brand.name}</span> at the counter
          </p>
        )}
        <p className="text-white/60 text-base">{businessName}</p>
      </div>
    );
  }

  // Payment complete — phase A: "Salamat!" + change due (5 seconds)
  if (state.type === 'PAYMENT_COMPLETE' && paymentPhase === 'thanks') {
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

        <p className="text-emerald-100 text-sm mt-8 italic">Please wait — we&apos;re preparing your order</p>
      </div>
    );
  }

  // Payment complete — phase B: "Preparing your order" with the order number.
  // Shown after the change-due display fades. The customer waits at the counter
  // for their order number to be called when bar/kitchen finishes.
  if (state.type === 'PAYMENT_COMPLETE' && paymentPhase === 'preparing') {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-12 text-center"
        style={{ background: 'linear-gradient(135deg, #b45309 0%, #f59e0b 100%)' }}
      >
        <ChefHat className="h-20 w-20 text-white mb-6 animate-pulse" />
        <h1 className="text-5xl sm:text-6xl font-bold text-white mb-3">Preparing your order</h1>
        <p className="text-amber-50 text-2xl mb-12">Please wait at the counter</p>

        {state.orderNumber && (
          <div className="bg-white/15 backdrop-blur rounded-2xl px-12 py-10 max-w-md w-full">
            <p className="text-amber-100 text-lg uppercase tracking-widest mb-3">Order number</p>
            <p className="text-7xl font-bold text-white tabular-nums">{state.orderNumber}</p>
          </div>
        )}

        <p className="text-amber-100 text-sm mt-12 italic">We&apos;ll call your number when it&apos;s ready</p>
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

        {/* PAYMENT_PENDING now gets its own dedicated branded screen earlier
            in this component (Sprint 25), so the legacy in-cart pill below
            is no longer reachable here. */}
      </div>

      {/* Subtle attribution footer */}
      <footer className="px-12 py-2 text-center text-xs text-stone-500 italic">
        powered by Clerque
      </footer>
    </div>
  );
}
