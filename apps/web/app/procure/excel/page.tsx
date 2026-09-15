'use client';
/**
 * Buy lists in Excel: the backup the owner can read, edit and upload back.
 *
 * Procure stays where purchases are recorded. The file is the same lines seen
 * another way -- each row carries its control number -- and uploading it can
 * only RECORD what was bought: packs, pack size, price, brand and store on a line not
 * yet in stock, or a purchase made away from the app. The upload is shown
 * first, row by row, and nothing is saved until it is confirmed. Nothing goes
 * into stock from the file; each request's "Post to stock" does that.
 */
import { useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Download, Upload, Loader2, FileSpreadsheet, Check, AlertTriangle, Plus, PencilLine } from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';
import { sourceText } from '@repo/shared-types';

type Kind = 'UNCHANGED' | 'FILL' | 'NEW' | 'REFUSED';
interface PlanRow {
  kind: Kind;
  rowNumber: number;
  lineNumber?: string;
  item: string;
  unit?: string;
  reason?: string;
  packsBought?: number;
  packSize?: number;
  packCost?: number;
  brandNote?: string | null;
  sourceKind?: string | null;
  sourceName?: string | null;
  boughtOn?: string | null;
  branchName?: string;
  applied?: 'done' | 'failed';
  message?: string;
  requestNumber?: string;
}
interface PlanResult {
  preview: boolean;
  counts: { unchanged: number; fill: number; new: number; refused: number };
  rows: PlanRow[];
}

const manilaDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const errorText = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : m ?? fallback;
};

