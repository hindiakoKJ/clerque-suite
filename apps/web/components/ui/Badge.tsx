import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
  {
    variants: {
      tone: {
        default: 'bg-secondary text-secondary-foreground',
        success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        warn:    'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        danger:  'bg-red-500/10 text-red-600 dark:text-red-400',
        accent:  'bg-[var(--accent-soft)] text-[var(--accent)]',
      },
    },
    defaultVariants: { tone: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props} />
  );
}
