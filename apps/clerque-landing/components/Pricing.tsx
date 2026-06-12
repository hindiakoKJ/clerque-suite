import { Check, X } from 'lucide-react';

const APP_URL = 'https://clerque.hnscorpph.com';

const TIERS = [
  {
    code:     'SOLO_LITE',
    name:     'Solo Lite',
    price:    199,
    subtitle: 'Owner-operator · 1 user',
    desc:     'Get started for less than the cost of a sack of flour.',
    features: [
      { text: 'BIR-compliant POS',                    on: true  },
      { text: '5 recipe products',                    on: true  },
      { text: 'Cash · GCash · Maya · QR PH · Card',   on: true  },
      { text: 'Daily Z-read · BIR sales book',        on: true  },
      { text: 'Senior · PWD discount built in',       on: true  },
      { text: 'Batch tracking + FEFO',                on: false },
      { text: 'Pre-orders with deposit',              on: false },
      { text: 'Wholesale price lists',                on: false },
      { text: 'Audit log',                            on: false },
    ],
    cta:    'Start with Lite',
    featured: false,
  },
  {
    code:     'SOLO_STANDARD',
    name:     'Solo Standard',
    price:    399,
    subtitle: 'Owner + 1-2 helpers · 3 users',
    desc:     'The "I actually have staff" tier. Best value for most pilots.',
    features: [
      { text: 'Everything in Lite',                   on: true  },
      { text: 'Unlimited recipes',                    on: true  },
      { text: 'Batch tracking (10 items)',            on: true  },
      { text: 'Custom-cake pre-orders + deposit',     on: true  },
      { text: 'Wholesale price lists',                on: true  },
      { text: 'EOD markdown discount',                on: true  },
      { text: 'Sales Lead supervisor PIN',            on: true  },
      { text: 'Customer phone lookup at till',        on: true  },
      { text: 'Receipt header / footer customization',on: true  },
    ],
    cta:    'Most popular',
    featured: true,
  },
  {
    code:     'SOLO_PRO',
    name:     'Solo Pro',
    price:    499,
    subtitle: 'Owner + co-owner + staff · 5 users',
    desc:     'When you want every feature, every report, every guardrail.',
    features: [
      { text: 'Everything in Standard',               on: true  },
      { text: 'Unlimited batch tracking',             on: true  },
      { text: 'FIFO valuation option',                on: true  },
      { text: 'Purchase orders',                      on: true  },
      { text: 'Per-item margin reports',              on: true  },
      { text: 'Audit log (4-year retention)',         on: true  },
      { text: 'Maker-checker on big voids',           on: true  },
      { text: 'Receipt logo upload',                  on: true  },
      { text: 'Auto-backup to cloud',                 on: true  },
    ],
    cta:    'Go Pro',
    featured: false,
  },
] as const;

export default function Pricing() {
  return (
    <section id="pricing" className="py-20 sm:py-28 bg-clerque-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center mb-12">
          <p className="text-sm font-semibold text-clerque-500 uppercase tracking-wider mb-2">Pricing · in pesos · no hidden fees</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-clerque-900 tracking-tight-display mb-3">
            Honest pricing for honest businesses.
          </h2>
          <p className="text-muted text-lg">
            All plans include unlimited products, unlimited transactions, BIR-ready receipts, and full export rights to your accountant.
            One subscription unlocks the web admin AND the Counter Android app.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6 lg:gap-5 items-stretch">
          {TIERS.map((t) => (
            <div
              key={t.code}
              className={`relative rounded-3xl bg-white p-7 flex flex-col ${
                t.featured
                  ? 'border-2 border-clerque-500 shadow-2xl shadow-clerque-500/15 lg:scale-[1.03]'
                  : 'border border-clerque-100 shadow-sm'
              }`}
            >
              {t.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-clerque-500 text-white text-[10px] font-bold uppercase tracking-wider">
                  Most popular
                </div>
              )}

              <div className="mb-5">
                <h3 className="text-2xl font-bold text-clerque-900 mb-1">{t.name}</h3>
                <p className="text-xs text-muted">{t.subtitle}</p>
              </div>

              <div className="mb-5">
                <p className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-clerque-900 tabular-nums">₱{t.price}</span>
                  <span className="text-sm text-muted">/month</span>
                </p>
                <p className="text-xs text-muted mt-1">{t.desc}</p>
              </div>

              <ul className="space-y-2.5 mb-7 flex-1">
                {t.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    {f.on ? (
                      <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    ) : (
                      <X className="w-4 h-4 text-clerque-200 mt-0.5 shrink-0" />
                    )}
                    <span className={f.on ? 'text-clerque-900' : 'text-clerque-300 line-through'}>
                      {f.text}
                    </span>
                  </li>
                ))}
              </ul>

              <a
                href={`${APP_URL}/signup?plan=${t.code}`}
                className={`block text-center py-3 rounded-lg font-semibold transition ${
                  t.featured
                    ? 'bg-clerque-500 text-white hover:bg-clerque-600'
                    : 'border-2 border-clerque-200 text-clerque-800 hover:bg-clerque-100'
                }`}
              >
                {t.cta}
              </a>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-muted mt-10 max-w-2xl mx-auto">
          Need more than 5 users or multi-branch? <a href="mailto:sales@hnscorpph.com" className="text-clerque-700 underline hover:text-clerque-900">Talk to sales</a> about the Pair, Suite, and Enterprise tiers.
        </p>
      </div>
    </section>
  );
}
