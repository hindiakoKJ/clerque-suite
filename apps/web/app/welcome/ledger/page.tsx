/**
 * Standalone Ledger landing page — Sprint 21.
 *
 * Marketing/awareness entry point for prospects who want accounting WITHOUT
 * a POS. Public (no auth) — sits under apps/web (not apps/landing — that
 * repo is in a separate session).
 *
 * Three audience hooks:
 *   1. BIR-pain — "file 2550Q in 15 minutes, no accountant required"
 *   2. Service businesses (no inventory, no POS) — AR invoicing + expenses + BIR
 *   3. Accounting firms — service many SME clients from one place
 *
 * CTAs route to /signup/ledger (the new wizard) or /login. The actual BIR
 * demo video is a placeholder iframe — owner to drop the YouTube/Loom link
 * into VIDEO_URL when recorded.
 */
import Link from 'next/link';
import {
  FileText, TrendingUp, ShieldCheck, Receipt, BookOpen, Clock, ArrowRight,
  CheckCircle2, Building2, Users, Briefcase,
} from 'lucide-react';

const ACCENT      = '#8B5E3C';
const ACCENT_SOFT = '#EEE9DF';
const VIDEO_URL   = ''; // TODO: paste Loom/YouTube embed URL when recorded

export const metadata = {
  title: 'Clerque Books — Standalone Accounting for Philippine SMEs',
  description:
    'File BIR returns in 15 minutes. Track real cash flow. No POS required. Built for service businesses, accounting firms, and sole proprietors.',
};

// ─── Sections ─────────────────────────────────────────────────────────────

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
          <BookOpen className="h-3 w-3" /> Clerque Books · Standalone Accounting
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-zinc-900 leading-tight mb-5">
          File BIR returns in <span style={{ color: ACCENT }}>15 minutes</span>.
          <br />No accountant needed for daily work.
        </h1>
        <p className="text-lg text-zinc-600 max-w-2xl mx-auto mb-8 leading-relaxed">
          Clerque Books is the lightweight accounting system built for Filipino service businesses,
          sole proprietors, and bookkeeping firms. Send invoices, track expenses, and generate
          BIR forms — without a POS, without complexity.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/signup/ledger"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-white font-semibold text-sm hover:opacity-90 transition-opacity"
            style={{ background: ACCENT }}
          >
            Start 90-day free trial <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/login?app=ledger"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-zinc-300 text-zinc-700 font-medium text-sm hover:bg-zinc-50"
          >
            Sign in
          </Link>
        </div>
        <p className="text-xs text-zinc-500 mt-4">
          90 days free · No credit card · Cancel anytime · Cloud-hosted, BIR CAS-aligned
        </p>
      </div>
    </section>
  );
}

