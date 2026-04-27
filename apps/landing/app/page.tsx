'use client';

import { motion, useInView, useMotionValue, useSpring, animate } from 'framer-motion';
import {
  Terminal,
  Zap,
  MoveUpRight,
  Shield,
  Cloud,
  Smartphone,
  WifiOff,
  PhoneCall,
  BarChart3,
  CheckCircle2,
  ArrowRight,
  Globe,
  Lock,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useRef, useEffect, useState } from 'react';
import { EcosystemHero, BrandSheet, EndorsementLockup } from '@/components/brand';
import { ClerqueLogo, SteadyLogo } from '@/components/brand/logos';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useCountUp(target: number, inView: boolean, decimals = 0) {
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, { stiffness: 60, damping: 20 });
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    if (inView) {
      motionVal.set(target);
    }
  }, [inView, target, motionVal]);

  useEffect(() => {
    const unsub = spring.on('change', (v) => {
      setDisplay(
        decimals > 0
          ? v.toFixed(decimals)
          : Math.round(v).toLocaleString()
      );
    });
    return unsub;
  }, [spring, decimals]);

  return display;
}

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6 } },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

// ---------------------------------------------------------------------------
// Navbar
// ---------------------------------------------------------------------------

function Navbar() {
  const [tooltip, setTooltip] = useState(false);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4"
      style={{
        background: 'rgba(1,1,1,0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(0,209,255,0.10)',
      }}
    >
      {/* Logo */}
      <div className="flex flex-col leading-tight">
        <span className="text-white font-bold text-lg tracking-tight">HNScorpPH</span>
        <span className="text-[10px] font-medium" style={{ color: '#00d1ff' }}>
          by HNScorpPH
        </span>
      </div>

      {/* Nav links — hidden on mobile */}
      <div className="hidden md:flex items-center gap-8">
        {['About', 'Ecosystem', 'Compliance'].map((label) => (
          <a
            key={label}
            href={`#${label.toLowerCase()}`}
            className="text-sm text-slate-400 hover:text-white transition-colors duration-200"
          >
            {label}
          </a>
        ))}
      </div>

      {/* Launch button */}
      <div className="relative flex items-center">
        <Link
          href="https://clerque.hnscorpph.com/login"
          target="_blank"
          rel="noopener noreferrer"
          onMouseEnter={() => setTooltip(true)}
          onMouseLeave={() => setTooltip(false)}
          className="relative flex items-center justify-center w-10 h-10 rounded-full glass glass-hover cursor-pointer"
          style={{
            boxShadow: '0 0 0 0 rgba(0,209,255,0.4)',
            animation: 'none',
          }}
        >
          <Terminal className="w-4 h-4" style={{ color: '#00d1ff' }} />
          {/* Pulse ring */}
          <span
            className="absolute inset-0 rounded-full"
            style={{
              border: '1px solid rgba(0,209,255,0.5)',
              animation: 'pulse-ring 1.5s ease-out infinite',
            }}
          />
        </Link>
        {tooltip && (
          <div
            className="absolute right-0 top-12 text-xs px-3 py-1.5 rounded-lg whitespace-nowrap"
            style={{
              background: 'rgba(0,209,255,0.12)',
              border: '1px solid rgba(0,209,255,0.25)',
              color: '#00d1ff',
            }}
          >
            Launch Clerque POS
          </div>
        )}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Hero Dashboard Card
// ---------------------------------------------------------------------------

function DashboardCard() {
  const bars = [40, 65, 50, 80, 70, 90];

  return (
    <div
      className="animate-float mx-auto mt-16 rounded-2xl p-5 w-full max-w-sm"
      style={{
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(0,209,255,0.18)',
        boxShadow: '0 0 40px rgba(0,209,255,0.1), 0 20px 60px rgba(0,0,0,0.5)',
      }}
    >
      {/* Card header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-white font-semibold text-sm">Clerque Suite</span>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
          </span>
          <span className="text-green-400 text-xs font-medium">Live</span>
        </div>
      </div>

      {/* Metrics */}
      <div className="space-y-2 mb-4">
        <div className="flex justify-between items-center py-1.5 px-3 rounded-lg" style={{ background: 'rgba(0,209,255,0.05)' }}>
          <span className="text-slate-400 text-xs">Today&apos;s Sales</span>
          <span className="text-white text-xs font-semibold">₱12,847</span>
        </div>
        <div className="flex justify-between items-center py-1.5 px-3 rounded-lg" style={{ background: 'rgba(0,209,255,0.05)' }}>
          <span className="text-slate-400 text-xs">Active Shifts</span>
          <span className="text-white text-xs font-semibold">3</span>
        </div>
        <div className="flex justify-between items-center py-1.5 px-3 rounded-lg" style={{ background: 'rgba(0,209,255,0.05)' }}>
          <span className="text-slate-400 text-xs">Pending Sync</span>
          <span className="text-green-400 text-xs font-semibold">0</span>
        </div>
      </div>

      {/* Mini bar chart */}
      <div className="flex items-end gap-1 h-10 mb-4">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{
              height: `${h}%`,
              background: `rgba(0,209,255,${0.4 + i * 0.08})`,
            }}
          />
        ))}
      </div>

      {/* Footer */}
      <div
        className="text-center text-[10px] pt-3"
        style={{
          borderTop: '1px solid rgba(0,209,255,0.1)',
          color: 'rgba(0,209,255,0.5)',
        }}
      >
        Powered by HNScorpPH Infrastructure
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero Section
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section
      id="about"
      className="relative min-h-screen network-bg flex flex-col items-center justify-center text-center px-6 pt-24 pb-16"
    >
      {/* Radial glow */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{
          width: '600px',
          height: '600px',
          background: 'radial-gradient(circle, rgba(0,209,255,0.06) 0%, transparent 70%)',
        }}
      />

      <motion.div
        className="relative z-10 max-w-4xl mx-auto"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        {/* Badge */}
        <motion.div variants={fadeUp} className="inline-flex mb-6">
          <span
            className="text-sm font-medium px-4 py-1.5 rounded-full"
            style={{
              background: 'rgba(0,209,255,0.08)',
              border: '1px solid rgba(0,209,255,0.2)',
              color: '#00d1ff',
            }}
          >
            🇵🇭 Built for Philippine MSMEs
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          variants={fadeUp}
          className="text-5xl md:text-7xl font-black leading-tight mb-6"
        >
          <span className="text-white block">Digital Sovereignty</span>
          <span
            className="block"
            style={{
              background: 'linear-gradient(135deg, #00d1ff 0%, #0057b7 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            for the Filipino MSME.
          </span>
        </motion.h1>

        {/* Sub-headline */}
        <motion.p
          variants={fadeUp}
          className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          HNScorpPH provides the high-tech infrastructure local businesses need
          to compete in the digital economy.
        </motion.p>

        {/* CTAs */}
        <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-4">
          <Link
            href="https://clerque.hnscorpph.com/login"
            target="_blank"
            rel="noopener noreferrer"
            className="relative overflow-hidden flex items-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-black text-sm transition-all duration-200 hover:scale-105"
            style={{ background: '#00d1ff' }}
          >
            <span
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
                backgroundSize: '200% auto',
                animation: 'shimmer 2.5s linear infinite',
              }}
            />
            <span className="relative z-10">Login to Clerque</span>
            <ArrowRight className="relative z-10 w-4 h-4" />
          </Link>

          <button
            className="glass glass-hover flex items-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-white text-sm transition-all duration-200 hover:scale-105"
          >
            Partner with HNScorp
          </button>
        </motion.div>

        {/* Dashboard card */}
        <motion.div variants={fadeUp}>
          <DashboardCard />
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
      className="relative overflow-hidden py-3"
      style={{
        borderTop: '1px solid rgba(0,209,255,0.15)',
        borderBottom: '1px solid rgba(0,209,255,0.15)',
        background: '#010101',
      }}
    >
      {/* Left fade */}
      <div
        className="absolute left-0 top-0 bottom-0 w-24 z-10 pointer-events-none"
        style={{
          background: 'linear-gradient(to right, #010101, transparent)',
        }}
      />
      {/* Right fade */}
      <div
        className="absolute right-0 top-0 bottom-0 w-24 z-10 pointer-events-none"
        style={{
          background: 'linear-gradient(to left, #010101, transparent)',
        }}
      />

      <div
        className="flex whitespace-nowrap animate-ticker"
        style={{ color: '#00d1ff', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.05em' }}
      >
        {doubled}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ecosystem Bento Grid
// ---------------------------------------------------------------------------

function EcosystemCard({
  children,
  className = '',
  style = {},
  featured = false,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  featured?: boolean;
}) {
  return (
    <motion.div
      variants={fadeUp}
      className={`glass glass-hover rounded-2xl p-6 transition-all duration-300 ${className}`}
      style={{
        border: featured
          ? '1px solid rgba(0,209,255,0.35)'
          : '1px solid rgba(0,209,255,0.12)',
        boxShadow: featured
          ? '0 0 30px rgba(0,209,255,0.12), 0 0 60px rgba(0,209,255,0.04)'
          : undefined,
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

function CircuitCLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="10" fill="rgba(0,209,255,0.1)" />
      <path
        d="M26 14C24.3 12.7 22.2 12 20 12C15.6 12 12 15.6 12 20C12 24.4 15.6 28 20 28C22.2 28 24.3 27.3 26 26"
        stroke="#00d1ff"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="26" cy="14" r="2" fill="#00d1ff" />
      <circle cx="26" cy="26" r="2" fill="#00d1ff" />
      <line x1="28" y1="14" x2="32" y2="14" stroke="#00d1ff" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="28" y1="26" x2="32" y2="26" stroke="#00d1ff" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="32" y1="14" x2="32" y2="18" stroke="#00d1ff" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="32" y1="26" x2="32" y2="22" stroke="#00d1ff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function EcosystemSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section id="ecosystem" className="py-24 px-6 md:px-12 max-w-6xl mx-auto" ref={ref}>
      <motion.div
        initial="hidden"
        animate={inView ? 'visible' : 'hidden'}
        variants={stagger}
        className="text-center mb-14"
      >
        <motion.p
          variants={fadeUp}
          className="text-xs font-semibold uppercase tracking-widest mb-3"
          style={{ color: '#00d1ff' }}
        >
          Products
        </motion.p>
        <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-black text-white mb-4">
          The Clerque Ecosystem
        </motion.h2>
        <motion.p variants={fadeUp} className="text-slate-400 text-lg">
          Every tool a Filipino business owner needs, unified.
        </motion.p>
      </motion.div>

      <motion.div
        initial="hidden"
        animate={inView ? 'visible' : 'hidden'}
        variants={stagger}
        className="grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-auto"
      >
        {/* Card 1 — Featured, col-span-2 */}
        <EcosystemCard featured className="md:col-span-2 relative overflow-hidden" >
          {/* Animated border shimmer */}
          <div
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(0,209,255,0.08) 50%, transparent 100%)',
              backgroundSize: '200% auto',
              animation: 'shimmer 3s linear infinite',
            }}
          />
          <div className="relative z-10">
            <div className="flex items-start justify-between mb-4">
              <CircuitCLogo />
              <span
                className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{ background: 'rgba(0,209,255,0.1)', color: '#00d1ff' }}
              >
                Flagship
              </span>
            </div>
            <h3 className="text-2xl font-black text-white mb-2">Clerque Suite</h3>
            <p className="text-slate-400 text-sm leading-relaxed mb-6">
              The all-in-one business platform for Philippine MSMEs. Manage your point of sale,
              process payroll, and keep your books — all from a single, beautifully designed interface.
            </p>
            <div
              className="flex items-center gap-3 mb-6 text-xs font-medium"
              style={{ color: 'rgba(0,209,255,0.7)' }}
            >
              {['POS', 'Payroll', 'Accounting'].map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 rounded-full"
                  style={{ background: 'rgba(0,209,255,0.08)', border: '1px solid rgba(0,209,255,0.15)' }}
                >
                  {tag}
                </span>
              ))}
            </div>
            <Link
              href="https://clerque.hnscorpph.com/login"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-black text-sm transition-all duration-200 hover:scale-105"
              style={{ background: '#00d1ff' }}
            >
              Visit App
              <MoveUpRight className="w-4 h-4" />
            </Link>
          </div>
        </EcosystemCard>

        {/* Card 2 — BIR Compliance */}
        <EcosystemCard>
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(0,209,255,0.1)' }}
          >
            <Shield className="w-5 h-5" style={{ color: '#00d1ff' }} />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">BIR Compliance</h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            CAS-Ready, 2550Q, EIS e-invoicing built in. Stay compliant without
            the headache.
          </p>
        </EcosystemCard>

        {/* Card 3 — Cloud Infra */}
        <EcosystemCard>
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(0,209,255,0.1)' }}
          >
            <Cloud className="w-5 h-5" style={{ color: '#00d1ff' }} />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Cloud Infrastructure</h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            Railway + Vercel. Asia-Pacific region. 99.9% uptime backed by enterprise SLA.
          </p>
        </EcosystemCard>

        {/* Card 4 — Mobile PWA */}
        <EcosystemCard>
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(0,209,255,0.1)' }}
          >
            <Smartphone className="w-5 h-5" style={{ color: '#00d1ff' }} />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Mobile-Native PWA</h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            Works on any device. Install to homescreen. No app store needed.
          </p>
        </EcosystemCard>

        {/* Card 5 — Offline Mode */}
        <EcosystemCard>
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(0,209,255,0.1)' }}
          >
            <WifiOff className="w-5 h-5" style={{ color: '#00d1ff' }} />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Offline Mode</h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            Sells even without internet. Auto-syncs when back online — zero data loss.
          </p>
        </EcosystemCard>
      </motion.div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Filipino Workflow Section
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
      desc: 'Patchy internet? No problem. Clerque queues transactions and syncs automatically when you\'re back online.',
    },
    {
      icon: PhoneCall,
      title: 'Local Support, Always',
      desc: 'Filipino support team. Same timezone. Real humans who understand your business and speak your language.',
    },
  ];

  return (
    <section
      className="py-24 px-6 md:px-12"
      style={{
        background:
          'radial-gradient(ellipse at 50% 0%, rgba(0,209,255,0.05) 0%, transparent 60%), #010101',
      }}
    >
      <div className="max-w-6xl mx-auto" ref={ref}>
        <motion.div
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
          variants={stagger}
          className="text-center mb-16"
        >
          <motion.p
            variants={fadeUp}
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: '#00d1ff' }}
          >
            Why Clerque
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-black text-white">
            Built for the Filipino Workflow
          </motion.h2>
        </motion.div>

        <motion.div
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
          variants={stagger}
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {features.map(({ icon: Icon, title, desc }) => (
            <motion.div
              key={title}
              variants={fadeUp}
              className="group relative glass rounded-2xl p-8 cursor-default"
              style={{ transition: 'all 0.3s ease' }}
            >
              {/* Cyan top accent line on hover */}
              <div
                className="absolute top-0 left-6 right-6 h-px rounded-full transition-all duration-300 group-hover:opacity-100 opacity-0"
                style={{ background: 'rgba(0,209,255,0.5)' }}
              />
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-5 transition-all duration-300 group-hover:scale-110"
                style={{ background: 'rgba(0,209,255,0.08)', border: '1px solid rgba(0,209,255,0.15)' }}
              >
                <Icon className="w-6 h-6" style={{ color: '#00d1ff' }} />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Animated SVG Line Chart
// ---------------------------------------------------------------------------

function AnimatedLineChart({ inView }: { inView: boolean }) {
  const pathRef = useRef<SVGPathElement>(null);
  const [length, setLength] = useState(0);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (pathRef.current) {
      const l = pathRef.current.getTotalLength();
      setLength(l);
      setOffset(l);
    }
  }, []);

  useEffect(() => {
    if (inView && length > 0) {
      const start = performance.now();
      const duration = 1800;
      const tick = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setOffset(length * (1 - eased));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }, [inView, length]);

  const points = [
    [0, 80], [40, 72], [80, 68], [120, 55], [160, 50],
    [200, 42], [240, 30], [280, 22], [320, 10],
  ];

  const d =
    `M ${points[0][0]} ${points[0][1]} ` +
    points
      .slice(1)
      .map(([x, y]) => `L ${x} ${y}`)
      .join(' ');

  const fillD =
    d + ` L 320 90 L 0 90 Z`;

  return (
    <svg viewBox="0 0 320 90" className="w-full" style={{ height: '100px' }}>
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(0,209,255,0.25)" />
          <stop offset="100%" stopColor="rgba(0,209,255,0)" />
        </linearGradient>
      </defs>
      {/* Fill area */}
      <path d={fillD} fill="url(#chartFill)" opacity={inView ? 1 : 0} style={{ transition: 'opacity 0.5s 0.5s' }} />
      {/* Line */}
      <path
        ref={pathRef}
        d={d}
        fill="none"
        stroke="#00d1ff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={length}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0s' }}
      />
      {/* End dot */}
      {inView && (
        <circle cx="320" cy="10" r="4" fill="#00d1ff">
          <animate attributeName="r" values="3;5;3" dur="1.5s" repeatCount="indefinite" />
        </circle>
      )}
      {/* X-axis labels */}
      {['Jan', 'Mar', 'Jun', 'Sep', 'Dec'].map((label, i) => (
        <text
          key={label}
          x={i * 80}
          y="88"
          fontSize="8"
          fill="rgba(148,163,184,0.6)"
          textAnchor="middle"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Business Health / HUD Section
// ---------------------------------------------------------------------------

function HUDSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  const sales = useCountUp(2.4, inView, 1);
  const txCount = useCountUp(1200, inView);
  const uptime = useCountUp(99.9, inView, 1);

  const metrics = [
    { label: 'Total Processed', value: `₱${sales}M`, icon: TrendingUp },
    { label: 'Transactions', value: `${txCount}+`, icon: BarChart3 },
    { label: 'Uptime', value: `${uptime}%`, icon: CheckCircle2 },
  ];

  return (
    <section className="py-24 px-6 md:px-12 network-bg" ref={ref}>
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
          variants={stagger}
          className="text-center mb-14"
        >
          <motion.p
            variants={fadeUp}
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: '#00d1ff' }}
          >
            Live Dashboard
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-black text-white">
            See Your Business Health
            <br />
            <span
              style={{
                background: 'linear-gradient(135deg, #00d1ff 0%, #0057b7 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              in Real Time
            </span>
          </motion.h2>
        </motion.div>

        {/* Glass panel */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="glass rounded-3xl p-8 md:p-12"
          style={{
            boxShadow: '0 0 60px rgba(0,209,255,0.08)',
          }}
        >
          {/* Count-up metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {metrics.map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="text-center p-6 rounded-2xl"
                style={{ background: 'rgba(0,209,255,0.04)', border: '1px solid rgba(0,209,255,0.1)' }}
              >
                <Icon className="w-6 h-6 mx-auto mb-3" style={{ color: '#00d1ff' }} />
                <div className="text-3xl md:text-4xl font-black text-white mb-1">{value}</div>
                <div className="text-slate-500 text-xs font-medium uppercase tracking-wider">{label}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div
            className="rounded-2xl p-6"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,209,255,0.08)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-white">Revenue (₱)</span>
              <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(0,209,255,0.1)', color: '#00d1ff' }}>
                2026
              </span>
            </div>
            <AnimatedLineChart inView={inView} />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA Banner
// ---------------------------------------------------------------------------

function CTABanner() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section
      ref={ref}
      className="relative py-28 px-6 overflow-hidden"
      style={{ background: '#010101' }}
    >
      {/* Left edge glow */}
      <div
        className="absolute left-0 top-0 bottom-0 w-80 pointer-events-none"
        style={{
          background: 'linear-gradient(to right, rgba(0,209,255,0.07), transparent)',
        }}
      />
      {/* Right edge glow */}
      <div
        className="absolute right-0 top-0 bottom-0 w-80 pointer-events-none"
        style={{
          background: 'linear-gradient(to left, rgba(0,209,255,0.07), transparent)',
        }}
      />

      <motion.div
        initial="hidden"
        animate={inView ? 'visible' : 'hidden'}
        variants={stagger}
        className="relative z-10 max-w-3xl mx-auto text-center"
      >
        <motion.div variants={fadeUp} className="inline-flex mb-6">
          <span
            className="text-xs font-semibold px-4 py-1.5 rounded-full"
            style={{ background: 'rgba(0,209,255,0.08)', border: '1px solid rgba(0,209,255,0.2)', color: '#00d1ff' }}
          >
            Get Started Today
          </span>
        </motion.div>

        <motion.h2 variants={fadeUp} className="text-4xl md:text-6xl font-black text-white mb-5">
          Ready to digitize
          <br />
          your business?
        </motion.h2>

        <motion.p variants={fadeUp} className="text-slate-400 text-lg mb-10">
          Join hundreds of Filipino MSMEs already running on Clerque.
        </motion.p>

        <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="https://clerque.hnscorpph.com/login"
            target="_blank"
            rel="noopener noreferrer"
            className="relative overflow-hidden flex items-center gap-2 px-8 py-4 rounded-xl font-semibold text-black text-sm transition-all duration-200 hover:scale-105"
            style={{ background: '#00d1ff' }}
          >
            <span
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
                backgroundSize: '200% auto',
                animation: 'shimmer 2.5s linear infinite',
              }}
            />
            <span className="relative z-10">Start with Clerque</span>
            <ArrowRight className="relative z-10 w-4 h-4" />
          </Link>

          <button
            className="glass glass-hover flex items-center gap-2 px-8 py-4 rounded-xl font-semibold text-white text-sm transition-all duration-200 hover:scale-105"
          >
            Contact Sales
          </button>
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
    <footer
      className="py-10 px-6 md:px-12"
      style={{
        borderTop: '1px solid rgba(0,209,255,0.12)',
        background: '#010101',
      }}
    >
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-slate-500">
        {/* Logo + tagline */}
        <div className="flex flex-col items-center md:items-start gap-1">
          <span className="text-white font-bold text-base">HNScorpPH</span>
          <span className="text-xs">Powering Philippine MSMEs since 2024.</span>
        </div>

        {/* Center links */}
        <div className="flex items-center gap-6">
          <Link
            href="https://clerque.hnscorpph.com/login"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors"
          >
            Clerque
          </Link>
          <a href="#" className="hover:text-white transition-colors">
            Privacy
          </a>
          <a href="#" className="hover:text-white transition-colors">
            Terms
          </a>
        </div>

        {/* Copyright */}
        <div className="text-xs text-center md:text-right">
          © 2026 HNScorpPH OPC. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Page Root
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
        <HUDSection />

        {/* ── Brand Identity sections ──────────────────────────────────────── */}
        <EcosystemHero />

        {/* Endorsement lockup showcase */}
        <section className="bg-sand px-8 py-16 md:px-14 md:py-20">
          <div className="mx-auto max-w-6xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink/40 mb-3">
              Endorsement System · Product Lockups
            </p>
            <h2 className="mb-10 text-2xl font-semibold tracking-wordmark-tight text-ink md:text-3xl">
              Every product, unmistakably HNScorpPH.
            </h2>
            <div className="grid gap-6 md:grid-cols-2">
              <EndorsementLockup
                ProductMark={ClerqueLogo}
                productName="Clerque"
                productColorClass="text-clerque-600"
              />
              <EndorsementLockup
                ProductMark={SteadyLogo}
                productName="Steady"
                productColorClass="text-steady-600"
              />
            </div>
          </div>
        </section>

        <BrandSheet />
        {/* ───────────────────────────────────────────────────────────────────── */}

        <CTABanner />
      </main>
      <Footer />
    </>
  );
}
