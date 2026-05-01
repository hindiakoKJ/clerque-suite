'use client';
import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { X, LogOut, Settings, HelpCircle } from 'lucide-react';
import { useAuthStore } from '@/store/auth';

interface MobileNavSheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  logoIcon: React.ElementType;
  appName: string;
  brandName?: string;
  /** Optional Help & Guide route (per-app). Renders link in the footer when set. */
  helpHref?: string;
  onSignOut?: () => void;
}

export function MobileNavSheet({
  open, onClose, children, logoIcon: LogoIcon, appName, brandName = 'Clerque',
  helpHref, onSignOut,
}: MobileNavSheetProps) {
  const user = useAuthStore((s) => s.user);

  const itemCls =
    'flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground ' +
    'hover:bg-secondary hover:text-foreground transition-colors w-full';

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 md:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border flex flex-col md:hidden outline-none"
        >
          {/* Header */}
          <div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--accent)' }}>
                <LogoIcon className="h-4 w-4 text-white" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-semibold text-sm tracking-tight text-foreground">{brandName}</span>
                <span className="text-muted-foreground text-sm">·</span>
                <span className="font-semibold text-sm tracking-tight" style={{ color: 'var(--accent)' }}>{appName}</span>
              </div>
            </div>
            <Dialog.Close asChild>
              <button className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
                <span className="sr-only">Close menu</span>
              </button>
            </Dialog.Close>
          </div>

          {/* Nav items (passed in from AppShell) */}
          <div className="flex-1 overflow-y-auto">{children}</div>

          {/* Footer — Help / Settings / user info / Sign out */}
          <div className="border-t border-border p-2 shrink-0 space-y-0.5">
            {helpHref && (
              <Link href={helpHref} onClick={onClose} className={itemCls}>
                <HelpCircle className="h-4 w-4 shrink-0" />
                <span>Help &amp; Guide</span>
              </Link>
            )}
            <Link href="/settings" onClick={onClose} className={itemCls}>
              <Settings className="h-4 w-4 shrink-0" />
              <span>Settings</span>
            </Link>
            {user && (
              <div className="px-3 py-2 mt-1 rounded-md bg-muted/30">
                <p className="text-xs font-medium text-foreground truncate">{user.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {user.role?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </p>
              </div>
            )}
            {onSignOut && (
              <button
                onClick={() => { onClose(); onSignOut(); }}
                className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors w-full"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span>Sign out</span>
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
