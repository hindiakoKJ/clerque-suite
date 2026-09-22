'use client';

/**
 * "Today's inventory" -- the daily sheet the kitchen and bar used to fill in by
 * hand: Beginning, In, Waste, Used, Ending, per item, for the branch's business
 * day. Clerque fills it in; the staff check it, print it and sign it.
 *
 *   StationInventorySheet  the full-screen sheet on a kitchen or bar screen,
 *                          dark like the station, with a day picker and Print.
 *   SheetTables            the tables alone, dark or light -- the owner's copy
 *                          under Inventory > Reports reuses them.
 *   SheetPrintCopy         the white A4 copy that prints in place of the page.
 *
 * The server builds every number and every word (the cells, the notes), so the
 * screen, the print and the owner's copy always read the same. Quantities only:
 * no costs reach a kitchen or bar screen.
 *
 * On the station's own running sheet each row also has "Thrown out": spoiled
 * milk, a dropped tray of fries. It goes through the very same write-off as
 * Procure > Stock, so the Waste column here and the books agree. It used to
 * need Anne or a manager in Procure, one item at a time, so the kitchen wrote
 * waste on paper -- and what never reached Procure left the stock too high and
 * the waste expense missing.
 *
 * On the owner's copy only, a day on which a weekly count recorded (or
 * adjusted) an item adds Counted and Difference -- counted minus what the
 * books said at that moment. The columns appear only when a row has them, and
 * a station's copy never carries them: the count is blind to the kitchen.
 *
 * Printing is the browser's own, laid out for A4 (a 58 mm receipt printer cannot
 * hold the table). The copy is rendered straight into <body> and, while it is
 * there, a print rule hides everything else -- so it prints alone whichever page
 * it sits in, without that page's layout needing to know.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Loader2, Printer, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { keepTapKey, newTapKey, tapFailure, tapFailureText } from './station-taps';
import {
  WASTE_REASONS, addPack, inPacks, packButtonLabel, parseWasteAmount, wasteNumber, wasteRequest, type WasteReason,
} from './station-waste';

export type SheetSectionKey = 'PREMADE' | 'INGREDIENTS' | 'SUPPLIES' | 'UNROUTED';
type Column = 'beginning' | 'in' | 'waste' | 'used' | 'ending' | 'adjust' | 'counted' | 'difference';
type CountColumn = 'counted' | 'difference';

export interface DailySheetRow {
  rawMaterialId: string;
  name: string;
  unit: string;
  packSize: number | null;
  alsoOn: string[];
  beginning: number;
  in: number;
  waste: number;
  used: number;
  ending: number;
  adjust: number;
  /** Owner's copy only, on a day a weekly count recorded or adjusted this item. */
  counted?: number | null;
  /** Counted minus the books at the moment of the count. */
  difference?: number | null;
  cells: Record<Exclude<Column, CountColumn>, string> & Partial<Record<CountColumn, string>>;
}

export interface DailySheet {
  shop: { name: string };
  station: { id: string; name: string; kind: string } | null;
  branch: { id: string; name: string };
  title: string;
  day: string;
  dayLabel: string;
  today: string;
  previousDay: string | null;
  previousDayLabel: string | null;
  nextDay: string | null;
  nextDayLabel: string | null;
  status: 'LIVE' | 'CLOSED';
  window: { from: string; to: string; fromLabel: string; toLabel: string };
  notes: string[];
  stillWaiting: number;
  showAdjust: boolean;
  sections: Array<{ key: SheetSectionKey; title: string; rows: DailySheetRow[] }>;
}

const COLUMNS: Array<[Column, string]> = [
  ['beginning', 'Beginning'], ['in', 'In'], ['waste', 'Waste'], ['used', 'Used'], ['ending', 'Ending'], ['adjust', 'Adjust'],
  ['counted', 'Counted'], ['difference', 'Difference'],
];
/** Counted and Difference only when a row has them: the owner's copy, on a day a weekly count covered. */
const hasCounts = (sheet: DailySheet) => sheet.sections.some((s) => s.rows.some((r) => r.counted != null));
const columnsOf = (sheet: DailySheet) => {
  const counts = hasCounts(sheet);
  return COLUMNS.filter(([key]) => (key === 'adjust' ? sheet.showAdjust : key === 'counted' || key === 'difference' ? counts : true));
};

