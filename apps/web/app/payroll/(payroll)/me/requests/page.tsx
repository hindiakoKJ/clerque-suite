'use client';
/**
 * Sync (Payroll) → Requests
 *
 * Single landing page for every employee self-service workflow that asks
 * for management approval. Inspired by the standard PH HRIS pattern (Sprout
 * et al.): one card per request type, click → dedicated form/list page.
 *
 * Cards link to their own pages where they exist (Leaves), and surface a
 * "Coming soon" treatment for ones we haven't built yet. The user still sees
 * the full menu so they know what's on the roadmap and don't get the
 * misleading impression that the system "only does leaves".
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plane, FileBadge, CalendarClock, Briefcase, TrendingUp, Hourglass, Clock } from 'lucide-react';
import type { ElementType } from 'react';

interface RequestCard {
  href:     string;
  icon:     ElementType;
  title:    string;
  desc:     string;
  badge?:   'NEW' | 'SOON';
  enabled:  boolean;
}

const CARDS: RequestCard[] = [
  {
    href:    '/payroll/me/leaves',
    icon:    Plane,
    title:   'Leaves',
    desc:    'View or apply for vacation leave, sick leave, etc.',
    enabled: true,
  },
  {
    href:    '/payroll/me/requests/COA',
    icon:    FileBadge,
    title:   'Certificate of Attendance',
    desc:    'Log a missed clock-in or clock-out.',
    badge:   'NEW',
    enabled: true,
  },
  {
    href:    '/payroll/me/requests/SCHEDULE',
    icon:    CalendarClock,
    title:   'Schedule Adjustment',
    desc:    'Temporarily change your working time.',
    badge:   'NEW',
    enabled: true,
  },
  {
    href:    '/payroll/me/requests/OB',
    icon:    Briefcase,
    title:   'Official Business',
    desc:    'Log work hours outside the office.',
    badge:   'NEW',
    enabled: true,
  },
  {
    href:    '/payroll/me/requests/OT',
    icon:    TrendingUp,
    title:   'Overtime',
    desc:    'Log work in excess of your shift hours.',
    badge:   'NEW',
    enabled: true,
  },
  {
    href:    '/payroll/me/requests/UT',
    icon:    Hourglass,
    title:   'Undertime',
    desc:    'Request to work less hours than your shift.',
    badge:   'NEW',
    enabled: true,
  },
];

export default function RequestsPage() {
  const router = useRouter();

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined' && window.history.length > 1) router.back();
          else router.push('/payroll/me');
        }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Clock className="h-6 w-6 text-[var(--accent)]" />
          Requests
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Select a request type.</p>
      </header>

      <div className="space-y-2.5">
        {CARDS.map((c) => {
          const inner = (
            <div
              className={
                'rounded-xl border border-border bg-card p-4 flex items-start gap-4 transition-colors ' +
                (c.enabled ? 'hover:bg-muted/40 cursor-pointer' : 'opacity-60 cursor-not-allowed')
              }
            >
              <div className="h-10 w-10 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center shrink-0">
                <c.icon className="h-5 w-5 text-[var(--accent)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">{c.title}</span>
                  {c.badge === 'NEW' && (
                    <span className="text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-emerald-500 text-white">NEW</span>
                  )}
                  {c.badge === 'SOON' && (
                    <span className="text-[10px] font-medium tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">COMING SOON</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{c.desc}</div>
              </div>
            </div>
          );

          return c.enabled ? (
            <Link key={c.title} href={c.href}>{inner}</Link>
          ) : (
            <div key={c.title} aria-disabled title="Coming soon — let your manager know if you need this.">{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
