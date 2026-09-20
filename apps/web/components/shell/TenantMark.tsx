'use client';
import * as React from 'react';
import { useEffect, useState } from 'react';

interface TenantMarkProps {
  /** Outer square in px (24 phone bar, 32 collapsed sidebar, 36 sidebar). */
  size:      number;
  logoSrc:   string;
  initials:  string;
  name?:     string | null;
  /** The app's icon, shown as a small badge on the corner (Counter vs Ledger). */
  badgeIcon?: React.ElementType;
  badgeSize?: number;
  /** Ring around the badge, matching the surface behind it. */
  badgeRingClassName?: string;
  className?: string;
}

/**
 * The business's mark in a small square: its logo scaled to fit on white, or
 * its initials on the app colour when there is no logo (or the logo fails to
 * load). A tiny app badge on the corner keeps "which app am I in" readable.
 *
 * Callers render the plain app square instead when `initials` is empty, i.e.
 * when branding could not be loaded at all.
 */
export function TenantMark({
  size, logoSrc, initials, name, badgeIcon: BadgeIcon, badgeSize = 14,
  badgeRingClassName = 'ring-secondary', className,
}: TenantMarkProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [logoSrc]);

  const showLogo = !!logoSrc && !failed;
  const label = name ?? undefined;

  return (
    <div
      className={`relative shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size }}
      title={label}
    >
      {showLogo ? (
        <div className="w-full h-full rounded-lg border border-border bg-white overflow-hidden flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            alt={label ?? 'Business logo'}
            className="max-w-full max-h-full object-contain"
            style={{ padding: size >= 32 ? 2 : 1 }}
            onError={() => setFailed(true)}
          />
        </div>
      ) : (
        <div
          role="img"
          aria-label={label ?? initials}
          className="w-full h-full rounded-lg flex items-center justify-center font-bold leading-none select-none"
          style={{
            background: 'color-mix(in oklab, var(--accent, hsl(217 91% 55%)) 16%, transparent)',
            color:      'var(--accent, hsl(217 91% 55%))',
            fontSize:   Math.max(9, Math.round(size * (initials.length > 1 ? 0.36 : 0.44))),
          }}
        >
          {initials}
        </div>
      )}
      {BadgeIcon && (
        <span
          aria-hidden
          className={`absolute -bottom-1 -right-1 rounded-full flex items-center justify-center ring-2 ${badgeRingClassName}`}
          style={{ width: badgeSize, height: badgeSize, background: 'var(--accent, hsl(217 91% 55%))' }}
        >
          <BadgeIcon className="text-white" style={{ width: Math.round(badgeSize * 0.64), height: Math.round(badgeSize * 0.64) }} />
        </span>
      )}
    </div>
  );
}
