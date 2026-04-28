'use client';

/**
 * Demo Entry Page — /demo
 *
 * The single entry point into demo mode.  Visitors land here from a
 * marketing CTA and click "Start the Demo" to enter the standalone
 * demo experience at /demo/pos/terminal.
 *
 * Architecture: the demo at /demo/* is fully self-contained — it does
 * NOT mount the real Clerque app's pages.  Each /demo/* page reads
 * directly from useDemoStore and renders a simplified version of the
 * Clerque UI.  No auth bypass, no API interception, no shape-matching.
 *
 * This page just:
 *   1. Activates the demo cookie + sessionStorage flag (so isDemoMode()
 *      returns true on subsequent /demo/* pages — used for the banner
 *      and noindex meta)
 *   2. Touches useDemoStore to ensure it's hydrated from seed data
 *   3. Redirects to /demo/pos/terminal
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { activateDemo } from '@/lib/demo/config';
import { useDemoStore } from '@/lib/demo/store';
import { ShoppingCart, BookOpen, Users, ArrowRight, Sparkles } from 'lucide-react';

export default function DemoEntryPage() {
  const router = useRouter();
  const [step, setStep] = useState<'intro' | 'starting'>('intro');

  // Auto-reset on URL flag — let HNScorpPH link with ?reset=1 to force a
  // fresh demo state if the visitor returns.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === '1') {
      useDemoStore.getState().reset();
    }
  }, []);

  function startDemo() {
    setStep('starting');

    // Activate demo flags so the banner / noindex meta show on every
    // /demo/* page the visitor navigates to.
    activateDemo();

    // Touch the demo store so it hydrates from seed data
    useDemoStore.getState();

    // Redirect to the standalone demo POS terminal
    setTimeout(() => {
      router.push('/demo/pos/terminal');
    }, 600);
  }

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
                <p className="font-semibold text-stone-800">Counter (POS)</p>
                <p className="text-sm text-stone-600">
                  Sell coffee, take cash or GCash payment, watch the receipt print.
                  Browse inventory and product catalog.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <BookOpen className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-stone-800">Ledger</p>
                <p className="text-sm text-stone-600">
                  Every sale auto-posts to the journal. See the trial balance update.
                  Browse a sample chart of accounts. Post your own manual journal entries.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Users className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-stone-800">Sync (Payroll)</p>
                <p className="text-sm text-stone-600">
                  Clock in and out. View attendance and timesheets.
                  See sample payslips with SSS, PhilHealth, and Pag-IBIG contributions.
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
