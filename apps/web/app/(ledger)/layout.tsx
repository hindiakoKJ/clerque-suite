import type React from 'react';
import { BookOpen, LayoutDashboard, ListOrdered, BookMarked, Zap } from 'lucide-react';
import { AppShell, type NavItem } from '@/components/shell/AppShell';

const LEDGER_ACCENT      = 'hsl(173 70% 40%)';
const LEDGER_ACCENT_SOFT = 'hsl(173 70% 40% / 0.08)';

const navItems: NavItem[] = [
  { href: '/ledger/dashboard', label: 'Dashboard',        icon: LayoutDashboard },
  { href: '/ledger/accounts',  label: 'Chart of Accounts',icon: ListOrdered },
  { href: '/ledger/journal',   label: 'Journal Entries',  icon: BookMarked },
  { href: '/ledger/events',    label: 'Event Queue',      icon: Zap },
];

export default function LedgerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        '--accent':      LEDGER_ACCENT,
        '--accent-soft': LEDGER_ACCENT_SOFT,
      } as React.CSSProperties}
    >
      <AppShell navItems={navItems} logoIcon={BookOpen} appName="Ledger">
        {children}
      </AppShell>
    </div>
  );
}
