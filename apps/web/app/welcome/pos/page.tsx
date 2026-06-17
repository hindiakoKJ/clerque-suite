/**
 * Counter (POS) standalone landing page — Sprint 23.
 *
 * Marketing entry point for prospects considering Clerque POS / Counter.
 * Two plans (Solo ₱299 full POS / Solo Books ₱399 full POS + simple ledger)
 * positioned against Loyverse-paid pricing — cheaper with PH compliance
 * Loyverse doesn't offer at any price.
 *
 * Public (no auth). CTAs route to /signup/pos (or /signup, if pos-specific
 * wizard isn't built yet) or /login.
 */
import Link from 'next/link';
import {
  ArrowRight, CheckCircle2, Coffee, Smartphone, Shield, Receipt,
} from 'lucide-react';
import { PLAN_CAPS } from '@repo/shared-types';

const ACCENT      = '#8B5E3C';
const ACCENT_SOFT = '#EEE9DF';

export const metadata = {
  title: 'Clerque Counter — Offline-ready POS for Philippine cafés and shops',
  description:
    'BIR-compliant POS for owner-operated cafés and retail. Recipe COGS, batch inventory with FEFO, and PH-native payments — at a fraction of Loyverse-paid pricing.',
};

// Format the price from PLAN_CAPS so the marketing copy is always in sync
// with the canonical source. If pricing changes, this updates automatically.
function priceLabel(code: 'SOLO_PRO' | 'SOLO_BOOKS'): string {
  const peso = Math.round(PLAN_CAPS[code].pricePhpMonthlyCents / 100);
  return `₱${peso.toLocaleString('en-PH')}`;
}

function Hero() {
  return (
    <section
      className="relative px-6 py-20 sm:py-28 text-center"
      style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT} 0%, #FFFFFF 100%)` }}
    >
      <div className="max-w-3xl mx-auto">
        <div
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full mb-6"
          style={{ background: ACCENT, color: 'white' }}
        >
          <Coffee className="h-3 w-3" /> Clerque Counter · Standalone POS
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-zinc-900 leading-tight mb-5">
          The POS that beats Loyverse on every count —
          <br />and is <span style={{ color: ACCENT }}>BIR-ready out of the box</span>.
        </h1>
        <p className="text-lg text-zinc-600 max-w-2xl mx-auto mb-8 leading-relaxed">
          Loyverse Free is missing BIR compliance, GCash native flows, and PWD/Senior discounts.
          Loyverse Paid is ₱2,800+/month. Clerque Counter is ₱299/mo for full POS with PH
          compliance built in — or ₱399/mo for Solo Books, which adds simple bookkeeping.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-white font-semibold text-sm hover:opacity-90 transition-opacity"
            style={{ background: ACCENT }}
          >
            Start 30-day free trial <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-zinc-300 text-zinc-700 font-medium text-sm hover:bg-zinc-50"
          >
            Sign in
          </Link>
        </div>
        <p className="text-xs text-zinc-500 mt-4">
          30 days free · No credit card · BIR-compliant Z-read · Works with any Bluetooth thermal printer
        </p>
      </div>
    </section>
  );
}

