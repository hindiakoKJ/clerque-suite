import { ShoppingCart, BookOpen, Users } from 'lucide-react';

const MODULES = [
  {
    icon:    ShoppingCart,
    title:   'Counter',
    tag:     'POS',
    color:   'bg-amber-100 text-amber-900 border-amber-200',
    desc:    'Point-of-sale built for the till. Cashier rings sales, prints BIR-compliant receipts, takes Cash / GCash / Maya / Card / QR PH, applies Senior and PWD discounts the right way.',
    bullets: [
      'Native Android tablet app — owner spot-check from phone',
      'Offline-ready outbox — sales survive WiFi drops',
      'BIR-compliant OR / Acknowledgement Receipt, gapless numbering',
      'Modifier groups, recipe COGS, FEFO ingredient drain',
      'Bluetooth ESC/POS thermal printer + USB barcode scanner',
    ],
  },
  {
    icon:    BookOpen,
    title:   'Ledger',
    tag:     'Accounting',
    color:   'bg-emerald-100 text-emerald-900 border-emerald-200',
    desc:    'Double-entry bookkeeping that posts automatically from POS sales, AR/AP, payroll, and inventory. PFRS-aligned chart of accounts, BIR-ready exports for your accountant.',
    bullets: [
      '186-account COA pre-loaded — PFRS / PAS 12 compliant',
      'Automatic JE on every sale, refund, void, payroll run',
      'AR / AP with aging, advances, credit memos, recurring',
      'Maker-checker controls on JEs over threshold (SOD)',
      'Year-end close, period locking, audit log of every change',
    ],
  },
  {
    icon:    Users,
    title:   'Sync',
    tag:     'Payroll & HR',
    color:   'bg-blue-100 text-blue-900 border-blue-200',
    desc:    'Time-and-attendance, leave, and payroll in one place. Computes withholding tax, SSS, PhilHealth, Pag-IBIG. Issues BIR-ready payslips and 2316 at year-end.',
    bullets: [
      'Kiosk clock-in/out for cooks and helpers (no login needed)',
      'PH tax tables baked in — TRAIN-law compliant',
      'Leave ledger with accrual, paid leave, statutory holidays',
      'Auto-generated payslips and BIR Form 2316',
      '13th month, SSS / PhilHealth / Pag-IBIG remittance schedules',
    ],
  },
] as const;

export default function Modules() {
  return (
    <section id="modules" className="py-20 sm:py-28 bg-paper">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center mb-14">
          <p className="text-sm font-semibold text-clerque-500 uppercase tracking-wider mb-2">Three modules · one platform</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-clerque-900 tracking-tight-display mb-3">
            One subscription. Everything you need.
          </h2>
          <p className="text-muted text-lg">
            Counter at the till, Ledger doing the books, Sync handling staff —
            all sharing the same data so nothing has to be re-entered.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {MODULES.map((m) => (
            <div
              key={m.title}
              className="group rounded-2xl bg-white border border-clerque-100 p-7 hover:shadow-xl hover:border-clerque-200 transition-all flex flex-col"
            >
              <div className={`inline-flex w-12 h-12 rounded-xl items-center justify-center border ${m.color} mb-5`}>
                <m.icon className="w-6 h-6" />
              </div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">{m.tag}</p>
              <h3 className="text-2xl font-bold text-clerque-900 mt-1 mb-3">{m.title}</h3>
              <p className="text-sm text-muted leading-relaxed mb-5">{m.desc}</p>
              <ul className="space-y-2 mt-auto">
                {m.bullets.map((b) => (
                  <li key={b} className="text-xs text-clerque-900 flex items-start gap-2">
                    <span className="text-clerque-500 mt-0.5">✓</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
