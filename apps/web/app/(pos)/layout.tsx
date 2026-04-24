import type React from 'react';
import { ShoppingCart, LayoutDashboard, ShoppingBag, Package, ClipboardList, Users, Clock } from 'lucide-react';
import { AppShell, type NavItem } from '@/components/shell/AppShell';

const POS_ACCENT     = 'hsl(217 91% 55%)';
const POS_ACCENT_SOFT = 'hsl(217 91% 55% / 0.08)';

const navItems: NavItem[] = [
  { href: '/pos/dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/pos/orders',     label: 'Orders',      icon: ShoppingBag },
  { href: '/pos/products',   label: 'Products',    icon: Package },
  { href: '/pos/inventory',  label: 'Inventory',   icon: ClipboardList },
  { href: '/pos/staff',      label: 'Staff',       icon: Users },
  { href: '/pos/pending',    label: 'Pending Sync',icon: Clock },
];

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        '--accent':      POS_ACCENT,
        '--accent-soft': POS_ACCENT_SOFT,
      } as React.CSSProperties}
    >
      <AppShell navItems={navItems} logoIcon={ShoppingCart} appName="POS">
        {children}
      </AppShell>
    </div>
  );
}
