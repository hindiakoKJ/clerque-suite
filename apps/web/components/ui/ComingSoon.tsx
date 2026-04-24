import type { LucideIcon } from 'lucide-react';

interface ComingSoonProps {
  icon: LucideIcon;
  feature: string;
  eta?: string;
  description?: string;
}

export function ComingSoon({
  icon: Icon,
  feature,
  eta = 'Q3 2025',
  description,
}: ComingSoonProps) {
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

      <p className="text-sm text-slate-400 dark:text-slate-600">
        Estimated: {eta}
      </p>

      <div className="mt-8">
        <a
          href="mailto:support@example.com"
          className="text-sm font-medium hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          Contact support →
        </a>
      </div>
    </div>
  );
}
