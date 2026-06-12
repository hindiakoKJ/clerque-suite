import Logo from './Logo';

const APP_URL = 'https://clerque.hnscorpph.com';

export default function Footer() {
  const year = 2026;
  return (
    <footer className="bg-clerque-900 text-clerque-200 border-t border-clerque-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid md:grid-cols-4 gap-10 mb-10">
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <Logo />
              <span className="text-xl font-bold text-white tracking-tighter-display">Clerque</span>
            </div>
            <p className="text-xs text-clerque-300 leading-relaxed">
              The operating system of your Philippine MSME. POS, accounting, and payroll built for the way you actually run a small business.
            </p>
            <p className="text-[11px] text-clerque-400 mt-4">
              A product of <a href="https://hnscorpph.com" className="underline hover:text-white">HNS Corporation Philippines</a>.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-white mb-3">Product</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#modules"   className="hover:text-white">Modules</a></li>
              <li><a href="#verticals" className="hover:text-white">Verticals</a></li>
              <li><a href="#bir"       className="hover:text-white">BIR compliance</a></li>
              <li><a href="#faq"       className="hover:text-white">FAQ</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-white mb-3">Get started</h4>
            <ul className="space-y-2 text-sm">
              <li><a href={`${APP_URL}/signup`} className="hover:text-white">Sign up</a></li>
              <li><a href={`${APP_URL}/login`}  className="hover:text-white">Sign in</a></li>
              <li><a href="mailto:sales@hnscorpph.com"   className="hover:text-white">Talk to sales</a></li>
              <li><a href="mailto:support@hnscorpph.com" className="hover:text-white">Support</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-white mb-3">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li><a href={`${APP_URL}/legal/privacy`}            className="hover:text-white">Privacy policy</a></li>
              <li><a href={`${APP_URL}/legal/terms`}              className="hover:text-white">Terms of service</a></li>
              <li><a href={`${APP_URL}/legal/account-deletion`}   className="hover:text-white">Account deletion</a></li>
              <li><a href={`${APP_URL}/legal/sla`}                className="hover:text-white">Recovery SLA</a></li>
              <li><a href="mailto:dpo@hnscorpph.com"              className="hover:text-white">DPO contact</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-clerque-700 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-xs text-clerque-400">
          <p>© {year} HNS Corporation Philippines · Operated under the laws of the Republic of the Philippines.</p>
          <p>RA 10173 (Data Privacy Act) compliant · BIR CAS-aligned</p>
        </div>
      </div>
    </footer>
  );
}
