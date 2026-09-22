/**
 * The public welcome page, shared by /welcome/pos and /welcome/ledger.
 *
 * What it says, and why it is one component:
 *   Clerque is sold as ONE thing — the full suite (Counter, Procure, Ledger)
 *   with a bookkeeper included, for small businesses that do not have one.
 *   The two pages used to sell two different products with two different price
 *   lists, long after those plans were gone, and one of them printed a literal
 *   "—" and "Pricing coming soon".
 *
 * Rules for anyone editing this:
 *   - NO PRICE, anywhere. The price is not public. The call to action is
 *     "Talk to us", a mailto to the one support mailbox.
 *   - No promises the product does not keep today. Every line here describes
 *     something a shop can already do.
 *
 * Server component: no 'use client', no state.
 */
import Link from 'next/link';
import {
  ArrowRight, BookOpen, CheckCircle2, Mail, ShoppingBasket, ShoppingCart, UserCheck,
} from 'lucide-react';
import { SUPPORT_EMAIL, supportMailto } from '@/lib/support';

const ACCENT      = '#8B5E3C';
const ACCENT_SOFT = '#EEE9DF';

/** Which door the visitor came through. Only the hero wording changes. */
export type WelcomeFocus = 'counter' | 'books';

const HERO: Record<WelcomeFocus, { badge: string; headline: [string, string]; signInHref: string }> = {
  counter: {
    badge:      'Clerque · POS, stock and books in one',
    headline:   ['Run the shop.', 'We keep the books.'],
    signInHref: '/login',
  },
  books: {
    badge:      'Clerque · Books that keep themselves',
    headline:   ['No bookkeeper yet?', 'Clerque comes with one.'],
    signInHref: '/login?app=ledger',
  },
};

const TALK_SUBJECT = 'I would like to know more about Clerque';

function TalkToUsButton({ inverted = false }: { inverted?: boolean }) {
  return (
    <a
      href={supportMailto(TALK_SUBJECT)}
      className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity"
      style={inverted ? { background: 'white', color: ACCENT } : { background: ACCENT, color: 'white' }}
    >
      <Mail className="h-4 w-4" /> Talk to us <ArrowRight className="h-4 w-4" />
    </a>
  );
}

function Hero({ focus }: { focus: WelcomeFocus }) {
  const h = HERO[focus];
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
          {h.badge}
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-zinc-900 leading-tight mb-5">
          {h.headline[0]}
          <br /><span style={{ color: ACCENT }}>{h.headline[1]}</span>
        </h1>
        <p className="text-lg text-zinc-600 max-w-2xl mx-auto mb-8 leading-relaxed">
          Clerque is one system for a small business: a POS for the counter, Procure for stock
          and buying, and Ledger for the books, with a bookkeeper included. It is made for
          owners who do not have a bookkeeper yet.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <TalkToUsButton />
          <Link
            href={h.signInHref}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-zinc-300 text-zinc-700 font-medium text-sm hover:bg-zinc-50"
          >
            Sign in
          </Link>
        </div>
        <p className="text-xs text-zinc-500 mt-4">
          Tell us about your shop and we will reply by email.
        </p>
      </div>
    </section>
  );
}

function WhatYouGet() {
  const parts = [
    {
      icon: ShoppingCart,
      title: 'Counter, your POS',
      body: 'Take orders and payments in the browser: cash, GCash, Maya or card. Senior and PWD discounts, printed receipts, and kitchen and bar screens on ordinary Android tablets.',
    },
    {
      icon: ShoppingBasket,
      title: 'Procure, your stock and buying',
      body: 'Know what is left. The buy list fills itself from what is running low, deliveries are received against it, and staff count the shelf on a tablet.',
    },
    {
      icon: BookOpen,
      title: 'Ledger, your books',
      body: 'Sales, purchases and expenses go into your books by themselves. See your profit, your cash and what you owe at any time.',
    },
    {
      icon: UserCheck,
      title: 'A bookkeeper, included',
      body: 'A bookkeeper is part of the service. Someone looks after your books with you, so you do not have to hire one or learn accounting first.',
    },
  ];
  return (
    <section className="px-6 py-16 bg-white">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 text-center mb-2">
          The full suite, not pieces
        </h2>
        <p className="text-center text-zinc-600 mb-10 text-sm">
          Everything below comes together. There is nothing extra to add on later.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {parts.map((p) => (
            <div key={p.title} className="rounded-xl border border-zinc-200 p-6">
              <div
                className="inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3"
                style={{ background: ACCENT_SOFT, color: ACCENT }}
              >
                <p.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-zinc-900 mb-2">{p.title}</h3>
              <p className="text-sm text-zinc-600 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhoItIsFor() {
  const points = [
    'You run a café, food stall, bakery, small shop or service business',
    'You do not have a bookkeeper, or your books are a notebook and a folder of receipts',
    'Your staff send you photos and messages all day about sales, stock and what to buy',
    'You want to see how the business is doing without sitting at the counter',
  ];
  return (
    <section className="px-6 py-16" style={{ background: ACCENT_SOFT }}>
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 text-center mb-8">
          Who Clerque is for
        </h2>
        <ul className="bg-white rounded-xl border border-zinc-200 p-6 sm:p-8 space-y-3">
          {points.map((p) => (
            <li key={p} className="text-sm text-zinc-700 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: ACCENT }} />
              {p}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Questions() {
  const faqs = [
    {
      q: 'Do I need to buy special equipment?',
      a: 'No. Clerque runs in the browser on a laptop, tablet or phone. Kitchen and bar screens run on ordinary Android tablets, and receipts print on a Bluetooth or USB receipt printer.',
    },
    {
      q: 'I already have an accountant. Can they use it?',
      a: 'Yes. They can have their own sign-in to your Ledger and work from the same books. Tell us when you write and we will set it up.',
    },
    {
      q: 'Can I get my records out if I leave?',
      a: 'Yes. The owner can download every record as an Excel file from Settings at any time.',
    },
    {
      q: 'How much does it cost?',
      a: 'It depends on your business, so we do not post a price list. Tell us about your shop and we will give you a clear answer by email.',
    },
  ];
  return (
    <section className="px-6 py-16 bg-white">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 text-center mb-10">
          Common questions
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

function TalkToUs() {
  return (
    <section className="px-6 py-20 text-center" style={{ background: ACCENT, color: 'white' }}>
      <div className="max-w-2xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">Talk to us</h2>
        <p className="text-lg opacity-90 mb-8">
          Tell us what you sell, how many people work with you, and how you keep your books
          today. We will show you Clerque and set it up with you.
        </p>
        <TalkToUsButton inverted />
        <p className="text-sm opacity-90 mt-5">
          Or write to{' '}
          <a href={supportMailto(TALK_SUBJECT)} className="underline font-medium">{SUPPORT_EMAIL}</a>
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="px-6 py-10 bg-zinc-900 text-zinc-400 text-sm">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <div className="text-white font-semibold">Clerque</div>
          <div className="text-xs">POS, Procure and Ledger for Philippine small businesses</div>
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

export function SuiteWelcome({ focus }: { focus: WelcomeFocus }) {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <Hero focus={focus} />
      <WhatYouGet />
      <WhoItIsFor />
      <Questions />
      <TalkToUs />
      <Footer />
    </main>
  );
}