export default function BuyListsExcelPage() {
  const [to, setTo] = useState(() => manilaDay(new Date()));
  const [from, setFrom] = useState(() => manilaDay(new Date(Date.now() - 30 * 86_400_000)));
  const [downloading, setDownloading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'check' | 'record' | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [done, setDone] = useState<PlanResult | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await api.get('/procure/requests/excel', { params: { from, to }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clerque-buy-lists-${from}-to-${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      // A blob error body has to be read before its message can be shown.
      const blob = (e as { response?: { data?: Blob } })?.response?.data;
      let message = 'Could not make the file.';
      if (blob instanceof Blob) { try { message = JSON.parse(await blob.text()).message ?? message; } catch { /* keep the fallback */ } }
      toast.error(message);
    } finally {
      setDownloading(false);
    }
  };

  const send = async (preview: boolean) => {
    if (!file) return;
    setBusy(preview ? 'check' : 'record');
    try {
      const form = new FormData();
      form.append('file', file);
      /*
        The shared client defaults to JSON, and axios would turn the FormData into
        {"file":{}}. Saying multipart lets the browser write the boundary itself,
        the same as every other upload screen.
      */
      const res = await api.post<PlanResult>(`/procure/requests/excel?preview=${preview}`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (preview) { setPlan(res.data); setDone(null); }
      else { setDone(res.data); setPlan(null); }
    } catch (e) {
      toast.error(errorText(e, preview ? 'Could not read the file.' : 'Could not record the file.'));
    } finally {
      setBusy(null);
    }
  };

  const changes = plan ? plan.counts.fill + plan.counts.new : 0;
  const shown = (r: PlanResult) => r.rows.filter((x) => x.kind !== 'UNCHANGED');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold"><FileSpreadsheet className="h-5 w-5 text-[var(--accent)]" /> Buy lists in Excel</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          A copy of the buy lists to keep, fill in and upload back. The upload only records what was bought;
          nothing goes into stock until someone taps <strong>Post to stock</strong> on the request.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">1. Download</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 block rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-muted-foreground">To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-0.5 block rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
          </label>
          <button type="button" onClick={() => void download()} disabled={downloading || !from || !to}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download Excel
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          One row per item, with its Line No. Blank rows at the bottom are for purchases made away from the app. The How to use sheet explains the rest.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">2. Upload it back</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept=".xlsx" className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPlan(null); setDone(null); e.target.value = ''; }} />
          <button type="button" onClick={() => input.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-muted">
            <Upload className="h-4 w-4" /> {file ? 'Choose another file' : 'Choose the file'}
          </button>
          {file && <span className="truncate text-sm text-muted-foreground">{file.name}</span>}
          {file && (
            <button type="button" onClick={() => void send(true)} disabled={busy != null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy === 'check' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Check the file
            </button>
          )}
        </div>

        {plan && (
          <div className="mt-4 space-y-3">
            <p className="text-sm">
              <strong>{plan.counts.fill}</strong> line{plan.counts.fill === 1 ? '' : 's'} to fill in · <strong>{plan.counts.new}</strong> new purchase{plan.counts.new === 1 ? '' : 's'} ·{' '}
              <strong className={plan.counts.refused ? 'text-red-700 dark:text-red-400' : ''}>{plan.counts.refused}</strong> refused · {plan.counts.unchanged} unchanged
            </p>
            <PlanTable rows={shown(plan)} />
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void send(false)} disabled={busy != null || changes === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy === 'record' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Record {changes} change{changes === 1 ? '' : 's'}
              </button>
              {plan.counts.refused > 0 && (
                <span className="text-xs text-muted-foreground">Refused rows are left out. Fix them in the file and upload it again; recorded rows are not repeated.</span>
              )}
            </div>
          </div>
        )}

        {done && (() => {
          const failed = done.rows.filter((r) => r.applied === 'failed').length;
          const recorded = done.rows.filter((r) => r.applied === 'done').length;
          return (
          <div className="mt-4 space-y-3">
            <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${failed ? 'bg-amber-500/15' : 'bg-[var(--accent)]/10'}`}>
              {failed ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>
                {failed
                  ? <>Recorded {recorded} of {recorded + failed}. {failed} could not be recorded; see why below. </>
                  : <>Recorded. </>}
                Nothing is in stock yet: open each request on the{' '}
                <Link href="/procure/requests" className="font-medium text-[var(--accent)] hover:underline">buy list</Link>{' '}
                and tap Post to stock when the goods are on the shelf.
              </span>
            </p>
            <PlanTable rows={shown(done)} />
          </div>
          );
        })()}
      </section>
    </div>
  );
}

function PlanTable({ rows }: { rows: PlanRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing in the file changes anything.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr><th className="px-2 py-1.5">Row</th><th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5">What happens</th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.rowNumber} className="align-top">
              <td className="px-2 py-1.5 tabular-nums">{r.rowNumber}</td>
              <td className="px-2 py-1.5">
                <div className="font-medium">{r.item || '—'}</div>
                {r.lineNumber && <div className="font-mono text-[10px] text-muted-foreground">{r.lineNumber}</div>}
              </td>
              <td className="px-2 py-1.5">
                {r.kind === 'REFUSED' ? (
                  <span className="flex items-start gap-1 text-red-700 dark:text-red-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {r.reason}</span>
                ) : (
                  <span className="flex items-start gap-1">
                    {r.kind === 'NEW' ? <Plus className="mt-0.5 h-3 w-3 shrink-0" /> : <PencilLine className="mt-0.5 h-3 w-3 shrink-0" />}
                    <span>
                      {r.kind === 'NEW' ? `New purchase${r.branchName ? ` at ${r.branchName}` : ''}, bought ${r.boughtOn}: ` : 'Fill in: '}
                      {r.packsBought?.toLocaleString('en-PH')} × {r.packSize?.toLocaleString('en-PH')}{r.unit ? ` ${r.unit}` : ''} at {r.packCost != null ? formatPeso(r.packCost) : '—'}
                      {r.brandNote ? ` · ${r.brandNote}` : ''}
                      {sourceText(r.sourceKind, r.sourceName) ? ` · at ${sourceText(r.sourceKind, r.sourceName)}` : ''}
                      {r.applied === 'done' && <strong className="ml-1 text-emerald-700 dark:text-emerald-400">Recorded{r.requestNumber ? ` as ${r.requestNumber}` : ''}</strong>}
                      {r.applied === 'failed' && <strong className="ml-1 text-red-700 dark:text-red-400">Not recorded: {r.message}</strong>}
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
