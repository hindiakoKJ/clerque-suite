/**
 * Clerque purple-mark logo (the c · dots · lines stack).
 * Mirrors apps/counter/src/components/ClerqueLogo.tsx but as a static SVG.
 */
export default function Logo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="clerque-mark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#clerque-mark-bg)" />
      {/* Card 1 — Counter (c) */}
      <rect x="13" y="18" width="11" height="28" rx="3" fill="#F4ECFB" />
      <text x="18.5" y="40" fontFamily="Georgia, serif" fontSize="18" fontWeight="700"
            fill="#5B21B6" textAnchor="middle">c</text>
      {/* Card 2 — Ledger (dots) */}
      <rect x="26.5" y="18" width="11" height="28" rx="3" fill="#E9DCF7" />
      <circle cx="32" cy="24"  r="1.8" fill="#7C3AED" />
      <circle cx="32" cy="32"  r="1.8" fill="#7C3AED" />
      <circle cx="32" cy="40"  r="1.8" fill="#7C3AED" />
      {/* Card 3 — Sync (lines) */}
      <rect x="40" y="18" width="11" height="28" rx="3" fill="#DCC8F2" />
      <rect x="42.5" y="24" width="6" height="1.6" rx="0.8" fill="#A78BFA" />
      <rect x="42.5" y="31" width="6" height="1.6" rx="0.8" fill="#A78BFA" />
      <rect x="42.5" y="38" width="6" height="1.6" rx="0.8" fill="#A78BFA" />
    </svg>
  );
}
