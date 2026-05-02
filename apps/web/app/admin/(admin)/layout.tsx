'use client';
import React, { useEffect } from 'react';
import { ShieldCheck, LayoutDashboard, Building2, AlertCircle, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';

const ACCENT      = 'hsl(330 70% 45%)';   // magenta — distinct from POS / Ledger / Sync
const ACCENT_SOFT = 'hsl(330 70% 45% / 0.10)';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router       = useRouter();
  const { user, clear } = useAuthStore();

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent',      ACCENT);
    root.style.setProperty('--accent-soft', ACCENT_SOFT);
    return () => {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-soft');
    };
  }, []);

  // Hard guard: only super-admins reach this layout.
  useEffect(() => {
    if (user && !(user.isSuperAdmin || user.role === 'SUPER_ADMIN')) {
      router.replace('/select');
    }
  }, [user, router]);

  async function handleLogout() {
    const refresh = localStorage.getItem('app-auth');
    if (refresh) { try { await api.post('/auth/logout', { refreshToken: refresh }); } catch {} }
    clear();
    document.cookie = 'app-session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    router.push('/login');
  }

  if (!user || !(user.isSuperAdmin || user.role === 'SUPER_ADMIN')) return null;

  const navItems: NavItem[] = [
    { href: '/admin/dashboard', label: 'Dashboard',     icon: LayoutDashboard },
    { href: '/admin/tenants',   label: 'Tenants',       icon: Building2 },
    { href: '/admin/events',    label: 'Failed Events', icon: AlertCircle },
    { href: '/admin/audit',     label: 'Audit Log',     icon: User },
  ];

  return (
    <div style={{ '--accent': ACCENT, '--accent-soft': ACCENT_SOFT } as React.CSSProperties}>
      <AppShell
        navItems={navItems}
        logoIcon={ShieldCheck}
        appName="Console"
        helpHref={undefined}
        onSignOut={handleLogout}
        headerRight={
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-foreground bg-pink-500/10 border border-pink-400/30 rounded-md px-2.5 py-1.5">
            <User className="h-3.5 w-3.5" />
            <span className="font-medium">SUPER ADMIN</span>
          </div>
        }
      >
        {children}
      </AppShell>
    </div>
  );
}
