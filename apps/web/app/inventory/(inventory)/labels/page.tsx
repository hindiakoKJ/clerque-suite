'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Code128Svg } from '@/components/inventory/Code128Svg';
import { labelGaps, listLabelRuns, reserveLabels } from '@/lib/inventory/tag-api';
import { apiErrorText, manilaTime, type LabelGaps, type LabelRun, type ReservedLabels } from '@/lib/inventory/tags';

/**
 * Print labels: the owner or a manager asks for the next N numbers, then
 * prints them from a PC on a USB label printer loaded with 40 x 30 mm labels,
 * one label per page: the number in big digits and a Code 128 barcode of it.
 *
 * The numbers come from the server, which hands out each number once and logs
 * who printed which run, so a label cannot be made up at the counter.
 */

/** Only the labels go to the printer: everything else on the page is hidden while printing. */
const PRINT_CSS = `
@page { size: 40mm 30mm; margin: 0; }
@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  body > *:not([data-label-print]) { display: none !important; }
  [data-label-print] { display: block !important; }
}
[data-label-print] .tag-label {
  width: 40mm; height: 30mm; box-sizing: border-box; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1mm;
  break-after: page; page-break-after: always; color: #000; background: #fff;
}
[data-label-print] .tag-label:last-child { break-after: auto; page-break-after: auto; }
[data-label-print] .tag-label-number {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, 'Roboto Mono', monospace;
  font-size: 24pt; font-weight: 800; line-height: 1; letter-spacing: 0.5mm;
}
`;

const PREVIEW_MAX = 12;

export default function PrintLabelsPage() {
  const queryClient = useQueryClient();
  const [count, setCount] = useState('');
  const [run, setRun] = useState<ReservedLabels | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { data: runs = [], isLoading: runsLoading, isError: runsError } = useQuery<LabelRun[]>({
    queryKey: ['tag-label-runs'],
    queryFn: listLabelRuns,
    staleTime: 30_000,
  });

  const n = Number(count);
  const valid = Number.isInteger(n) && n >= 1 && n <= 500;

  async function reserve() {
    if (!valid) { setError('Type how many labels, from 1 to 500.'); return; }
    setSaving(true);
    setError('');
    try {
      const r = await reserveLabels(n);
      setRun(r);
      setCount('');
      queryClient.invalidateQueries({ queryKey: ['tag-label-runs'] });
      queryClient.invalidateQueries({ queryKey: ['tag-label-gaps'] });
    } catch (e) {
      setError(apiErrorText(e, 'Could not get the label numbers.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Print labels</h2>
        <p className="text-sm text-muted-foreground">
          Get the next label numbers, then print them on 40 x 30 mm labels from a PC with a label printer.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); void reserve(); }}
        >
          <label className="flex-1 space-y-1">
            <span className="text-sm font-semibold">How many labels?</span>
            <Input
              value={count}
              onChange={(e) => { setCount(e.target.value); setError(''); }}
              type="number"
              inputMode="numeric"
              min={1}
              max={500}
              placeholder="e.g. 50"
              className="h-12 text-lg font-semibold"
            />
          </label>
          <Button type="submit" disabled={saving || !count} className="h-12 px-6 text-base">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Get the numbers'}
          </Button>
        </form>
        {error && <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-300" role="alert">{error}</p>}
      </section>

      {run && (
        <section className="space-y-3 rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-base font-semibold">
                Labels {run.from} to {run.to} ({run.numbers.length} label{run.numbers.length === 1 ? '' : 's'})
              </p>
              <p className="text-sm text-muted-foreground">
                Set the printer to 40 x 30 mm labels and no margins. Keep this page open until they are printed.
              </p>
            </div>
            <Button onClick={() => window.print()} className="h-12 px-6 text-base">
              <Printer className="h-5 w-5" /> Print
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {run.numbers.slice(0, PREVIEW_MAX).map((num) => (
              <div key={num} className="flex h-[30mm] w-[40mm] flex-col items-center justify-center gap-[1mm] rounded border border-border bg-white text-black">
                <span className="font-mono text-[20pt] font-extrabold leading-none tracking-wider">{num}</span>
                <Code128Svg value={num} heightMm={11} />
              </div>
            ))}
            {run.numbers.length > PREVIEW_MAX && (
              <div className="flex h-[30mm] items-center px-3 text-sm text-muted-foreground">
                and {run.numbers.length - PREVIEW_MAX} more
              </div>
            )}
          </div>
          <LabelPrintCopy numbers={run.numbers} />
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-base font-semibold">Labels printed before</h3>
        {runsLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : runsError ? (
          <p className="text-sm text-red-700 dark:text-red-300">Could not load the past label runs.</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No labels printed yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Numbers</th>
                  <th className="px-3 py-2 text-right">Labels</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Who</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((r) => (
                  <tr key={`${r.from}-${r.createdAt}`}>
                    <td className="px-3 py-2 font-mono">{r.from} to {r.to}</td>
                    <td className="px-3 py-2 text-right">{r.count}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2">{r.createdByName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <UnusedLabels />
    </div>
  );
}

const GAP_PREVIEW = 60;

/**
 * Printed numbers that never became a tag. New labels sit here until they
 * are stuck on parts; a number still here long after its run was printed is
 * a label that went missing, or went on a part that was never tagged.
 */
function UnusedLabels() {
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, isError, error } = useQuery<LabelGaps>({
    queryKey: ['tag-label-gaps'],
    queryFn: labelGaps,
    staleTime: 30_000,
  });

  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold">Printed but not used yet</h3>
      <p className="text-sm text-muted-foreground">
        Label numbers that were printed but are on no tagged part. New labels wait here until they are used; an old one still here is a label to find.
      </p>
      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : isError ? (
        <p className="text-sm text-red-700 dark:text-red-300">{apiErrorText(error, 'Could not load the unused labels.')}</p>
      ) : !data || data.totalUnused === 0 ? (
        <p className="text-sm text-muted-foreground">Every printed label is on a tagged part.</p>
      ) : (
        <ul className="space-y-2">
          {data.runs.map((r) => {
            const key = `${r.from}-${r.printedAt}`;
            const shown = open === key ? r.unused : r.unused.slice(0, GAP_PREVIEW);
            return (
              <li key={key} className="rounded-xl border border-border bg-card p-3">
                <p className="text-sm">
                  <span className="font-semibold">{r.unused.length} unused</span> from {r.from} to {r.to}, printed {manilaTime(r.printedAt)}
                </p>
                <p className="mt-1 break-words font-mono text-xs text-muted-foreground">{shown.join('  ')}</p>
                {r.unused.length > GAP_PREVIEW && (
                  <button type="button" onClick={() => setOpen(open === key ? null : key)} className="mt-1 text-xs font-medium text-[var(--accent)] underline">
                    {open === key ? 'Show fewer' : `Show all ${r.unused.length}`}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The printed copy: one 40 x 30 mm page per label. Mounted straight under
 * <body> so the print CSS can hide everything else, the app header included.
 */
function LabelPrintCopy({ numbers }: { numbers: string[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div data-label-print="" className="hidden">
      <style>{PRINT_CSS}</style>
      {numbers.map((num) => (
        <div key={num} className="tag-label">
          <span className="tag-label-number">{num}</span>
          <Code128Svg value={num} heightMm={12} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
