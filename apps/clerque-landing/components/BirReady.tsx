import { FileCheck2, Receipt, ShieldCheck, FileSpreadsheet, BadgePercent, Lock } from 'lucide-react';

const BIR_FEATURES = [
  {
    icon: Receipt,
    title: 'Official Receipt out of the box',
    desc:  'OR for VAT and Non-VAT tenants; Acknowledgement Receipt for unregistered. Gapless OR sequencing with auto-reseed on shift open.',
  },
  {
    icon: BadgePercent,
    title: 'Senior and PWD discount, done right',
    desc:  'Captures cardholder name and OSCA / PWD ID at sale. Strips VAT, applies 20% on the net, prints RA 9994 / RA 10754 attestation on the receipt.',
  },
  {
    icon: FileCheck2,
    title: 'BIR-compliant Z-read',
    desc:  'End-of-day Z-read with VAT breakdown by category, tender by method, voids, discounts, OR range. Print to thermal or export.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Sales book and alphalists',
    desc:  'BIR Sales Detail Report, Purchase Book, Forms 2550M / 2550Q, alphalists — all exportable to XLSX in BIR-required format for your accountant.',
  },
  {
    icon: ShieldCheck,
    title: 'Audit log every regulator wants',
    desc:  'INSERT-only audit log at the database layer. Every void, refund, discount override, JE posting tracked with actor, IP, and user-agent.',
  },
  {
    icon: Lock,
    title: 'Period close enforced server-side',
    desc:  'Once a month is closed, transactions in that period cannot be modified. Period reopen requires written reason and increments a counter.',
  },
] as const;

export default function BirReady() {
  return (
    <section id="bir" className="py-20 sm:py-28 bg-paper">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 mb-4">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
            <span className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">BIR-ready · CAS aligned</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-clerque-900 tracking-tight-display mb-3">
            Pass a BIR audit without flinching.
          </h2>
          <p className="text-muted text-lg">
            Compliance baked in, not bolted on. Senior and PWD discounts compute the way the BIR examiner expects.
            VAT splits correctly between VATable, exempt, and zero-rated. Audit trail is tamper-evident.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {BIR_FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl bg-clerque-50 border border-clerque-100 p-6 hover:bg-white hover:border-clerque-200 hover:shadow-lg transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3.5">
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-clerque-900 mb-2">{f.title}</h3>
              <p className="text-sm text-muted leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