function WhyUs() {
  const reasons = [
    {
      icon: Shield,
      title: 'BIR compliance built in',
      body: 'OR# gap-free sequencing, BIR-format Z-read, VAT modes (VAT-12 / VAT-exempt / Non-VAT), TIN capture on B2B invoices, Senior/PWD discount with ID capture. Things Loyverse cannot do at any price.',
    },
    {
      icon: Receipt,
      title: 'PH-native payments',
      body: 'GCash, PayMaya, GrabPay, QR Ph — all with proper PH-tendering UI. Card and cash too, of course. Split payment supported.',
    },
    {
      icon: Coffee,
      title: 'Recipe COGS that auto-blends costs',
      body: 'Bought milk at ₱120 Monday and ₱140 Wednesday? Clerque auto-blends to a weighted average so every drink\'s COGS is right — no manual tracking.',
    },
    {
      icon: Smartphone,
      title: 'Works on any Android tablet',
      body: 'Open in Chrome on a Samsung Galaxy Tab A8. Pair a Bluetooth thermal printer. Run your café. No app store, no installation, no IT.',
    },
  ];

  return (
    <section className="px-6 py-16 bg-white">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 text-center mb-2">
          Why Filipino café and retail owners pick Clerque
        </h2>
        <p className="text-center text-zinc-600 mb-10 text-sm">
          Built for PH compliance. Priced for SMB. Lives on your tablet.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {reasons.map((r) => (
            <div key={r.title} className="rounded-xl border border-zinc-200 p-6">
              <div
                className="inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3"
                style={{ background: ACCENT_SOFT, color: ACCENT }}
              >
                <r.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-zinc-900 mb-2">{r.title}</h3>
              <p className="text-sm text-zinc-600 leading-relaxed">{r.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  // Prices auto-read from PLAN_CAPS so this page can never drift from the
  // canonical billing source (Sprint 23 invariant).
  const tiers: Array<{
    code: 'SOLO_PRO' | 'SOLO_BOOKS';
    name: string;
    subtitle: string;
    features: string[];
    recommended?: boolean;
  }> = [
    {
      code: 'SOLO_PRO',
      name: 'Solo',
      subtitle: 'Full-access POS · up to 5 users',
      features: [
        'Unlimited transactions, products, customers',
        'BIR-compliant Z-read + OR# sequencing',
        'Unlimited recipe products with WAC ingredient COGS',
        'Unlimited batch / FEFO / expiry on every item (+ FIFO option)',
        'Modifiers, discounts, PWD/Senior, open tickets',
        'GCash / Maya / QR Ph / card tendering',
        'Audit log + custom roles + maker-checker voids',
        'Advanced reports, Loyalty Pro, Google Drive auto-backup, API read',
      ],
    },
    {
      code: 'SOLO_BOOKS',
      name: 'Solo Books',
      subtitle: 'Full POS + simple bookkeeping · up to 5 users',
      features: [
        'Everything in Solo',
        'Simple bookkeeping — record income & expenses',
        'See money owed from charge sales',
        'Simple income-vs-expense summary',
        'Upgrade anytime for full accounting — journal, BIR forms, statements',
      ],
      recommended: true,
    },
  ];

  return (
    <section className="px-6 py-16" style={{ background: ACCENT_SOFT }}>
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 text-center mb-2">
          Three Solo tiers. All paid. All cheaper than Loyverse.
        </h2>
        <p className="text-center text-zinc-600 mb-10 text-sm">
          We don&apos;t do a stripped &quot;free&quot; tier. Every plan is a real BIR-ready product.
          Compare any tier to Loyverse-with-add-ons — we win on price and features.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`bg-white rounded-xl p-6 border-2 ${
                t.recommended ? '' : 'border-zinc-200'
              }`}
              style={t.recommended ? { borderColor: ACCENT } : {}}
            >
              {t.recommended && (
                <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: ACCENT }}>
                  Most popular
                </div>
              )}
              <h3 className="font-bold text-xl text-zinc-900 mb-1">{t.name}</h3>
              <p className="text-xs text-zinc-500 mb-4">{t.subtitle}</p>
              <div className="mb-5">
                <span className="text-3xl font-bold text-zinc-900">{priceLabel(t.code)}</span>
                <span className="text-sm text-zinc-500">/month</span>
              </div>
              <ul className="space-y-2 mb-6">
                {t.features.map((f) => (
                  <li key={f} className="text-sm text-zinc-700 flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: ACCENT }} />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className="block text-center text-sm font-medium px-4 py-2 rounded-lg w-full"
                style={
                  t.recommended
                    ? { background: ACCENT, color: 'white' }
                    : { border: `1px solid ${ACCENT}`, color: ACCENT }
                }
              >
                Start free trial
              </Link>
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-500 text-center mt-8 max-w-2xl mx-auto">
          Outgrowing Solo? Multiple branches, more than 5 staff, need Ledger/Payroll too? See our{' '}
          <Link href="/welcome/ledger" className="underline">Pair and Suite plans</Link> with full accounting + payroll modules.
          Each Solo plan above covers single-location POS with BIR compliance.
        </p>
        <p className="text-[11px] text-zinc-500 text-center mt-2 italic">
          Some advanced features (batch inventory, custom roles, offline POS) are shipping over the next 3-4 months
          and will auto-unlock for tier subscribers when they go live — no re-pricing.
        </p>
      </div>
    </section>
  );
}

function VsLoyverse() {
  return (
    <section className="px-6 py-16 bg-white">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 text-center mb-2">
          Versus Loyverse — straight numbers
        </h2>
        <p className="text-center text-zinc-600 mb-10 text-sm">
          What it costs you elsewhere vs what it costs you here.
        </p>
        <div className="rounded-xl border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ background: ACCENT_SOFT }}>
              <tr>
                <th className="text-left p-3 font-semibold text-zinc-700">What you need</th>
                <th className="text-right p-3 font-semibold text-zinc-700">Loyverse</th>
                <th className="text-right p-3 font-semibold text-zinc-700">Clerque</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-zinc-200">
                <td className="p-3 text-zinc-700">Basic POS with PH BIR Z-read</td>
                <td className="p-3 text-right text-zinc-500 italic">Not available at any price</td>
                <td className="p-3 text-right font-semibold" style={{ color: ACCENT }}>Included in Solo ₱299</td>
              </tr>
              <tr className="border-t border-zinc-200">
                <td className="p-3 text-zinc-700">+ Unlimited recipe COGS, FEFO, audit, 5 users</td>
                <td className="p-3 text-right text-zinc-500">Free + 3 add-ons ~₱3,300/mo</td>
                <td className="p-3 text-right font-semibold" style={{ color: ACCENT }}>Solo ₱299 (11× cheaper)</td>
              </tr>
              <tr className="border-t border-zinc-200">
                <td className="p-3 text-zinc-700">+ Simple bookkeeping (income & expenses)</td>
                <td className="p-3 text-right text-zinc-500 italic">Not available — no accounting</td>
                <td className="p-3 text-right font-semibold" style={{ color: ACCENT }}>Solo Books ₱399</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default function CounterWelcomePage() {
  return (
    <div className="min-h-screen bg-white">
      <Hero />
      <WhyUs />
      <Pricing />
      <VsLoyverse />
      <footer className="px-6 py-10 bg-zinc-50 border-t border-zinc-200">
        <div className="max-w-5xl mx-auto text-center text-xs text-zinc-500">
          © Clerque · Built for Filipino businesses ·{' '}
          <Link href="/legal/privacy" className="underline">Privacy</Link>{' · '}
          <Link href="/legal/terms" className="underline">Terms</Link>
        </div>
      </footer>
    </div>
  );
}
