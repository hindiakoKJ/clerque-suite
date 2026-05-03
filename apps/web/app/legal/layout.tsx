'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, FileText, ShieldCheck } from 'lucide-react';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            Back to login
          </Link>
          <nav className="flex items-center gap-1 text-xs">
            <Link
              href="/legal/privacy"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                pathname === '/legal/privacy'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Privacy Policy
            </Link>
            <Link
              href="/legal/terms"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                pathname === '/legal/terms'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              Terms of Service
            </Link>
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
