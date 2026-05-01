'use client';
import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  /** Visual size — sm: 16px, md: 24px, lg: 40px, xl: 56px (default md). */
  size?:    'sm' | 'md' | 'lg' | 'xl';
  /** Optional caption shown beneath the spinner (centered). */
  message?: string;
  /** When true, fills its parent and centers vertically + horizontally. */
  fullscreen?: boolean;
  /** Accent colour (CSS class). Defaults to var(--accent). */
  className?: string;
}

const SIZE_CLASS = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-10 h-10',
  xl: 'w-14 h-14',
} as const;

const TEXT_CLASS = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-sm',
  xl: 'text-base',
} as const;

/**
 * Centered spinning loader with an optional message.
 *
 * Patterns:
 *   <Spinner />                                — small inline loader
 *   <Spinner size="lg" message="Loading…" />   — block-level with caption
 *   <Spinner fullscreen size="xl" />           — fills page during navigation
 */
export function Spinner({ size = 'md', message, fullscreen = false, className }: SpinnerProps) {
  const inner = (
    <div className="flex flex-col items-center justify-center gap-3">
      <Loader2
        className={`${SIZE_CLASS[size]} animate-spin ${className ?? ''}`}
        style={{ color: 'var(--accent)' }}
      />
      {message && (
        <p className={`${TEXT_CLASS[size]} text-muted-foreground`}>{message}</p>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm z-30">
        {inner}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center w-full h-full min-h-[200px] py-12">
      {inner}
    </div>
  );
}
