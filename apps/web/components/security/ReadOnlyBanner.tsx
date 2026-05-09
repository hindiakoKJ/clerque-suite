'use client';
/**
 * Sprint 19 — Read-only banner shown to tenant operators when their tenant
 * has been frozen by Console (ransomware kill switch). Sticky at top of
 * page so it's impossible to miss.
 *
 * Reads from useFloorLayout (already cached + revalidated across the app);
 * no extra network call. Hidden in Console / admin contexts.
 */
import { Snowflake } from 'lucide-react';
import { useFloorLayout } from '@/hooks/useFloorLayout';

export function ReadOnlyBanner() {
  const { layout } = useFloorLayout();
  const tenant = layout?.tenant;
  if (!tenant?.readOnlyMode) return null;

  return (
    <div className="sticky top-0 z-40 bg-red-600 text-white text-sm shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3">
        <Snowflake className="h-4 w-4 shrink-0 animate-pulse" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold">
            Read-only mode — your account is temporarily locked for security.
          </div>
          {tenant.readOnlyReason && (
            <div className="text-xs text-red-50 truncate">
              {tenant.readOnlyReason}
            </div>
          )}
        </div>
        <a
          href="mailto:support@hnscorpph.com"
          className="text-xs underline decoration-red-200 hover:text-white whitespace-nowrap"
        >
          Contact support
        </a>
      </div>
    </div>
  );
}
