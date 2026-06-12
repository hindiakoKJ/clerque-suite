const FAQS = [
  {
    q: 'Is Clerque BIR-accredited?',
    a: 'Clerque is built to the BIR Computerized Accounting System (CAS) specifications. The TIN, OR series, gapless numbering, and Z-read formats are all compliant. We are in the process of formal BIR accreditation; pilot merchants operate under our standard BIR-issued accreditation framework.',
  },
  {
    q: 'Do I need internet to use Clerque?',
    a: 'No — sales survive WiFi drops via a local SQLite outbox in the Counter app. Receipts print, orders queue, and the moment connectivity returns, everything syncs to the cloud. The Z-read reconciles correctly across offline shifts.',
  },
  {
    q: 'What payment methods do you support?',
    a: 'Cash, GCash, PayMaya / Maya, QR PH (BSP InstaPay), and Card (Visa / Mastercard / JCB / BancNet via your EDC terminal). Each is a separate tender column on the Z-read so you can reconcile against your bank statement.',
  },
  {
    q: 'Can my accountant export the data?',
    a: 'Yes. Every report — Sales Detail, Purchase Book, Forms 2550M / 2550Q, alphalists, Trial Balance, Balance Sheet, P&L, Journal Entries — exports to XLSX in the format BIR expects.',
  },
  {
    q: 'What if I outgrow my current plan?',
    a: 'Larger tiers add multi-branch, multi-module, custom roles, and cross-tenant reporting. Migration is in-place — no data loss, no re-onboarding. Talk to sales about Pair, Suite, and Enterprise when you need more.',
  },
  {
    q: 'How do I cancel?',
    a: 'From the web admin, Settings → Subscription → Cancel. Your data stays accessible read-only for 90 days so you can download archives. After 90 days, you can request full data deletion under RA 10173.',
  },
  {
    q: 'Where is my data stored?',
    a: 'Postgres on Railway (Singapore region for low latency to PH). Daily encrypted backups to Cloudflare R2. Tenant-isolated; no cross-tenant data sharing.',
  },
  {
    q: 'What about training?',
    a: 'Pilot launches include a free onboarding session — we walk through tenant setup, hardware pairing, and a full smoke test together. The bakery pilot kit also includes a printable training checklist.',
  },
] as const;

export default function Faq() {
  return (
    <section id="faq" className="py-20 sm:py-28 bg-clerque-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-clerque-500 uppercase tracking-wider mb-2">Questions we hear a lot</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-clerque-900 tracking-tight-display mb-3">
            Frequently asked.
          </h2>
          <p className="text-muted text-lg">
            Got something not covered here? <a className="text-clerque-700 underline" href="mailto:support@hnscorpph.com">Ask support</a>.
          </p>
        </div>

        <div className="space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="group rounded-xl bg-white border border-clerque-100 overflow-hidden">
              <summary className="cursor-pointer list-none p-5 flex items-center justify-between gap-4 hover:bg-clerque-50/40">
                <h3 className="font-semibold text-clerque-900 pr-6">{f.q}</h3>
                <span className="shrink-0 w-7 h-7 rounded-full bg-clerque-100 text-clerque-700 flex items-center justify-center text-lg group-open:rotate-45 transition">
                  +
                </span>
              </summary>
              <div className="px-5 pb-5 text-sm text-muted leading-relaxed">{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
