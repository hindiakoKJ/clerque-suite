'use client';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useSessionChangeDetector } from '@/hooks/useSessionChangeDetector';

/**
 * Top-of-page banner shown when another tab in the same browser logged in
 * as a different user (which silently overwrote our shared cookie/token).
 *
 * The banner does not auto-refresh — it lets the user see what's happening
 * and choose to refresh. A silent reload would be jarring (especially mid-
 * sale on the cashier side).
 */
export function SessionChangedBanner() {
  const { hasChanged, dismiss } = useSessionChangeDetector();
  if (!hasChanged) return null;
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-300/40 dark:border-amber-700/40 text-sm">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <p className="text-xs text-amber-800 dark:text-amber-200 flex-1">
        <span className="font-semibold">Session changed in another tab.</span>{' '}
        Another user signed in on this browser. Refresh to use the new session,
        or close this tab if you didn&rsquo;t intend to switch.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white transition-colors"
      >
        <RefreshCw className="h-3 w-3" />
        Refresh
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
