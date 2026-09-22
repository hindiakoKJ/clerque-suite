import type { LucideIcon } from 'lucide-react';
import { supportMailto } from '@/lib/support';

interface ComingSoonProps {
  icon: LucideIcon;
  feature: string;
  /**
   * Optional. A date-like value ("Q1 2027", "March 2027") is shown as
   * "Estimated: …"; any other sentence is shown as it is. Left out, nothing is
   * shown — there used to be a default of "Q3 2025", which sat on the page long
   * after that quarter had passed.
   */
  eta?: string;
  description?: string;
}

/** True for short values that name a date, e.g. "Q1 2027" or "March 2027". */
export function etaLooksLikeDate(eta: string): boolean {
  const t = eta.trim();
  return t.length <= 20 && /\b(19|20)\d{2}\b/.test(t);
}

export function ComingSoon({
  icon: Icon,
  feature,
  eta,
  description,
}: ComingSoonProps) {
  const etaText = eta?.trim();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: 'color-mix(in oklab, var(--accent) 10%, transparent)' }}
      >
        <Icon className="w-8 h-8" style={{ color: 'var(--accent)' }} />
      </div>

      <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
        {feature}
      </h2>

      <p className="text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed mb-2">
        {description ?? "We're building this. It will be available soon."}
      </p>

      {etaText && (
        <p className="text-sm text-slate-400 dark:text-slate-600 max-w-sm">
          {etaLooksLikeDate(etaText) ? `Estimated: ${etaText}` : etaText}
        </p>
      )}

      <div className="mt-8">
        <a
          href={supportMailto(`Question about ${feature}`)}
          className="text-sm font-medium hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          Contact support →
        </a>
      </div>
    </div>
  );
}
