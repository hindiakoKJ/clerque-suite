'use client';
import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

/**
 * Root-level error boundary — catches unhandled errors from any page or
 * server component below. Shows a friendly retry instead of a blank page
 * or browser-default crash.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('App-level error caught:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-500/10">
          <AlertTriangle className="w-7 h-7 text-red-500" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The page hit an unexpected error while loading. This is usually a hiccup —
          try again. If it keeps failing, sign out and back in to refresh your session,
          or contact support.
        </p>
        {error.digest && (
          <p className="text-[10px] text-muted-foreground/70 font-mono">
            Reference: {error.digest}
          </p>
        )}
        <div className="flex gap-2 justify-center pt-2">
          <button
            onClick={() => reset()}
            className="h-9 px-4 rounded-md bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 flex items-center gap-1.5 transition-opacity"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
          <button
            onClick={() => { window.location.href = '/select'; }}
            className="h-9 px-4 rounded-md border border-border text-sm font-medium hover:bg-muted flex items-center gap-1.5 transition-colors"
          >
            <Home className="w-4 h-4" /> Go to apps
          </button>
        </div>
      </div>
    </div>
  );
}
