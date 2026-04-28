'use client';

/**
 * Demo Entry Page — /demo
 *
 * The single entry point into demo mode.  Visitors land here from a
 * marketing CTA on the landing page (HNScorpPH) or directly via URL.
 *
 * Responsibilities:
 *   1. Activate demo cookie + sessionStorage flag (lib/demo/config.ts)
 *   2. Seed the auth store with the demo user identity so app pages see
 *      a "logged-in" user (bypassing the real auth flow entirely)
 *   3. Show a brief intro modal explaining what demo mode is
 *   4. Redirect to /pos/terminal once the visitor clicks "Start"
 *
 * The seeded auth store uses a fake demo accessToken that the demoApi
 * adapter accepts.  The real backend is never called.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { activateDemo } from '@/lib/demo/config';
import { useDemoStore } from '@/lib/demo/store';
import { DEMO_USER_INFO } from '@/lib/demo/seed';
import { useAuthStore } from '@/store/auth';
import { useCartStore } from '@/store/pos/cart';
import { useShiftStore } from '@/store/pos/shift';
import { ShoppingCart, BookOpen, Users, ArrowRight, Sparkles } from 'lucide-react';

const DEMO_AUTH_FLAG_KEY = 'clerque-demo-auth';

export default function DemoEntryPage() {
  const router = useRouter();
  const [step, setStep] = useState<'intro' | 'starting'>('intro');

  function startDemo() {
    setStep('starting');

    // 1. Activate demo flags (cookie + sessionStorage)
    activateDemo();

    // 2. Seed auth store with demo identity.  The accessToken is a fake
    //    string the demo adapter recognises; jwtDecode would normally parse
    //    it, so we provide a minimal valid-looking JWT payload directly.
    const demoUser = {
      sub: DEMO_USER_INFO.id,
      name: DEMO_USER_INFO.name,
      email: DEMO_USER_INFO.email,
      tenantId: DEMO_USER_INFO.tenantId,
      branchId: DEMO_USER_INFO.branchId,
      role: DEMO_USER_INFO.role,
      isSuperAdmin: false,
      appAccess: [
        { app: 'POS' as const, level: 'FULL' as const },
        { app: 'LEDGER' as const, level: 'FULL' as const },
        { app: 'PAYROLL' as const, level: 'FULL' as const },
      ],
      taxStatus: 'VAT' as const,
      isVatRegistered: true,
      isBirRegistered: true,
      tinNumber: '012-345-678-000',
      businessName: 'Bambu Coffee',
      registeredAddress: '123 Demo Street, Quezon City',
      isPtuHolder: false,
      ptuNumber: null,
      minNumber: null,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    };

    // Use the proper setters — setTokens then setUser.  setUser internally
    // pushes taxStatus into the cart store via setTenantFlags(), which is
    // critical: without it, the cart store's taxStatus stays 'UNREGISTERED'
    // (the default) while user.taxStatus is 'VAT', causing VAT-calc effects
    // to thrash and trigger a "Maximum update depth" infinite-render loop.
    useAuthStore.getState().setTokens('demo-access-token', 'demo-refresh-token');
    useAuthStore.getState().setUser(demoUser);

    // Initialise the cart store's branch context so the terminal page's
    // activeBranchId resolves immediately (otherwise it's empty string and
    // the products query is `enabled: false`).
    useCartStore.getState().setBranch(DEMO_USER_INFO.branchId);

    // Seed an active shift in the shift store so the POS terminal doesn't
    // open the OpenShiftModal blocking gate.  Numbers come from the demo
    // store's active shift seed.
    useShiftStore.getState().setActiveShift({
      id: 'demo-shift-active',
      branchId: DEMO_USER_INFO.branchId,
      cashierId: DEMO_USER_INFO.id,
      openingCash: 2000,
      openedAt: new Date().toISOString(),
      cashSales: 0,
      nonCashSales: 0,
      totalSales: 0,
      orderCount: 0,
      voidCount: 0,
      expectedCash: 2000,
      digitalBreakdown: {},
    });

    // Marker so the auth store knows it's a demo session (prevents
    // accidental refresh attempts against the real /auth/refresh endpoint).
    try {
      window.sessionStorage.setItem(DEMO_AUTH_FLAG_KEY, '1');
    } catch {
      /* sessionStorage may be unavailable */
    }

    // 3. Touch the demo store so it hydrates from seed data
    useDemoStore.getState();

    // 4. Redirect to POS terminal
    setTimeout(() => {
      router.push('/pos/terminal');
    }, 600);
  }

  // Auto-reset on URL flag — let HNScorpPH link with ?reset=1 to force a
  // fresh demo state if the visitor returns.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === '1') {
      useDemoStore.getState().reset();
    }
  }, []);

  if (step === 'starting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-600 text-white mb-4 animate-pulse">
            <Sparkles className="w-8 h-8" />
          </div>
          <p className="text-stone-700 font-medium">Setting up your demo business…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center px-4 py-8">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl p-8 sm:p-12">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 text-amber-700 mb-6">
          <Sparkles className="w-6 h-6" />
        </div>

        <h1 className="text-3xl sm:text-4xl font-serif font-bold text-stone-900 mb-3">
          Try Clerque
        </h1>
        <p className="text-stone-600 text-lg mb-8 leading-relaxed">
          Pretend you're running <span className="font-semibold text-stone-800">Bambu Coffee</span>,
          a small Filipino café. Sell, run the books, manage payroll — all without an account.
        </p>

        <div className="bg-stone-50 rounded-xl p-6 mb-8">
          <p className="text-sm font-semibold text-stone-700 mb-4 uppercase tracking-wide">
            What you can do
          </p>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <ShoppingCart className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-stone-800">POS Terminal</p>
                <p className="text-sm text-stone-600">
                  Sell coffee, take cash or GCash payment, even bill B2B customers on credit.
                  Try voiding an order. Watch the receipt print.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <BookOpen className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-stone-800">Ledger</p>
                <p className="text-sm text-stone-600">
                  Every sale auto-posts to the journal. See the trial balance update.
                  Browse a sample chart of accounts. Track unpaid B2B invoices in AR aging.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Users className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-stone-800">Payroll</p>
                <p className="text-sm text-stone-600">
                  Clock in/out. View employee timesheets and last month's payslips
                  with SSS, PhilHealth, and Pag-IBIG contributions.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-stone-500 mb-6 px-1">
          🎬 <span className="font-semibold">Demo mode:</span> nothing is saved to a server.
          Your changes live in this browser tab and disappear when you close it.
          Refresh the page anytime — your demo activity stays. Hit "Reset Demo" in the
          banner above to start fresh.
        </div>

        <button
          onClick={startDemo}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl transition-colors"
        >
          Start the Demo
          <ArrowRight className="w-5 h-5" />
        </button>

        <div className="mt-6 text-center text-sm text-stone-600">
          Want to use Clerque for your real business?{' '}
          <a href="/login" className="text-amber-700 font-semibold hover:underline">
            Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
