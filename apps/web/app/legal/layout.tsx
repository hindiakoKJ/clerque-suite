'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft, FileText, ShieldCheck, LifeBuoy, Trash2,
  ShieldAlert, Cookie, Receipt, FileLock2, Network,
} from 'lucide-react';

const LEGAL_LINKS = [
  { href: '/legal/privacy',          label: 'Privacy Policy',    icon: ShieldCheck },
  { href: '/legal/terms',            label: 'Terms of Service',  icon: FileText },
  { href: '/legal/acceptable-use',   label: 'Acceptable Use',    icon: ShieldAlert },
  { href: '/legal/cookies',          label: 'Cookies',           icon: Cookie },
  { href: '/legal/refunds',          label: 'Refunds',           icon: Receipt },
  { href: '/legal/dpa',              label: 'Data Processing',   icon: FileLock2 },
  { href: '/legal/subprocessors',    label: 'Sub-processors',    icon: Network },
  { href: '/legal/sla',              label: 'Recovery SLA',      icon: LifeBuoy },
  { href: '/legal/account-deletion', label: 'Delete Account',    icon: Trash2 },
] as const;

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-3xl px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <ArrowLeft className="h-4 w-4" />
            Back to login
          </Link>
          <nav aria-label="Legal documents" className="flex flex-wrap items-center gap-1 text-xs sm:justify-end">
            {LEGAL_LINKS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                    active
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        {children}
      </main>
      <footer className="border-t border-border mt-16 py-8 text-center text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} HNS Corporation Philippines. All rights reserved.</p>
        <p className="mt-1">Operated under the laws of the Republic of the Philippines.</p>
      </footer>
    </div>
  );
}
