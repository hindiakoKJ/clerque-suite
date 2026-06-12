import { ArrowRight, Check } from 'lucide-react';

const APP_URL = 'https://clerque.hnscorpph.com';

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-paper via-clerque-50 to-paper bg-grain">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left — copy */}
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-clerque-100 border border-clerque-200">
              <span className="w-2 h-2 rounded-full bg-clerque-500 animate-pulse" />
              <span className="text-xs font-semibold tracking-wide text-clerque-700 uppercase">Now in pilot · Philippines</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tighter-display text-clerque-900">
              The operating system of your{' '}
              <span className="text-clerque-500">small business.</span>
            </h1>

            <p className="text-lg text-muted leading-relaxed max-w-xl">
              POS, accounting, and payroll built for Filipino MSMEs — cafés, bakeries, restaurants, retail
              shops, laundromats, pharmacies. BIR-compliant receipts. GCash · Maya · QR PH · Card.
              Senior and PWD discounts done right. From <strong className="text-clerque-700">₱199/month</strong>.
            </p>

            <ul className="space-y-2.5">
              {[
                'BIR-compliant Official Receipts and Z-read out of the box',
                'GCash, PayMaya, QR PH, and Card — all native tenders',
                'Recipe COGS with FEFO ingredient tracking',
                'Works on any Android tablet · phone owner spot-check',
              ].map((line) => (
                <li key={line} className="flex items-start gap-2 text-sm text-clerque-900">
                  <Check className="w-4 h-4 text-clerque-500 mt-0.5 shrink-0" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href={`${APP_URL}/signup`}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-clerque-500 text-white font-semibold hover:bg-clerque-600 shadow-md transition"
              >
                Start free trial
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href="#pricing"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg border-2 border-clerque-200 text-clerque-800 font-semibold hover:bg-clerque-100 transition"
              >
                See pricing
              </a>
            </div>

            <p className="text-xs text-muted">
              No credit card needed · Cancel anytime · Built for bakeries first, every vertical next
            </p>
          </div>

          {/* Right — product mockup card */}
          <div className="relative">
            <div className="relative aspect-[5/6] rounded-3xl bg-gradient-to-br from-clerque-500 to-clerque-700 shadow-2xl shadow-clerque-900/20 p-6 sm:p-8 overflow-hidden">
              <div className="absolute inset-0 bg-grain opacity-30" />
              {/* Mock POS terminal */}
              <div className="relative h-full rounded-2xl bg-white/95 shadow-xl backdrop-blur-sm p-5 flex flex-col">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-clerque-100">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted font-semibold">Today · Demo Bakery</p>
                    <p className="text-2xl font-bold text-clerque-900 tabular-nums">₱14,820.00</p>
                  </div>
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                    ● Online
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { name: 'Pandesal',    price: 10 },
                    { name: 'Ensaymada',   price: 45 },
                    { name: 'Sliced loaf', price: 95 },
                    { name: 'Cappuccino',  price: 120 },
                  ].map((p) => (
                    <div key={p.name} className="rounded-lg border border-clerque-100 p-3 bg-clerque-50/40">
                      <p className="text-xs font-medium text-clerque-900 truncate">{p.name}</p>
                      <p className="text-sm font-bold text-clerque-500 tabular-nums">₱{p.price}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-auto space-y-2">
                  <div className="flex justify-between text-xs text-muted">
                    <span>Cart · 3 items</span>
                    <span className="tabular-nums">Sub ₱180</span>
                  </div>
                  <button className="w-full py-3 rounded-lg bg-clerque-500 text-white font-bold text-sm">
                    Charge ₱180.00
                  </button>
                </div>
              </div>

              {/* Floating receipt */}
              <div className="absolute -bottom-6 -right-3 sm:-right-6 w-44 rotate-[6deg] rounded-md bg-paper shadow-2xl p-3 font-mono text-[9px] text-clerque-900 leading-tight border border-clerque-200">
                <p className="text-center font-bold">DEMO BAKERY</p>
                <p className="text-center">TIN 123-456-789-00000</p>
                <p className="text-center font-bold mt-1.5">OFFICIAL RECEIPT</p>
                <hr className="my-1.5 border-dashed border-clerque-300" />
                <div className="flex justify-between"><span>2x Pandesal</span><span>20.00</span></div>
                <div className="flex justify-between"><span>1x Cappuccino</span><span>120.00</span></div>
                <hr className="my-1.5 border-dashed border-clerque-300" />
                <div className="flex justify-between font-bold"><span>TOTAL</span><span>140.00</span></div>
                <p className="text-center mt-1.5 text-[8px]">Salamat sa pagbili!</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
