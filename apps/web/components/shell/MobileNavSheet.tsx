'use client';
import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

interface MobileNavSheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  logoIcon: React.ElementType;
  appName: string;
  brandName?: string;
}

export function MobileNavSheet({ open, onClose, children, logoIcon: LogoIcon, appName, brandName = 'Clerque' }: MobileNavSheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 md:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border flex flex-col md:hidden outline-none"
        >
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
          <div className="flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
