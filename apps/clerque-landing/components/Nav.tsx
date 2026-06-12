import Link from 'next/link';
import Logo from './Logo';

const APP_URL = 'https://clerque.hnscorpph.com';

export default function Nav() {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-paper/90 border-b border-clerque-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="text-xl font-bold tracking-tighter-display text-clerque-900">Clerque</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-sm font-medium text-muted">
          <a href="#modules"   className="px-3 py-1.5 rounded-md hover:bg-clerque-100 hover:text-clerque-900 transition">Modules</a>
          <a href="#verticals" className="px-3 py-1.5 rounded-md hover:bg-clerque-100 hover:text-clerque-900 transition">Verticals</a>
          <a href="#bir"       className="px-3 py-1.5 rounded-md hover:bg-clerque-100 hover:text-clerque-900 transition">BIR ready</a>
          <a href="#faq"       className="px-3 py-1.5 rounded-md hover:bg-clerque-100 hover:text-clerque-900 transition">FAQ</a>
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={`${APP_URL}/login`}
            className="hidden sm:inline-flex text-sm font-medium text-clerque-800 hover:text-clerque-900 px-3 py-2 rounded-md hover:bg-clerque-100 transition"
          >
            Sign in
          </a>
          <a
            href={`${APP_URL}/signup`}
            className="inline-flex items-center text-sm font-semibold text-white bg-clerque-500 hover:bg-clerque-600 px-4 py-2 rounded-lg shadow-sm transition"
          >
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}