/**
 * A cell's words. The server writes every cell; for the two count columns an
 * older server sent only the numbers, so they are written the sheet's way
 * here: "2 pk + 100 ml", a difference with its sign.
 */
function cellText(row: DailySheetRow, key: Column): string {
  const given = row.cells[key];
  if (given != null) return given;
  const q = key === 'counted' ? row.counted : key === 'difference' ? row.difference : null;
  if (q == null || row.counted == null) return '';
  const size = Math.abs(q);
  const words = inPacks(size, row.unit, row.packSize) ?? `${wasteNumber(size)} ${row.unit}`;
  if (key === 'counted') return words;
  return size < 0.001 ? `0 ${row.unit}` : `${q < 0 ? '−' : '+'}${words}`;
}

/** The server's own words for a refusal ("This screen is paired to another station."), when it sent any. */
export function sheetErrorMessage(error: unknown): string | null {
  const m = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : (m ?? null);
}

/** The note the server always puts first says LIVE or CLOSED; the print header already says that. The Adjust note goes under the table. */
const isAdjustNote = (note: string) => note.startsWith('Adjust is');

// ─── The tables ──────────────────────────────────────────────────────────────

const TONE = {
  dark: {
    heading: 'text-amber-300',
    wrap:    'border-stone-800',
    head:    'bg-stone-900 text-stone-400',
    nameHead: 'bg-stone-900',
    row:     'border-stone-800',
    name:    'bg-stone-950 text-white',
    also:    'text-stone-500',
    num:     'text-stone-200',
    ending:  'text-white',
    adjust:  'text-amber-300',
    short:   'text-red-300',
    over:    'text-emerald-300',
    empty:   'text-stone-400 border-stone-800',
  },
  light: {
    heading: 'text-foreground',
    wrap:    'border-border',
    head:    'bg-muted text-muted-foreground',
    nameHead: 'bg-muted',
    row:     'border-border',
    name:    'bg-background text-foreground',
    also:    'text-muted-foreground',
    num:     'text-foreground',
    ending:  'text-foreground',
    adjust:  'text-amber-600 dark:text-amber-400',
    short:   'text-red-600 dark:text-red-400',
    over:    'text-emerald-700 dark:text-emerald-400',
    empty:   'text-muted-foreground border-border',
  },
} as const;

/**
 * One table per section. Each scrolls sideways on its own, so the page never
 * does on a phone.
 *
 * `onThrowOut` is only passed on the station's own running sheet: the owner's
 * copy under Inventory > Reports draws the same tables with no buttons.
 */
