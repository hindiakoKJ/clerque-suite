'use client';

/**
 * Demo Sample Notice — generic inline disclaimer for demo-mode pages.
 *
 * Specific pages (e.g. Chart of Accounts) can render this to show
 * "Showing 30 of 186 accounts — full set included with subscription".
 *
 * Hidden when not in demo mode.  Safe to render unconditionally.
 */

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { isDemoMode } from '@/lib/demo/config';

interface DemoSampleNoticeProps {
  /** Headline shown next to the icon, e.g. "Showing 30 of 186 accounts". */
  title: string;
  /** Longer body text below the title. */
  message?: string;
  /** Optional className for layout overrides. */
  className?: string;
}

export function DemoSampleNotice({ title, message, className = '' }: DemoSampleNoticeProps) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(isDemoMode());
  }, []);

  if (!active) return null;

  return (
    <div className={`rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3 ${className}`}>
      <Info className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
      <div className="text-sm">
        <p className="font-semibold text-amber-900">{title}</p>
        {message && <p className="text-amber-800 mt-0.5 leading-relaxed">{message}</p>}
      </div>
    </div>
  );
}
