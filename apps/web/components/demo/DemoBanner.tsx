'use client';

/**
 * Demo Banner — sticky top bar shown on every page when demo mode is active.
 *
 * Mounted in the root layout via a client-side check.  Hidden when not in
 * demo mode.  Provides:
 *   - "DEMO MODE" identifier so visitors know nothing is real
 *   - "Reset Demo" → wipes session state, re-seeds, returns to /demo
 *   - "Sign Up" → directs to real signup (when /signup ships)
 *
 * The banner is intentionally compact (z-index high) and uses warm tones
 * to avoid feeling like an error/warning.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, RotateCcw, LogIn } from 'lucide-react';
import { isDemoMode, deactivateDemo } from '@/lib/demo/config';
import { useDemoStore } from '@/lib/demo/store';
import { useAuthStore } from '@/store/auth';

export function DemoBanner() {
  const router = useRouter();
  const [active, setActive] = useState(false);

  // Detect demo mode on client mount (cookie/sessionStorage are client-only)
  useEffect(() => {
    setActive(isDemoMode());
  }, []);

  if (!active) return null;

  function handleReset() {
    if (confirm('Reset the demo? Your changes will be cleared and the demo data will return to its starting state.')) {
      useDemoStore.getState().reset();
      router.refresh();
    }
  }

  function handleExit() {
    if (confirm('Exit the demo and go to sign in? Your demo data will be cleared.')) {
      deactivateDemo();
      useAuthStore.getState().clear?.();
      router.push('/login');
    }
  }

  return (
    <div className="sticky top-0 z-50 w-full bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Sparkles className="w-4 h-4 flex-shrink-0" />
          <p className="text-xs sm:text-sm font-medium truncate">
            <span className="hidden sm:inline">🎬 </span>
            <strong>Demo Mode</strong>
            <span className="hidden md:inline"> — your changes save in this browser tab only</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium bg-white/15 hover:bg-white/25 rounded-md transition-colors"
            title="Reset demo data"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
          <button
            onClick={handleExit}
            className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium bg-white text-amber-700 hover:bg-amber-50 rounded-md transition-colors"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign Up</span>
          </button>
        </div>
      </div>
    </div>
  );
}
