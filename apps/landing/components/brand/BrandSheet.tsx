import Image from 'next/image';

interface BrandPick {
  key: string;
  imgSrc: string;
  name: string;
  hex: string;
  tagline: string;
}

const PICKS: BrandPick[] = [
  {
    key: 'hns',
    imgSrc: '/logos/hns-icon.png',
    name: 'HNScorpPH',
    hex: '#0891B2',
    tagline: 'The parent company — a Philippine OPC building software that helps local businesses run like modern enterprises, without the enterprise price tag.',
  },
  {
    key: 'clerque',
    imgSrc: '/logos/clerque-icon.png',
    name: 'Clerque',
    hex: '#4F46E5',
    tagline: 'All-in-one business suite for Filipino MSMEs. Point of sale, payroll, BIR-compliant accounting, and GCash & Maya payments — built for the Philippine market.',
  },
  {
    key: 'steady',
    imgSrc: '/logos/steady-icon.png',
    name: 'Steady',
    hex: '#0D9488',
    tagline: 'A free health companion for people living with epilepsy. Log seizures, track triggers, and keep caregivers informed — built with calm and empathy, not clinical coldness.',
  },
];

export function BrandSheet() {
  return (
    <section className="bg-sand px-8 py-16 md:px-14 md:py-20">
      <div className="mx-auto max-w-6xl">
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

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PICKS.map((p) => (
            <article
              key={p.key}
              className="flex flex-col gap-5 rounded-2xl border border-ink/5 bg-paper p-7 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
            >
              <div
                className="flex h-32 items-center justify-center rounded-xl"
                style={{ background: `linear-gradient(180deg, ${p.hex}14 0%, transparent 100%)` }}
              >
                <Image src={p.imgSrc} width={72} height={72} alt={p.name} className="rounded-2xl" />
              </div>
              <div>
                <div className="text-2xl font-semibold tracking-wordmark-tight text-ink">{p.name}</div>
                <p className="mt-2 text-xs leading-relaxed text-ink/55">{p.tagline}</p>
              </div>
              <div className="mt-auto flex items-center gap-2.5 rounded-lg bg-ink px-4 py-3.5">
                <Image src={p.imgSrc} width={18} height={18} alt={p.name} className="rounded-md" />
                <span className="text-[13px] font-semibold tracking-wordmark-tight text-paper">{p.name}</span>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-10 grid gap-8 border-t border-ink/10 pt-6 text-xs leading-relaxed text-ink/55 md:grid-cols-3">
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-ink">Founded in the Philippines</h3>
            HNScorpPH OPC is a solo-founded, Philippine-registered company building
            digital infrastructure for local businesses. Every product is designed
            around Filipino workflows, BIR compliance rules, and real-world
            connectivity constraints — not adapted from foreign software.
          </div>
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-ink">Two products live. More coming.</h3>
            Clerque is the flagship business suite — point of sale, payroll, and
            BIR-compliant accounting in one app built for MSMEs. Steady is a free
            health companion for people living with epilepsy and their caregivers,
            offering seizure logging and safety alerts.
          </div>
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-ink">One brand. One promise.</h3>
            Every HNScorpPH product carries the same mark and the same guarantee:
            built local, built right, built to last. The accent color changes with
            each product; the commitment to Filipino businesses and families never does.
          </div>
        </div>
      </div>
    </section>
  );
}
