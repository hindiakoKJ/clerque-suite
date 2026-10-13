'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { listTags } from '@/lib/inventory/tag-api';
import { useAuthStore } from '@/store/auth';
import type { Tag } from '@/lib/inventory/tags';
import { OWNER_ROLES, pagesFor } from './inventory-nav';

/**
 * Inventory home: one big tile per screen this person can open, each with a
 * line saying what it is for. The one live number is how many parts are
 * waiting for the owner's cost, because nothing sells until that is done.
 */
export default function InventoryHome() {
  const user = useAuthStore((s) => s.user);
  const isOwner = !!user && OWNER_ROLES.includes(user.role);

  const { data: waiting } = useQuery<Tag[]>({
    queryKey: ['tags', 'WAITING_FOR_COST'],
    queryFn: () => listTags({ status: 'WAITING_FOR_COST' }),
    enabled: isOwner,
    staleTime: 30_000,
  });

  const tiles = pagesFor(user?.role).filter((p) => p.href !== '/inventory');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">What do you want to do?</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Every part worth tagging gets a printed number, photos and the owner&apos;s cost. Only then can it be sold.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map(({ href, title, desc, Icon }) => {
          const note = href === '/inventory/cost' && waiting
            ? waiting.length === 0
              ? 'Nothing is waiting.'
              : `${waiting.length} part${waiting.length === 1 ? '' : 's'} waiting.`
            : null;
          return (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-[var(--accent)]/50 hover:bg-muted/30"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)]">
                <Icon className="h-7 w-7 text-[var(--accent)]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{title}</span>
                <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{desc}</span>
                {note && <span className="mt-1 block text-sm font-semibold text-[var(--accent)]">{note}</span>}
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
