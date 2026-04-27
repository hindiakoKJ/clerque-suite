import type { ComponentType } from 'react';
import { HNSLogo, ClerqueLogo, SteadyLogo, type LogoProps } from './logos';

interface BrandPick {
  key: string;
  Mark: ComponentType<LogoProps>;
  name: string;
  /** Tailwind text color class for the mark, e.g. "text-hns-600" */
  colorClass: string;
  /** Hex string used in the swatch and gradient tint. */
  hex: string;
  accentName: string;
  tagline: string;
}

const PICKS: BrandPick[] = [
  {
    key: 'hns',
    Mark: HNSLogo,
    name: 'HNScorpPH',
    colorClass: 'text-hns-600',
    hex: '#0891B2',
    accentName: 'Cyan · #0891B2',
    tagline: 'Digital sovereignty for MSMEs. Foundational, secure, tech-forward.',
  },
  {
    key: 'clerque',
    Mark: ClerqueLogo,
    name: 'Clerque',
    colorClass: 'text-clerque-600',
    hex: '#4F46E5',
    accentName: 'Trust Indigo · #4F46E5',
    tagline: 'POS, ledger, and payroll — organized, in flow, in one place.',
  },
  {
    key: 'steady',
    Mark: SteadyLogo,
    name: 'Steady',
    colorClass: 'text-steady-600',
    hex: '#0D9488',
    accentName: 'Calming Teal · #0D9488',
    tagline: 'A steady hand for seizure tracking. Calm, consistent, empathetic.',
  },
];

export function BrandSheet() {
  return (
    <section className="bg-sand px-8 py-16 md:px-14 md:py-20">
      <div className="mx-auto max-w-6xl">

        {/* Header */}
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink/40">
              HNScorpPH · Brand System v1
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight tracking-wordmark-tight text-ink md:text-4xl">
              One parent. A growing family of products.
              <br />
              <span className="text-ink/50">
                HNScorpPH is the platform — Clerque and Steady are the first to ship.
              </span>
            </h2>
          </div>
          <p className="max-w-xs text-xs leading-relaxed text-ink/55 md:text-right">
            The HNS mark anchors every product. Each app picks up its own accent so
            customers can recognize it — but the parent stays present in every lockup.
          </p>
        </div>

        {/* Brand cards */}
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PICKS.map((p) => (
            <article
              key={p.key}
              className="flex flex-col gap-5 rounded-2xl border border-ink/5 bg-paper p-7 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
            >
              {/* Hero tile */}
              <div
                className="flex h-32 items-center justify-center rounded-xl"
                style={{
                  background: `linear-gradient(180deg, ${p.hex}14 0%, transparent 100%)`,
                }}
              >
                <p.Mark size={84} className={p.colorClass} />
              </div>

              {/* Name + tagline */}
              <div>
                <div className="text-2xl font-semibold tracking-wordmark text-ink">
                  {p.name}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink/55">{p.tagline}</p>
              </div>

              {/* Color swatch */}
              <div className="mt-auto flex items-center gap-2.5">
                <span
                  className="h-7 w-7 rounded-md ring-1 ring-ink/5"
                  style={{ background: p.hex }}
                />
                <div className="flex flex-col">
                  <span className="text-[11px] font-semibold text-ink">{p.accentName}</span>
                  <span className="font-mono text-[10px] text-ink/45">{p.hex}</span>
                </div>
              </div>

              {/* Dark inline lockup */}
              <div className="flex items-center gap-2.5 rounded-lg bg-ink px-4 py-3.5">
                <p.Mark size={18} color="#FFFFFF" />
                <span className="text-[13px] font-semibold tracking-wordmark text-paper">
                  {p.name}
                </span>
              </div>
            </article>
          ))}
        </div>

        {/* System notes */}
        <div className="mt-10 grid gap-8 border-t border-ink/10 pt-6 text-xs leading-relaxed text-ink/55 md:grid-cols-3">
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-ink">Type</h3>
            Inter Tight, 600 / 500. Tight tracking on the wordmark (−0.02em);
            slightly looser body (−0.01em). One typeface across all three brands
            holds the family together.
          </div>
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-ink">Geometry</h3>
            All marks share a 64 px grid and consistent stroke weights (3.0–3.4 px
            at 64). Caps are rounded, corners radiused, ratios are calm.
          </div>
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-ink">Color</h3>
            HNS sits in confident cyan; Clerque steps up to a trust-leaning indigo
            for finance contexts; Steady warms toward a calming teal for healthcare
            empathy.
          </div>
        </div>
      </div>
    </section>
  );
}