function VideoSection() {
  return (
    <section className="px-6 py-16 bg-white">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 text-center mb-2">
          See your quarterly BIR filing in under 90 seconds
        </h2>
        <p className="text-center text-zinc-600 mb-8 text-sm">
          From "where are my receipts?" to "2550Q.xlsx downloaded" — the entire flow.
        </p>
        <div
          className="aspect-video rounded-xl overflow-hidden border border-zinc-200 shadow-sm flex items-center justify-center"
          style={{ background: ACCENT_SOFT }}
        >
          {VIDEO_URL ? (
            <iframe
              src={VIDEO_URL}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title="Clerque Books — BIR Filing Demo"
            />
          ) : (
            <div className="text-center p-8">
              <div
                className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4"
                style={{ background: ACCENT, color: 'white' }}
              >
                <FileText className="h-8 w-8" />
              </div>
              <p className="text-sm text-zinc-600 font-medium">Demo video coming soon</p>
              <p className="text-xs text-zinc-500 mt-1">Or jump straight to the trial and we'll walk you through it live.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function WhoItsFor() {
  const audiences = [
    {
      icon: Briefcase,
      title: 'Service businesses',
      body: 'Consultancies, agencies, salons, lawyers, IT shops, dental clinics. No inventory? You don\'t need a POS — you need clean books.',
    },
    {
      icon: Users,
      title: 'Accounting firms & bookkeepers',
      body: 'Manage 10 to 50 SME clients from one platform. Each client gets their own books; you bill them; we bill you.',
    },
    {
      icon: Building2,
      title: 'Sole props filing 1701Q / 2551Q',
      body: 'Track income, expenses, withholding tax in one place. Quarterly returns generated automatically.',
    },
  ];
  return (
    <section className="px-6 py-16" style={{ background: ACCENT_SOFT }}>
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 text-center mb-2">
          Built for the three jobs accountants actually do
        </h2>
        <p className="text-center text-zinc-600 mb-10 text-sm">
          Pick the path that matches your work. Same product, different defaults.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {audiences.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-white rounded-xl p-6 border border-zinc-200">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                style={{ background: ACCENT, color: 'white' }}
              >
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-zinc-900 mb-2">{title}</h3>
              <p className="text-sm text-zinc-600 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    { icon: Receipt,     title: 'AR Invoicing',          body: 'Quote → Invoice → Payment, with WHT auto-calc and email-ready PDF.' },
    { icon: FileText,    title: 'AP Bills & Expenses',   body: 'Type the bill, attach the PDF, post to GL. Pay later, batched.' },
    { icon: TrendingUp,  title: 'Real Financials',       body: 'Trial Balance, P&L, Balance Sheet, Cash Flow — live, every minute.' },
    { icon: ShieldCheck, title: 'BIR-ready Forms',       body: '2550Q, 1701Q, 2551Q, 2316 — downloadable as Excel.' },
    { icon: Clock,       title: 'Quarterly Close',       body: 'Lock periods, reopen with audit reason, year-end closing entry in one click.' },
    { icon: BookOpen,    title: 'PFRS-for-SMEs aligned', body: 'Double-entry, period locks, SOD enforcement at the service layer.' },
  ];
  return (
    <section className="px-6 py-16 bg-white">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 text-center mb-10">
          Everything a Philippine accountant expects, nothing more
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="border border-zinc-200 rounded-lg p-5">
              <div className="flex items-start gap-3">
                <Icon className="h-5 w-5 mt-0.5 shrink-0" style={{ color: ACCENT }} />
                <div>
                  <h3 className="font-semibold text-zinc-900 text-sm mb-1">{title}</h3>
                  <p className="text-sm text-zinc-600 leading-relaxed">{body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const tiers = [
    { name: 'Solo',     price: '₱199', subtitle: 'Sole prop · 1 user',     features: ['AR invoicing', 'Expense tracking', '1701Q + 2551Q', 'Email support'] },
    { name: 'Duo',      price: '₱499', subtitle: 'Service business · 3 users', features: ['Everything in Solo', 'AP bills + WHT', 'AR aging + customer statements', '2550Q (VAT)', 'BIR forms export'], recommended: true },
    { name: 'Team',     price: '₱999', subtitle: 'Growing firm · 10 users', features: ['Everything in Duo', 'Audit log', 'Bank reconciliation', 'Multiple branches', 'Phone + chat support'] },
  ];
  return (
    <section className="px-6 py-16" style={{ background: ACCENT_SOFT }}>
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 text-center mb-2">
          Honest pricing, all in pesos
        </h2>
        <p className="text-center text-zinc-600 mb-10 text-sm">
          90 days free on any tier. No setup fees. No per-invoice fees. Cancel anytime.
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
                <span className="text-3xl font-bold text-zinc-900">{t.price}</span>
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
                href="/signup/ledger"
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
        <p className="text-xs text-zinc-500 text-center mt-8">
          Need more than 10 users, multi-branch, or custom workflows? See <Link href="/welcome/ledger#enterprise" className="underline">enterprise plans</Link>.
        </p>
      </div>
    </section>
  );
}

function FAQ() {
  const faqs = [
    {
      q: 'I already have a POS. Why would I add Clerque Books?',
      a: 'You don\'t have to — Clerque also bundles POS + Ledger in our Pair and Suite plans. But if your POS already works (e.g., Loyverse, Square), and you just want better accounting + BIR filing, Books-only is for you.',
    },
    {
      q: 'Will my CPA accept it?',
      a: 'Yes. Clerque Books generates standard PFRS-for-SMEs financial statements (Trial Balance, P&L, Balance Sheet, Cash Flow) plus BIR forms (2550Q, 1701Q, 2551Q, 2316) as Excel. Most CPAs prefer this over wrangling shoebox receipts.',
    },
    {
      q: 'What about migrating from QuickBooks or Xero?',
      a: 'You can import opening balances via a one-time Journal Entry. Detailed history import is on the roadmap — contact us during your trial.',
    },
    {
      q: 'Is my data safe?',
      a: 'Nightly off-box backups to Cloudflare R2 (separate cloud account from your data). Per-tenant data isolation. SOD-enforced access controls. We\'re registered with the National Privacy Commission and aligned to RA 10173.',
    },
    {
      q: 'Can I export everything if I leave?',
      a: 'Yes. One-click "Download My Data" exports your full database as JSON + every financial report as Excel. No lock-in.',
    },
  ];
  return (
    <section className="px-6 py-16 bg-white">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 text-center mb-10">
          Frequently asked
        </h2>
        <div className="space-y-6">
          {faqs.map(({ q, a }) => (
            <div key={q}>
              <h3 className="font-semibold text-zinc-900 mb-2">{q}</h3>
              <p className="text-sm text-zinc-600 leading-relaxed">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="px-6 py-20 text-center" style={{ background: ACCENT, color: 'white' }}>
      <div className="max-w-2xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">
          Try Clerque Books free for 90 days
        </h2>
        <p className="text-lg opacity-90 mb-8">
          Get through one full BIR quarter on us. If you don't save more time than you spent, walk away — no card on file.
        </p>
        <Link
          href="/signup/ledger"
          className="inline-flex items-center gap-2 bg-white px-8 py-3 rounded-lg font-semibold text-sm hover:bg-zinc-100"
          style={{ color: ACCENT }}
        >
          Start free trial <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="px-6 py-10 bg-zinc-900 text-zinc-400 text-sm">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <div className="text-white font-semibold">Clerque Books</div>
          <div className="text-xs">Part of the Clerque suite · Built in Manila for Philippine SMEs</div>
        </div>
        <div className="flex gap-5 text-xs">
          <Link href="/legal/terms" className="hover:text-white">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-white">Privacy</Link>
          <Link href="/login" className="hover:text-white">Sign in</Link>
        </div>
      </div>
    </footer>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────

export default function LedgerLandingPage() {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <Hero />
      <VideoSection />
      <WhoItsFor />
      <Features />
      <Pricing />
      <FAQ />
      <CTA />
      <Footer />
    </main>
  );
}
