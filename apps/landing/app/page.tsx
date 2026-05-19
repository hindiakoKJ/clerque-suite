'use client';

import { motion, useInView } from 'framer-motion';
import {
  Terminal,
  MoveUpRight,
  Shield,
  Cloud,
  Smartphone,
  WifiOff,
  PhoneCall,
  ArrowRight,
  Globe,
  Mail,
  Menu,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRef, useState, useEffect } from 'react';
import { EcosystemHero, BrandSheet } from '@/components/brand';

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09 } },
};

// ---------------------------------------------------------------------------
// Navbar
// ---------------------------------------------------------------------------

const NAV_LINKS = ['About', 'Ecosystem', 'Compliance'];

function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-white/8 bg-[#020817]/80 backdrop-blur-md'
          : 'bg-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Image src="/logos/hns-icon.png" width={32} height={32} alt="HNScorpPH" className="rounded-lg" />
          <span className="text-sm font-semibold tracking-tight text-white">HNScorpPH</span>
        </div>

        {/* Desktop links */}
        <div className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((label) => (
            <a
              key={label}
              href={`#${label.toLowerCase()}`}
              className="text-sm font-medium text-white/60 transition-colors hover:text-white"
            >
              {label}
            </a>
          ))}
        </div>

        {/* Desktop CTA */}
        <Link
          href="https://clerque.hnscorpph.com/login"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden items-center gap-2 rounded-lg bg-hns-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-hns-500 md:flex"
        >
          <Terminal className="h-3.5 w-3.5" />
          Launch Clerque
        </Link>

        {/* Mobile hamburger */}
        <button
          className="flex items-center justify-center rounded-lg p-2 text-white/70 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {/* Mobile drawer */}
      {open && (
        <div className="border-t border-white/8 bg-[#020817]/95 px-6 pb-5 pt-2 md:hidden">
          <div className="flex flex-col gap-3">
            {NAV_LINKS.map((label) => (
              <a
                key={label}
                href={`#${label.toLowerCase()}`}
                onClick={() => setOpen(false)}
                className="py-1.5 text-sm font-medium text-white/60 transition-colors hover:text-white"
              >
                {label}
              </a>
            ))}
            <Link
              href="https://clerque.hnscorpph.com/login"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex items-center gap-2 rounded-lg bg-hns-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              <Terminal className="h-3.5 w-3.5" />
              Launch Clerque
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Hero — dark section
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section
      id="about"
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pb-20 pt-28 text-center"
      style={{ background: '#020817' }}
    >
      {/* Cyan radial glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: '520px',
          background:
            'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(8,145,178,0.28) 0%, transparent 70%)',
        }}
      />

      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      <motion.div
        className="relative z-10 mx-auto max-w-4xl"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        {/* Badge */}
        <motion.div variants={fadeUp} className="mb-8 inline-flex">
          <span className="flex items-center gap-2 rounded-full border border-hns-600/30 bg-hns-600/10 px-4 py-1.5 text-sm font-medium text-hns-400">
            🇵🇭 Built for Philippine MSMEs
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          variants={fadeUp}
          className="mb-6 text-5xl font-bold leading-[1.08] tracking-wordmark-tight text-white md:text-7xl"
        >
          Digital Sovereignty
          <br />
          <span className="text-hns-400">for the Filipino MSME.</span>
        </motion.h1>

        {/* Sub-headline */}
        <motion.p
          variants={fadeUp}
          className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-white/50 md:text-xl"
        >
          HNScorpPH provides the high-tech infrastructure local businesses need
          to compete in the digital economy — POS, payroll, ledger, and more.
        </motion.p>

        {/* CTAs */}
        <motion.div
          variants={fadeUp}
          className="flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Link
            href="https://clerque.hnscorpph.com/login"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl bg-hns-600 px-8 py-3.5 text-sm font-semibold text-white shadow-[0_4px_24px_rgba(8,145,178,0.4)] transition-all hover:bg-hns-500 hover:scale-[1.02]"
          >
            Login to Clerque
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="mailto:hnscorpph@gmail.com?subject=Partnership%20Inquiry"
            className="flex items-center gap-2 rounded-xl border border-white/15 px-8 py-3.5 text-sm font-semibold text-white/70 transition-all hover:border-white/30 hover:text-white"
          >
            <Mail className="h-4 w-4" />
            Partner with HNScorp
          </a>
        </motion.div>

        {/* Trust strip */}
        <motion.div
          variants={fadeUp}
          className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3"
        >
          {[
            'BIR CAS-Ready',
            'GCash & Maya',
            'Offline-First',
            'SEC Registered (OPC)',
          ].map((item) => (
            <span
              key={item}
              className="flex items-center gap-2 text-xs font-medium text-white/35"
            >
              <span className="h-1 w-1 rounded-full bg-hns-500" />
              {item}
            </span>
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Compliance Ticker
// ---------------------------------------------------------------------------

const TICKER_TEXT =
  'BIR CAS-Ready  •  GCash & Maya Integrated  •  100% Local Support  •  SEC Registered (OPC)  •  99.9% Uptime SLA  •  Offline-First PWA  •  Powered by HNScorpPH  •  ';

function ComplianceTicker() {
  const doubled = TICKER_TEXT + TICKER_TEXT;
  return (
    <div
      id="compliance"
      className="relative overflow-hidden border-y border-hns-100 bg-hns-50 py-3"
    >
      <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-20 bg-gradient-to-r from-hns-50 to-transparent" />
      <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-20 bg-gradient-to-l from-hns-50 to-transparent" />
      <div className="flex animate-ticker whitespace-nowrap text-xs font-medium tracking-[0.06em] text-hns-700">
        {doubled}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ecosystem Section
// ---------------------------------------------------------------------------

function EcosystemCard({
  children,
  className = '',
  featured = false,
}: {
  children: React.ReactNode;
  className?: string;
  featured?: boolean;
}) {
  return (
    <motion.div
      variants={fadeUp}
      className={`rounded-2xl border bg-paper p-6 transition-all duration-300 hover:shadow-md ${
        featured
          ? 'border-hns-200 shadow-[0_2px_16px_rgba(8,145,178,0.10)]'
          : 'border-ink/8 shadow-[0_1px_4px_rgba(15,23,42,0.04)]'
      } ${className}`}
    >
      {children}
    </motion.div>
  );
}

function EcosystemSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  const cards = [
    { icon: Shield, title: 'BIR Compliance', desc: 'CAS-Ready, 2550Q, EIS e-invoicing built in. Stay compliant without the headache.' },
    { icon: Cloud, title: 'Cloud Infrastructure', desc: 'Railway + Vercel. Asia-Pacific region. 99.9% uptime backed by enterprise SLA.' },
    { icon: Smartphone, title: 'Mobile-Native PWA', desc: 'Works on any device. Install to homescreen. No app store needed.' },
    { icon: WifiOff, title: 'Offline Mode', desc: 'Sells even without internet. Auto-syncs when back online — zero data loss.' },
  ];

  return (
    <section id="ecosystem" className="bg-paper py-24 px-6 md:px-12" ref={ref}>
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
          variants={stagger}
          className="mb-14 text-center"
        >
          <motion.p variants={fadeUp} className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-hns-600">
            Products
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-4xl font-bold tracking-wordmark-tight text-ink md:text-5xl">
            The Clerque Ecosystem
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-3 text-lg text-ink/50">
            Every tool a Filipino business owner needs, unified.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
          variants={stagger}
          className="grid grid-cols-1 gap-4 md:grid-cols-3"
        >
          {/* Clerque — featured */}
          <EcosystemCard featured className="relative overflow-hidden md:col-span-2">
            <div className="mb-4 flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl overflow-hidden">
                <Image src="/logos/clerque-icon.png" width={40} height={40} alt="Clerque" className="rounded-xl" />
              </div>
              <span className="rounded-full border border-hns-200 bg-hns-50 px-3 py-0.5 text-xs font-semibold text-hns-700">
                Flagship
              </span>
            </div>
            <h3 className="mb-2 text-2xl font-bold tracking-tight text-ink">Clerque Suite</h3>
            <p className="mb-5 text-sm leading-relaxed text-ink/55">
              The all-in-one business platform for Philippine MSMEs. Manage your point of sale,
              process payroll, and keep your books — all from a single, beautifully designed interface.
            </p>
            <div className="mb-6 flex flex-wrap gap-2">
              {['POS', 'Payroll', 'Accounting', 'BIR'].map((tag) => (
                <span key={tag} className="rounded-full border border-clerque-200 bg-clerque-50 px-3 py-1 text-xs font-medium text-clerque-700">
                  {tag}
                </span>
              ))}
            </div>
            <Link
              href="https://clerque.hnscorpph.com/login"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-clerque-600 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-clerque-700 hover:scale-[1.02]"
            >
              Visit App
              <MoveUpRight className="h-4 w-4" />
            </Link>
          </EcosystemCard>

          {/* Steady */}
          <EcosystemCard>
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl overflow-hidden">
              <Image src="/logos/steady-icon.png" width={40} height={40} alt="Steady" className="rounded-xl" />
            </div>
            <h3 className="mb-1.5 text-lg font-bold tracking-tight text-ink">Steady</h3>
            <p className="mb-4 text-sm leading-relaxed text-ink/55">
              A calm, empathetic health companion for seizure tracking. Safety and peace of mind, always on hand.
            </p>
            <span className="rounded-full border border-steady-200 bg-steady-50 px-3 py-1 text-xs font-medium text-steady-700">
              Health Companion
            </span>
          </EcosystemCard>

          {/* Feature cards */}
          {cards.map(({ icon: Icon, title, desc }) => (
            <EcosystemCard key={title}>
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-hns-100 bg-hns-600/8">
                <Icon className="h-5 w-5 text-hns-600" />
              </div>
              <h3 className="mb-1.5 text-base font-bold tracking-tight text-ink">{title}</h3>
              <p className="text-sm leading-relaxed text-ink/55">{desc}</p>
            </EcosystemCard>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Why Clerque — feature section
// ---------------------------------------------------------------------------

function WorkflowSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  const features = [
    {
      icon: Globe,
      title: 'GCash & Maya Ready',
      desc: 'Accept digital payments natively. No third-party plugins needed. Instant settlement built in.',
    },
    {
      icon: WifiOff,
      title: 'Offline-First Architecture',
      desc: "Patchy internet? No problem. Clerque queues transactions and syncs automatically when you're back online.",
    },
    {
      icon: PhoneCall,
      title: 'Local Support, Always',
      desc: 'Filipino support team. Same timezone. Real humans who understand your business and speak your language.',
    },
  ];

  return (
    <section className="bg-sand py-24 px-6 md:px-12" ref={ref}>
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
          variants={stagger}
          className="mb-16 text-center"
        >
          <motion.p variants={fadeUp} className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-hns-600">
            Why Clerque
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-4xl font-bold tracking-wordmark-tight text-ink md:text-5xl">
            Built for the Filipino Workflow
          </motion.h2>
        </motion.div>

        <motion.div
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
          variants={stagger}
          className="grid grid-cols-1 gap-5 md:grid-cols-3"
        >
          {features.map(({ icon: Icon, title, desc }) => (
            <motion.div
              key={title}
              variants={fadeUp}
              className="group rounded-2xl border border-ink/8 bg-paper p-8 shadow-[0_1px_4px_rgba(15,23,42,0.04)] transition-all duration-300 hover:border-hns-200 hover:shadow-[0_4px_20px_rgba(8,145,178,0.08)]"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-hns-100 bg-hns-50 transition-all duration-300 group-hover:bg-hns-100">
                <Icon className="h-6 w-6 text-hns-600" />
              </div>
              <h3 className="mb-3 text-xl font-bold tracking-tight text-ink">{title}</h3>
              <p className="text-sm leading-relaxed text-ink/55">{desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Roadmap Section
// ---------------------------------------------------------------------------

const ROADMAP = [
  {
    phase: 'Now',
    label: 'Live',
    items: [
      {
        name: 'HNScorpPH',
        desc: 'Company incorporated as a One Person Corporation in the Philippines. Platform infrastructure and design system established.',
        status: 'done' as const,
      },
      {
        name: 'Clerque',
        desc: 'Flagship business suite live — POS, payroll, BIR-compliant accounting, and GCash & Maya payments for Filipino MSMEs.',
        status: 'done' as const,
      },
      {
        name: 'Steady',
        desc: 'Free health companion live — seizure logging, trigger tracking, and caregiver alerts for people living with epilepsy.',
        status: 'done' as const,
      },
    ],
  },
  {
    phase: 'Building',
    label: 'In Progress',
    items: [
      {
        name: 'Clerque v2',
        desc: 'Major update in development — expanded inventory management, multi-branch support, and advanced BIR EIS e-invoicing.',
        status: 'in-progress' as const,
      },
      {
        name: 'Steady v2',
        desc: 'Caregiver dashboard, medication reminders, and seizure pattern reports — giving families a fuller picture.',
        status: 'in-progress' as const,
      },
    ],
  },
  {
    phase: 'Next',
    label: 'Planned',
    items: [
      {
        name: 'Product 3',
        desc: 'Third HNScorpPH product currently under research. Targeting an underserved segment of the Philippine market.',
        status: 'planned' as const,
      },
      {
        name: 'Product 4',
        desc: 'Long-term pipeline. The architecture is ready — the product will follow once the problem is fully understood.',
        status: 'planned' as const,
      },
    ],
  },
];

const STATUS_STYLES = {
  done: { dot: 'bg-emerald-500', label: 'Live', text: 'text-emerald-700' },
  'in-progress': { dot: 'bg-amber-400', label: 'In Progress', text: 'text-amber-700' },
  planned: { dot: 'bg-ink/20', label: 'Planned', text: 'text-ink/40' },
};

function RoadmapSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section ref={ref} className="bg-paper px-8 py-20 md:px-14 md:py-24">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
          variants={stagger}
        >
          <motion.p variants={fadeUp} className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink/40">
            What We&apos;re Building · The HNScorpPH Roadmap
          </motion.p>
          <motion.h2 variants={fadeUp} className="mt-3 max-w-2xl text-3xl font-semibold leading-tight tracking-wordmark-tight text-ink md:text-4xl">
            One product at a time.{' '}
            <span className="text-ink/45">Each one solving a real Filipino problem.</span>
          </motion.h2>
        </motion.div>

        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {ROADMAP.map((phase, pi) => (
            <motion.div
              key={phase.phase}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.15 + pi * 0.1, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="mb-4 flex items-center gap-2">
                <span className="text-2xl font-bold tracking-tight text-ink">{phase.phase}</span>
                <span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink/40">
                  {phase.label}
                </span>
              </div>
              <div className="flex flex-col gap-4">
                {phase.items.map((item) => {
                  const s = STATUS_STYLES[item.status];
                  return (
                    <div
                      key={item.name}
                      className="rounded-xl border border-ink/8 bg-paper p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink">{item.name}</span>
                        <span className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${s.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                          {s.label}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-ink/50">{item.desc}</p>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA Banner — dark section
// ---------------------------------------------------------------------------

function CTABanner() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section
      ref={ref}
      className="relative overflow-hidden py-28 px-6"
      style={{ background: '#020817' }}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2"
        style={{
          width: '600px',
          height: '300px',
          background: 'radial-gradient(ellipse at 50% 0%, rgba(8,145,178,0.18) 0%, transparent 70%)',
        }}
      />

      <motion.div
        initial="hidden"
        animate={inView ? 'visible' : 'hidden'}
        variants={stagger}
        className="relative z-10 mx-auto max-w-3xl text-center"
      >
        <motion.div variants={fadeUp} className="mb-6 inline-flex">
          <span className="rounded-full border border-hns-600/30 bg-hns-600/10 px-4 py-1.5 text-xs font-semibold text-hns-400">
            Get Started Today
          </span>
        </motion.div>

        <motion.h2 variants={fadeUp} className="mb-5 text-4xl font-bold tracking-wordmark-tight text-white md:text-6xl">
          Ready to digitize
          <br />
          your business?
        </motion.h2>

        <motion.p variants={fadeUp} className="mb-10 text-lg text-white/50">
          Join hundreds of Filipino MSMEs already running on Clerque.
        </motion.p>

        <motion.div
          variants={fadeUp}
          className="flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Link
            href="https://clerque.hnscorpph.com/login"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl bg-hns-600 px-8 py-4 text-sm font-semibold text-white shadow-[0_4px_20px_rgba(8,145,178,0.4)] transition-all hover:bg-hns-500 hover:scale-[1.02]"
          >
            Start with Clerque
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="mailto:hnscorpph@gmail.com?subject=Sales%20Inquiry"
            className="flex items-center gap-2 rounded-xl border border-white/15 px-8 py-4 text-sm font-semibold text-white/70 transition-all hover:border-white/30 hover:text-white"
          >
            <Mail className="h-4 w-4" />
            Contact Sales
          </a>
        </motion.div>
      </motion.div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer() {
  return (
    <footer className="border-t border-ink/8 bg-paper py-10 px-6 md:px-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 text-sm text-ink/40 md:flex-row">
        <div className="flex items-center gap-2.5">
          <Image src="/logos/hns-icon.png" width={28} height={28} alt="HNScorpPH" className="rounded-md" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-ink">HNScorpPH</span>
            <span className="text-[10px]">Powering Philippine MSMEs since 2024.</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <Link
            href="https://clerque.hnscorpph.com/login"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-ink"
          >
            Clerque
          </Link>
          <a href="#" className="transition-colors hover:text-ink">Privacy</a>
          <a href="#" className="transition-colors hover:text-ink">Terms</a>
        </div>

        <div className="text-xs">© 2026 HNScorpPH OPC. All rights reserved.</div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Page() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <ComplianceTicker />
        <EcosystemSection />
        <WorkflowSection />

        {/* Brand identity */}
        <EcosystemHero />

        <RoadmapSection />

        <BrandSheet />
        <CTABanner />
      </main>
      <Footer />
    </>
  );
}
