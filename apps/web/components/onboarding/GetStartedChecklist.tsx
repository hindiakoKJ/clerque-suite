'use client';
/**
 * Sprint 19 — Generic per-vertical "Get Started" checklist for the POS
 * (and Sync) dashboards. Lifted from the LaundryDashboard pattern that
 * users liked.
 *
 * Pass a list of items; the component:
 *   - shows a header with N of M done counter
 *   - hides itself once every required item is `done` (so the checklist
 *     auto-disappears for established tenants)
 *   - each item is a Link to its setup page, with an arrow when pending
 *
 * Use `optional: true` to mark an item as not required for the auto-hide
 * threshold (e.g. "Add washers + dryers (optional)").
 */
import Link from 'next/link';
import { Sparkles, CheckCircle2, Circle, ArrowRight } from 'lucide-react';

export interface ChecklistItem {
  done:      boolean;
  label:     string;
  hint:      string;
  href:      string;
  optional?: boolean;
}

export function GetStartedChecklist({
  title = 'Get started',
  subtitle,
  items,
}: {
  title?:    string;
  subtitle?: string;
  items:     ChecklistItem[];
}) {
  const required = items.filter((i) => !i.optional);
  const allRequiredDone = required.every((i) => i.done);
  if (allRequiredDone && items.every((i) => i.done)) return null;
  // Hide once every REQUIRED item is done (optional ones don't gate the hide).
  if (allRequiredDone) return null;

  const doneCount = items.filter((i) => i.done).length;

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-[var(--accent)]" />
          {title}
        </h2>
        <span className="text-xs text-muted-foreground">
          {doneCount} of {items.length} done
        </span>
      </div>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      <div className="space-y-1 pt-1">
        {items.map((it, idx) => (
          <ChecklistRow key={idx} {...it} />
        ))}
      </div>
    </section>
  );
}

function ChecklistRow({
  done, label, hint, href, optional,
}: ChecklistItem) {
  return (
    <Link
      href={href}
      className={`flex items-start gap-2 px-2 py-1.5 rounded-md transition-colors ${
        done ? 'opacity-60' : 'hover:bg-muted/40'
      }`}
    >
      {done
        ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
        : <Circle       className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
          {label}
          {optional && (
            <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              optional
            </span>
          )}
        </p>
        {!done && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {!done && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground mt-1 shrink-0" />}
    </Link>
  );
}