export function SheetTables({ sheet, tone, onThrowOut }: {
  sheet: DailySheet;
  tone: 'dark' | 'light';
  onThrowOut?: (row: DailySheetRow) => void;
}): JSX.Element {
  const t = TONE[tone];
  const columns = columnsOf(sheet);
  if (sheet.sections.length === 0) {
    return (
      <p className={`rounded-xl border border-dashed px-4 py-10 text-center text-sm ${t.empty}`}>
        No items on this sheet yet. An item shows here once a product sent to this station uses it in a recipe, a size or an add-on.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      {sheet.sections.map((section) => (
        <section key={section.key}>
          <h3 className={`mb-2 text-sm font-bold uppercase tracking-wider ${t.heading}`}>{section.title}</h3>
          <div className={`overflow-x-auto rounded-xl border ${t.wrap}`}>
            <table className={`w-full text-sm ${columns.length > 6 ? 'min-w-[820px]' : 'min-w-[640px]'}`}>
              <thead className={`text-xs uppercase tracking-wide ${t.head}`}>
                <tr>
                  {/* The name stays put while the numbers scroll sideways. */}
                  <th scope="col" className={`sticky left-0 px-3 py-2.5 text-left font-semibold ${t.nameHead}`}>Item</th>
                  {columns.map(([key, label]) => (
                    <th key={key} scope="col" className="px-3 py-2.5 text-right font-semibold">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.rawMaterialId} className={`border-t ${t.row}`}>
                    <th scope="row" className={`sticky left-0 px-3 py-2.5 text-left font-medium ${t.name}`}>
                      <span className="block">{row.name}</span>
                      {row.alsoOn.length > 0 && (
                        <span className={`block text-xs font-normal ${t.also}`}>Also on {row.alsoOn.join(', ')}</span>
                      )}
                      {onThrowOut && (
                        <button
                          type="button"
                          onClick={() => onThrowOut(row)}
                          className="mt-1 flex min-h-9 items-center gap-1 rounded-lg border border-stone-700 px-2 text-xs font-semibold text-stone-300 transition-colors hover:bg-stone-800 active:bg-stone-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Thrown out
                        </button>
                      )}
                    </th>
                    {columns.map(([key]) => (
                      <td
                        key={key}
                        className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${
                          key === 'ending' ? `font-semibold ${t.ending}`
                            : key === 'adjust' && row.adjust !== 0 ? `font-semibold ${t.adjust}`
                            : key === 'difference' && row.counted != null && Math.abs(row.difference ?? 0) >= 0.001
                              ? `font-semibold ${(row.difference ?? 0) < 0 ? t.short : t.over}`
                              : t.num
                        }`}
                      >
                        {cellText(row, key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

// ─── The printed copy ────────────────────────────────────────────────────────

const PRINT_CSS = `
@page { size: A4 portrait; margin: 10mm; }
@media print {
  body > *:not([data-sheet-print]) { display: none !important; }
  html, body { background: #fff !important; }
}
[data-sheet-print] { color: #000; background: #fff; font-size: 9pt; line-height: 1.3; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; }
[data-sheet-print] table { width: 100%; border-collapse: collapse; margin-top: 6pt; }
[data-sheet-print] thead { display: table-header-group; }
[data-sheet-print] tr { break-inside: avoid; page-break-inside: avoid; }
[data-sheet-print] th, [data-sheet-print] td { border: 0.5pt solid #888; padding: 2.5pt 4pt; vertical-align: top; }
[data-sheet-print] thead th { font-weight: 700; text-align: right; }
[data-sheet-print] thead th:first-child, [data-sheet-print] tbody th { text-align: left; font-weight: 400; }
[data-sheet-print] td { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-sheet-print] tr.sheet-section td { text-align: left; font-weight: 700; background: #eee; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;

const manilaTime = (at: Date) =>
  at.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * The white A4 sheet with lines to sign. Mounted only while a sheet is loaded;
 * `printedAt` is set the moment Print is pressed.
 */
export function SheetPrintCopy({ sheet, printedAt }: { sheet: DailySheet; printedAt: Date }): JSX.Element | null {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const columns = columnsOf(sheet);
  const extraNotes = sheet.notes.slice(1).filter((n) => !isAdjustNote(n));
  const adjustNote = sheet.notes.find(isAdjustNote);

  return createPortal(
    <div data-sheet-print="" className="hidden print:block">
      <style>{PRINT_CSS}</style>
      <div style={{ fontSize: '14pt', fontWeight: 700 }}>{sheet.title}</div>
      <div>{sheet.shop.name} · {sheet.branch.name}</div>
      <div style={{ fontWeight: 700 }}>{sheet.dayLabel}</div>
      <div>
        {sheet.status === 'CLOSED'
          ? `From ${sheet.window.fromLabel} to ${sheet.window.toLabel}`
          : `Running totals as of ${sheet.window.toLabel} (not closed yet)`}
      </div>
      {extraNotes.map((note) => <div key={note}>{note}</div>)}

      <table>
        <thead>
          <tr>
            <th scope="col">Item</th>
            {columns.map(([key, label]) => <th key={key} scope="col">{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {sheet.sections.flatMap((section) => [
            <tr key={`section-${section.key}`} className="sheet-section">
              <td colSpan={columns.length + 1}>{section.title}</td>
            </tr>,
            ...section.rows.map((row) => (
              <tr key={row.rawMaterialId}>
                <th scope="row">
                  {row.name}
                  {row.alsoOn.length > 0 && <span style={{ color: '#555' }}> (also on {row.alsoOn.join(', ')})</span>}
                </th>
                {columns.map(([key]) => <td key={key}>{cellText(row, key)}</td>)}
              </tr>
            )),
          ])}
        </tbody>
      </table>

      <div style={{ marginTop: '16pt', display: 'flex', gap: '18pt', flexWrap: 'wrap' }}>
        <span>Prepared by: ____________________</span>
        <span>Signature: ____________________</span>
        <span>Checked by: ____________________</span>
      </div>
      <div style={{ marginTop: '8pt', color: '#333' }}>Printed {manilaTime(printedAt)} from Clerque.</div>
      {adjustNote && <div style={{ color: '#333' }}>{adjustNote}</div>}
    </div>,
    document.body,
  );
}

/** Print the loaded sheet, stamping the copy with the moment Print was pressed. */
export function usePrintSheet(): { printedAt: Date; print: () => void } {
  const [printedAt, setPrintedAt] = useState(() => new Date());
  useEffect(() => {
    // The browser's own Print (Ctrl+P) stamps the time too.
    const stamp = () => setPrintedAt(new Date());
    window.addEventListener('beforeprint', stamp);
    return () => window.removeEventListener('beforeprint', stamp);
  }, []);
  return {
    printedAt,
    print: () => {
      // Rendered before the print dialog reads the page, so the copy carries this moment.
      flushSync(() => setPrintedAt(new Date()));
      window.print();
    },
  };
}

// ─── "Thrown out" ────────────────────────────────────────────────────────────

/**
 * What was thrown out, in the item's own unit: an amount, a reason, and a note
 * if there is one to add. The pack button is for the things bought by the pack
 * -- a whole 1 L of milk soured is one tap, not "1000" typed with wet hands.
 *
 * The tap key is the same one every station tap sends, so a double-tap or a
 * retry after the signal dropped takes the milk off once (station-taps.ts).
 * Amounts only: a kitchen or bar screen is never shown what it cost.
 */
function ThrowOutDialog({ stationId, row, onClose }: { stationId: string; row: DailySheetRow; onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const key = useRef(newTapKey());
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<WasteReason | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const body = wasteRequest({ rawMaterialId: row.rawMaterialId, amount, reason, note, key: key.current });
  const typed = parseWasteAmount(amount);
  const packs = typed == null ? null : inPacks(typed, row.unit, row.packSize);
  const packLabel = packButtonLabel(row.packSize, row.unit);

  async function save() {
    if (!body || saving) return;
    setSaving(true);
    try {
      const res = await api.post<{ message: string; warning: string | null }>(`/kds/stations/${stationId}/waste`, body);
      // Recorded: the next entry is a new one.
      key.current = newTapKey();
      toast.success(res.data.message);
      // Orders still waiting may now be short of it -- quantities only, and the cook can go and look.
      if (res.data.warning) toast.warning(res.data.warning, { duration: 10_000 });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['station-sheet', stationId] }),
        qc.invalidateQueries({ queryKey: ['kds-prep', stationId] }),
      ]);
      onClose();
    } catch (e) {
      // A refusal ("the books show only 1.2 L") recorded nothing, so the next Save is a new try.
      if (!keepTapKey(tapFailure(e).status)) key.current = newTapKey();
      toast.error(tapFailureText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Thrown out, ${row.name}`}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4 print:hidden">
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-t-2xl bg-stone-900 p-4 text-white sm:rounded-2xl">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">Thrown out</p>
            <p className="truncate text-sm text-stone-400">{row.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex min-h-11 shrink-0 items-center rounded-xl bg-stone-800 px-3 text-sm font-semibold hover:bg-stone-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <label htmlFor="waste-amount" className="mt-4 block text-sm font-semibold text-stone-300">
          How much was thrown out?
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            id="waste-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            className="min-h-14 w-full rounded-xl border border-stone-700 bg-stone-950 px-3 text-2xl font-bold tabular-nums text-white outline-none focus:border-amber-500"
          />
          <span className="shrink-0 text-lg font-semibold text-stone-400">{row.unit}</span>
        </div>
        {packLabel && (
          <button type="button" onClick={() => setAmount(addPack(amount, row.packSize ?? 0))}
            className="mt-2 min-h-11 rounded-xl border border-stone-700 px-3 text-sm font-semibold text-stone-200 hover:bg-stone-800">
            {packLabel}
          </button>
        )}
        {packs && <p className="mt-1 text-xs text-stone-400">That is {packs}.</p>}

        <p className="mt-4 text-sm font-semibold text-stone-300">Why?</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {WASTE_REASONS.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => setReason(r.code)}
              aria-pressed={reason === r.code}
              className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors ${
                reason === r.code ? 'bg-amber-500 text-stone-950' : 'border border-stone-700 text-stone-200 hover:bg-stone-800'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <label htmlFor="waste-note" className="mt-4 block text-sm font-semibold text-stone-300">
          Anything to add? <span className="font-normal text-stone-500">(not required)</span>
        </label>
        <input
          id="waste-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          autoComplete="off"
          placeholder="Left out overnight"
          className="mt-1.5 min-h-12 w-full rounded-xl border border-stone-700 bg-stone-950 px-3 text-base text-white outline-none focus:border-amber-500"
        />

        <button
          type="button"
          onClick={save}
          disabled={!body || saving}
          className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 text-lg font-bold text-stone-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
        >
          {saving && <Loader2 className="h-5 w-5 animate-spin" />}
          {body ? 'Record it' : typed == null ? 'Enter how much' : 'Pick why'}
        </button>
        <p className="mt-2 text-center text-xs leading-snug text-stone-500">
          This takes it off the stock and puts it in the Waste column. Tapping twice does not record it twice.
        </p>
      </div>
    </div>
  );
}

// ─── On the station screen ───────────────────────────────────────────────────

export function StationInventorySheet({ stationId, open, onClose }: { stationId: string; open: boolean; onClose: () => void }): JSX.Element | null {
  // Null is the server's default: the sheet running now, or tonight's for a while after closing.
  const [day, setDay] = useState<string | null>(null);
  // The row whose "Thrown out" was tapped, if any.
  const [throwOut, setThrowOut] = useState<DailySheetRow | null>(null);
  const { printedAt, print } = usePrintSheet();

  const { data: sheet, isPending, isError, error, isFetching } = useQuery<DailySheet>({
    queryKey: ['station-sheet', stationId, day ?? 'default'],
    queryFn:  () => api.get(`/kds/stations/${stationId}/daily-inventory${day ? `?day=${day}` : ''}`).then((r) => r.data),
    enabled:  open && !!stationId,
    // A running sheet keeps up with the kitchen; a closed one never changes.
    refetchInterval: (q) => (q.state.data?.status === 'LIVE' ? 60_000 : false),
    // Keep the day on screen while the next one loads, rather than flashing empty.
    placeholderData: keepPreviousData,
  });

  // Escape closes, as any full-screen panel does -- the "Thrown out" box first.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (throwOut) setThrowOut(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, throwOut]);

  // Opened again later, it starts on the current sheet, with nothing half-typed.
  useEffect(() => { if (!open) { setDay(null); setThrowOut(null); } }, [open]);
  // Stepping back to an earlier day closes it: waste is only recorded on the running sheet.
  useEffect(() => { setThrowOut(null); }, [day]);

  if (!open) return null;

  const barButton = 'flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors disabled:opacity-40';
  const message = isError ? sheetErrorMessage(error) : null;
  /*
    Waste is recorded on the day it happens, so only the running sheet offers
    it -- an earlier day is closed, and its numbers no longer move. A sheet
    with no station of its own (the owner's copy) never offers it.
  */
  const recordable = !!sheet && sheet.status === 'LIVE' && !!sheet.station && sheet.day === sheet.today;

  return (
    <>
      <div role="dialog" aria-modal="true" aria-label="Today's inventory" className="fixed inset-0 z-50 overflow-y-auto bg-stone-950 text-white print:hidden">
        <div className="sticky top-0 z-20 border-b border-stone-800 bg-stone-900 px-3 py-2 sm:px-6">
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            <button
              type="button"
              onClick={() => sheet?.previousDay && setDay(sheet.previousDay)}
              disabled={!sheet?.previousDay}
              aria-label={sheet?.previousDayLabel ? `Previous day, ${sheet.previousDayLabel}` : 'Previous day'}
              className={`${barButton} bg-stone-800 text-stone-100 hover:bg-stone-700`}
            >
              <ChevronLeft className="h-5 w-5" />
              <span className="hidden md:inline">{sheet?.previousDayLabel}</span>
            </button>

            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-base font-bold sm:text-lg">{sheet?.title ?? "Today's inventory"}</p>
              <p className="flex items-center justify-center gap-1.5 truncate text-xs text-stone-400">
                {isFetching && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
                <span className="truncate">
                  {sheet ? `${sheet.dayLabel} · ${sheet.status === 'LIVE' ? 'Running' : 'Closed'}` : 'Loading…'}
                </span>
              </p>
            </div>

            {sheet?.nextDay && (
              <button
                type="button"
                onClick={() => setDay(sheet.nextDay)}
                aria-label={`Next day, ${sheet.nextDayLabel}`}
                className={`${barButton} bg-stone-800 text-stone-100 hover:bg-stone-700`}
              >
                <span className="hidden md:inline">{sheet.nextDayLabel}</span>
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
            <button type="button" onClick={print} disabled={!sheet} className={`${barButton} bg-amber-500 text-stone-950 hover:bg-amber-400`}>
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Print</span>
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className={`${barButton} bg-stone-800 text-stone-100 hover:bg-stone-700`}>
              <X className="h-5 w-5" />
              <span className="hidden sm:inline">Close</span>
            </button>
          </div>
        </div>

        <div className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6">
          {isPending ? (
            <p className="flex items-center justify-center gap-2 py-24 text-stone-400">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading the sheet…
            </p>
          ) : !sheet ? (
            <div className="mx-auto max-w-md py-24 text-center">
              <p className="text-lg font-semibold">Could not load the sheet.</p>
              <p className="mt-1 text-sm text-stone-400">{message ?? 'Check the connection and try again.'}</p>
              {day && (
                <button type="button" onClick={() => setDay(null)} className="mt-4 min-h-11 rounded-xl bg-stone-800 px-4 text-sm font-semibold hover:bg-stone-700">
                  Back to the current sheet
                </button>
              )}
            </div>
          ) : (
            <>
              {isError && (
                <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-200">
                  {message ?? 'Could not refresh the sheet.'} Showing what was loaded last.
                </p>
              )}
              {sheet.notes.length > 0 && (
                <ul className="space-y-1 text-sm text-amber-200">
                  {sheet.notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
              )}
              {/*
                A closed sheet with a newer one behind it: the day was closed by its
                last shift (or by the clock), and this is still the default sheet for a
                while so staff finishing up see tonight's. The cook who opens it later
                gets the running one in one tap -- with its "Thrown out" buttons -- not
                the arrows to work out which day is which.
              */}
              {sheet.status === 'CLOSED' && sheet.today !== sheet.day && (
                <button
                  type="button"
                  onClick={() => setDay(sheet.today)}
                  className="flex min-h-12 items-center gap-2 rounded-xl bg-amber-500 px-4 text-base font-semibold text-stone-950 transition-colors hover:bg-amber-400"
                >
                  <ChevronRight className="h-5 w-5" />
                  Open today&apos;s running sheet
                </button>
              )}
              <SheetTables sheet={sheet} tone="dark" onThrowOut={recordable ? setThrowOut : undefined} />
            </>
          )}
        </div>
      </div>
      {throwOut && recordable && (
        <ThrowOutDialog stationId={stationId} row={throwOut} onClose={() => setThrowOut(null)} />
      )}
      {sheet && <SheetPrintCopy sheet={sheet} printedAt={printedAt} />}
    </>
  );
}
