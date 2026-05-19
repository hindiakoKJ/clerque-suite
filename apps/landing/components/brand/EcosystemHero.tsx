import Image from 'next/image';

type Status = 'live' | 'future';

interface Product {
  key: string;
  imgSrc?: string;
  name?: string;
  tintClass?: string;
  kind: string;
  status: Status;
}

const PRODUCTS: Product[] = [
  {
    key: 'clerque',
    imgSrc: '/logos/clerque-icon.png',
    name: 'Clerque',
    tintClass: 'bg-clerque-600/10',
    kind: 'Business suite — POS, ledger, payroll',
    status: 'live',
  },
  {
    key: 'steady',
    imgSrc: '/logos/steady-icon.png',
    name: 'Steady',
    tintClass: 'bg-steady-600/10',
    kind: 'Health companion — seizure tracking',
    status: 'live',
  },
  { key: 'future-1', kind: 'Coming soon', status: 'future' },
  { key: 'future-2', kind: 'Coming soon', status: 'future' },
];

export function EcosystemHero() {
  return (
    <section className="bg-gradient-to-b from-paper to-slate-50 px-8 py-16 md:px-16 md:py-20">
      <div className="mx-auto max-w-6xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink/40">
          Brand Architecture · The Parent &amp; Its Products
        </p>

        <div className="mt-7 flex items-center gap-6">
          <div className="flex h-24 w-24 items-center justify-center rounded-[22px] bg-hns-600 shadow-[0_14px_40px_-10px_rgba(8,145,178,0.4)] overflow-hidden">
            <Image src="/logos/hns-icon.png" width={60} height={60} alt="HNScorpPH" className="rounded-lg" />
          </div>
          <div>
            <h2 className="text-4xl font-semibold tracking-wordmark-tight text-ink md:text-5xl">
              HNScorpPH
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/55">
              The parent platform — digital sovereignty for MSMEs. The foundation
              every HNS product is built on.
            </p>
          </div>
        </div>

        <div className="ml-12 my-8 h-9 w-0.5 bg-gradient-to-b from-hns-600 to-transparent" />

        <div className="mb-4 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.16em] text-ink/45">
          <span className="h-px w-6 bg-ink/20" />
          Products by HNScorpPH
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {PRODUCTS.map((p) => (
            <ProductCard key={p.key} product={p} />
          ))}
        </div>

        <div className="mt-10 grid gap-8 border-t border-ink/10 pt-6 text-xs leading-relaxed text-ink/55 md:grid-cols-2">
          <p>
            <span className="font-semibold text-ink">HNS is the parent. </span>
            Every product carries the HNScorpPH endorsement. The platform mark
            stays cyan; products step out with their own accent so customers can
            tell them apart at a glance.
          </p>
          <p>
            <span className="font-semibold text-ink">Built to scale. </span>
            New apps slot in alongside Clerque and Steady — same geometry, same
            wordmark family, a fresh accent color. The architecture is ready
            before the products are.
          </p>
        </div>
      </div>
    </section>
  );
}

function ProductCard({ product }: { product: Product }) {
  if (product.status === 'future') {
    return (
      <div className="flex min-h-[168px] flex-col gap-3 rounded-xl border-[1.5px] border-dashed border-ink/15 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-ink/5">
          <span className="text-2xl font-light text-ink/25">+</span>
        </div>
        <div>
          <div className="text-base font-semibold tracking-tight text-ink/35">Future product</div>
          <div className="mt-1 text-[11px] leading-snug text-ink/50">{product.kind}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[168px] flex-col gap-3 rounded-xl border border-ink/10 bg-paper p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="absolute right-4 top-4 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Live
      </div>
      <div className={`flex h-11 w-11 items-center justify-center rounded-[10px] overflow-hidden ${product.tintClass}`}>
        <Image src={product.imgSrc!} width={28} height={28} alt={product.name!} className="rounded-md" />
      </div>
      <div>
        <div className="text-base font-semibold tracking-tight text-ink">{product.name}</div>
        <div className="mt-1 text-[11px] leading-snug text-ink/50">{product.kind}</div>
      </div>
      <div className="mt-auto border-t border-ink/5 pt-2.5 text-[10px] tracking-wide text-ink/40">
        by <span className="font-semibold text-hns-600">HNScorpPH</span>
      </div>
    </div>
  );
}
