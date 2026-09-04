'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Camera, Sparkles, Loader2, Plus, Trash2, Check, AlertTriangle, PackageCheck, Receipt, RotateCcw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';

/**
 * A receipt photo in, stock and expenses out.
 *
 * The owner is back from the market with a receipt and a boot full of
 * groceries. This is the one screen that turns the receipt into stock: take
 * the photo, let the reader fill the lines in, correct what it got wrong,
 * post. The reader is optional -- every line can be typed by hand, and a shop
 * without AI on its plan gets the same screen minus one button.
 *
 * Nothing is posted from the photo alone. What the person confirms is what
 * lands, through exactly the path a hand-typed purchase request takes.
 */

interface Ingredient { id: string; name: string; unit: string; category: string }

interface Suggested {
  index: number;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  kind: 'ingredient' | 'supply' | 'expense';
  expenseCategory: string | null;
  confidence: number;
  match: { rawMaterialId: string; name: string; unit: string; score: number } | null;
  alternatives: Array<{ rawMaterialId: string; name: string; unit: string; score: number }>;
  pack: { packsBought: number | null; packSize: number | null; packCost: number | null; needsPackSize: boolean; note: string | null } | null;
}

interface Reads { usedToday: number; limit: number; resetsAt: string }
interface ParseResult {
  vendor: string | null; dateText: string | null; dateIso: string | null;
  referenceNumber: string | null; total: number | null;
  lines: Suggested[];
  summary: { lines: number; matched: number; unmatched: number; expenses: number; needsPack: number; linesTotal: number; footsToTotal: boolean | null };
  reads?: Reads;
}

type LineKind = 'stock' | 'expense' | 'skip';
const EXPENSE_CATEGORIES = ['SUPPLIES', 'TRANSPORT', 'REPAIRS', 'UTILITIES', 'RENT', 'OTHER'] as const;
const NEW_CATEGORIES = [
  { v: 'INGREDIENT',     label: 'Ingredient (goes into recipes)' },
  { v: 'KITCHEN_SUPPLY', label: 'Kitchen supply (cleaning, packaging)' },
  { v: 'BAR_SUPPLY',     label: 'Bar supply' },
  { v: 'OFFICE_SUPPLY',  label: 'Office supply' },
] as const;

interface Row {
  key: string;
  description: string;
  kind: LineKind;
  rawMaterialId: string;
  createNew: boolean;
  newName: string;
  newUnit: string;
  newCategory: (typeof NEW_CATEGORIES)[number]['v'];
  packs: string;
  size: string;
  cost: string;
  brand: string;
  amount: string;
  category: (typeof EXPENSE_CATEGORIES)[number];
  acceptCostChange: boolean;
  note: string | null;
  confidence: number | null;
  /** How sure the MATCH is (not the reading). Below 0.85 it is a guess and looks like one. */
  score: number | null;
  printedQty: number | null;
  printedUnit: string | null;
  fromReader: boolean;
  failedReason: string | null;
  alternatives: Suggested['alternatives'];
}

const blankRow = (): Row => ({
  key: Math.random().toString(36).slice(2),
  description: '', kind: 'stock', rawMaterialId: '', createNew: false,
  newName: '', newUnit: 'g', newCategory: 'INGREDIENT',
  packs: '1', size: '', cost: '', brand: '', amount: '', category: 'OTHER',
  acceptCostChange: false, note: null, confidence: null, score: null, printedQty: null, printedUnit: null,
  fromReader: false, failedReason: null, alternatives: [],
});

/** "P195", "₱1,250", "1 250.50" -> the number; anything else -> NaN, which the checks below name. */
const num = (s: string) => { const n = parseFloat(String(s ?? '').replace(/[₱Pp,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };
const pos = (s: string) => { const n = num(s); return Number.isFinite(n) && n > 0 ? n : 0; };
/** A tiny mirror of the API's conversion table, for the hint when a person re-picks an ingredient. */
const UNIT_BASE: Record<string, { fam: 'mass' | 'volume'; per: number }> = {
  g: { fam: 'mass', per: 1 }, kg: { fam: 'mass', per: 1000 }, ml: { fam: 'volume', per: 1 }, l: { fam: 'volume', per: 1000 },
};
const factorBetween = (from: string | null, to: string | null): number | null => {
  const a = from ? UNIT_BASE[from.toLowerCase()] : null; const b = to ? UNIT_BASE[to.toLowerCase()] : null;
  if (!a || !b || a.fam !== b.fam) return null;
  return +(a.per / b.per).toFixed(4);
};
const mintKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()));
const todayPH = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/**
 * A phone photo is 3-5 MB and the reader does not need it: 1600 px on the
 * long side reads every line on a till receipt and ships in well under a
 * megabyte. Done here so the same bytes go to the reader and into the file.
 */
async function shrinkToBase64(file: File): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open that photo.')); i.src = url;
    });
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ReceiptsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';

  const [photo, setPhoto] = useState<{ base64: string; mediaType: 'image/jpeg'; previewUrl: string } | null>(null);
  // One key per receipt being entered -- photo or not. A retry after a lost
  // response resends it and gets the first result back instead of a second
  // delivery. It changes only on Start over / Another receipt.
  const [idemKey, setIdemKey] = useState<string>(() => mintKey());
  const [rows, setRows] = useState<Row[]>([]);
  const [vendor, setVendor] = useState('');
  const [date, setDate] = useState(todayPH());
  const [ref, setRef] = useState('');
  const [paidBy, setPaidBy] = useState<'CASH' | 'OWNER_FUNDED'>('OWNER_FUNDED');
  const [branchId, setBranchId] = useState<string>(user?.branchId ?? '');
  const [reading, setReading] = useState<ParseResult | null>(null);
  const [result, setResult] = useState<any>(null);
  const takeRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLInputElement>(null);

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['raw-materials'],
    queryFn:  () => api.get('/inventory/raw-materials').then((r) => r.data),
    enabled:  !!user,
    staleTime: 60_000,
  });
  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
    enabled:  !!user,
    staleTime: 300_000,
  });
  // An owner or MDM with no branch on their account still has to post
  // somewhere. Default to the first branch, and show the picker whenever
  // the choice is not already made for them.
  useEffect(() => { if (!branchId && branches[0]) setBranchId(branches[0].id); }, [branches, branchId]);
  const showBranch = branches.length > 1 || (!user?.branchId && branches.length > 0);
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  // Today's reads and the cap, so the wall is never a surprise. Fails quiet:
  // a shop whose plan has no AI simply sees no count.
  const { data: reads } = useQuery<Reads>({
    queryKey: ['receipt-reads'],
    queryFn:  () => api.get('/procure/receipts/reads').then((r) => r.data),
    enabled:  !!user,
    staleTime: 30_000,
    retry: false,
  });
  const readsLeft = reads ? Math.max(0, reads.limit - reads.usedToday) : null;

  const fail = (e: unknown, fallback: string) => {
    const msg = (e as any)?.response?.data?.message;
    toast.error(Array.isArray(msg) ? msg.join(' ') : (msg ?? fallback));
  };

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const shrunk = await shrinkToBase64(file);
      setPhoto({ ...shrunk, previewUrl: `data:image/jpeg;base64,${shrunk.base64}` });
      setReading(null);
      setResult(null);
      if (rows.length === 0) setRows([blankRow()]);
    } catch (err) {
      fail(err, 'Could not open that photo.');
    }
  }

  // ── reading ─────────────────────────────────────────────────────────────
  const hasWork = rows.some((r) => r.description.trim() || r.rawMaterialId || r.amount.trim() || r.cost.trim());
  const read = useMutation({
    mutationFn: () => api.post('/procure/receipts/parse', { imageBase64: photo!.base64, mediaType: photo!.mediaType }).then((r) => r.data as ParseResult),
    onSuccess: (r) => {
      setReading(r);
      if (r.reads) qc.setQueryData(['receipt-reads'], r.reads);
      if (r.vendor) setVendor(r.vendor);
      if (r.dateIso) setDate(r.dateIso);
      if (r.referenceNumber) setRef(r.referenceNumber);
      const readRows: Row[] = r.lines.map((l) => {
        const isExpense = l.kind === 'expense';
        const m = l.match;
        return {
          ...blankRow(),
          description: l.description,
          kind: isExpense ? 'expense' : 'stock',
          rawMaterialId: m?.rawMaterialId ?? '',
          packs: l.pack?.packsBought != null ? String(l.pack.packsBought) : (l.quantity != null && l.quantity > 0 ? String(l.quantity) : '1'),
          size:  l.pack?.packSize != null ? String(l.pack.packSize) : '',
          cost:  l.pack?.packCost != null ? String(l.pack.packCost) : '',
          amount: l.lineTotal != null && l.lineTotal > 0 ? String(l.lineTotal) : '',
          category: (EXPENSE_CATEGORIES as readonly string[]).includes(l.expenseCategory ?? '') ? (l.expenseCategory as Row['category']) : 'OTHER',
          note: l.pack?.note ?? null,
          confidence: l.confidence,
          score: m?.score ?? null,
          printedQty: l.quantity,
          printedUnit: l.unit,
          fromReader: true,
          alternatives: l.alternatives,
        };
      });
      // A second reading replaces only what the first reading wrote. Lines the
      // person added by hand stay.
      setRows((prev) => [...readRows, ...prev.filter((x) => !x.fromReader)]);
      const s = r.summary;
      toast.success(`Read ${s.lines} line${s.lines === 1 ? '' : 's'} — ${s.matched} matched${s.unmatched ? `, ${s.unmatched} to pick` : ''}${s.needsPack ? `, ${s.needsPack} need a pack size` : ''}.`);
    },
    onError: (e: any) => {
      // Any failed read may still have spent a read (a photo the provider
      // read but nobody could parse), so the count is refreshed every time.
      qc.invalidateQueries({ queryKey: ['receipt-reads'] });
      const code = e?.response?.data?.code;
      if (code === 'RECEIPT_READS_EXHAUSTED') {
        toast.message(e?.response?.data?.message ?? "Today's receipt reads are used up. Type the lines in, or read again after midnight.");
        return;
      }
      if (code === 'AI_DISABLED' || code === 'AI_NOT_ENABLED' || code === 'AI_QUOTA_EXCEEDED' || e?.response?.status === 503) {
        toast.message('The reader is not available on this account. Type the lines in by hand below — posting works the same.');
        return;
      }
      fail(e, 'Could not read the receipt. Try a sharper photo, or type the lines in.');
    },
  });

  function readReceipt() {
    const corrected = rows.some((x) => x.fromReader && (x.rawMaterialId || x.cost.trim()));
    if (corrected && !window.confirm('Read again? The lines the reader filled in will be replaced; lines you added by hand stay.')) return;
    read.mutate();
  }

  // ── posting ─────────────────────────────────────────────────────────────
  const post = useMutation({
    mutationFn: () => {
      const lines = rows.filter((r) => r.kind === 'stock').map((r) => ({
        ...(r.createNew
          ? { create: { name: r.newName.trim(), unit: r.newUnit.trim(), category: r.newCategory } }
          : { rawMaterialId: r.rawMaterialId }),
        packsBought: pos(r.packs),
        packSize:    pos(r.size),
        packCost:    pos(r.cost),
        ...(r.brand.trim() ? { brandNote: r.brand.trim() } : {}),
        ...(r.acceptCostChange ? { acceptCostChange: true } : {}),
      }));
      const expenses = rows.filter((r) => r.kind === 'expense').map((r) => ({
        description: r.description.trim() || 'Expense', amount: pos(r.amount), category: r.category,
      }));
      return api.post('/procure/receipts/confirm', {
        ...(branchId ? { branchId } : {}),
        ...(vendor.trim() ? { vendor: vendor.trim() } : {}),
        receiptDate: date,
        ...(ref.trim() ? { referenceNumber: ref.trim() } : {}),
        paymentMethod: paidBy,
        lines, expenses,
        ...(photo ? { imageBase64: photo.base64, mediaType: photo.mediaType } : {}),
        ...(idemKey ? { idempotencyKey: idemKey } : {}),
      }).then((r) => r.data);
    },
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['raw-materials'] });
      qc.invalidateQueries({ queryKey: ['procure-low'] });
      if (r.duplicate) toast.message('This receipt was already posted. Nothing was added twice.');
      else if (r.failed?.length) toast.warning(`${r.posted.length} posted, ${r.failed.length} could not be — see below.`);
      else toast.success('In stock. The receipt is filed with the request.');
    },
    onError: (e) => {
      // A refusal on line 2 can leave line 1's new ingredient created; make
      // sure the list shows it so the retry can pick it instead of recreating.
      qc.invalidateQueries({ queryKey: ['raw-materials'] });
      fail(e, 'Could not post this receipt.');
    },
  });

  // ── validation, in words the person can act on ───────────────────────────
  const problems = useMemo(() => {
    const out: string[] = [];
    if (rows.every((r) => r.kind === 'skip')) out.push('Add at least one line.');
    // Numbered the way the screen numbers them -- skipped rows included --
    // so "Line 4" is the fourth thing the person sees.
    rows.forEach((r, i) => {
      if (r.kind === 'skip') return;
      const n = i + 1;
      const bad = (s: string) => s.trim() !== '' && Number.isNaN(num(s));
      if (r.kind === 'stock') {
        if (r.createNew ? !r.newName.trim() : !r.rawMaterialId) out.push(`Line ${n}: pick which ingredient this is, or create it.`);
        if (bad(r.packs) || bad(r.size) || bad(r.cost)) out.push(`Line ${n}: one of the numbers is not a number.`);
        if (!(pos(r.packs) > 0)) out.push(`Line ${n}: how many were bought?`);
        if (!(pos(r.size) > 0)) out.push(`Line ${n}: what does one hold, in ${r.createNew ? r.newUnit || 'its unit' : (byId.get(r.rawMaterialId)?.unit ?? 'its unit')}?`);
        if (!(pos(r.cost) > 0)) out.push(`Line ${n}: what did one cost? (a free item goes in through Stock on hand)`);
      } else if (bad(r.amount) || !(pos(r.amount) > 0)) {
        out.push(`Line ${n}: how much was this expense?`);
      }
    });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) out.push('The receipt date needs to be a real date.');
    return out;
  }, [rows, date, byId]);

  const stockTotal   = rows.filter((r) => r.kind === 'stock').reduce((s, r) => s + pos(r.packs) * pos(r.cost), 0);
  const expenseTotal = rows.filter((r) => r.kind === 'expense').reduce((s, r) => s + pos(r.amount), 0);
  const total = stockTotal + expenseTotal;
  const readTotal = reading?.total ?? null;
  const offBy = readTotal != null ? total - readTotal : null;

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  function reset(ask = true) {
    if (ask && hasWork && !result && !window.confirm(`Throw away the ${rows.length} line${rows.length === 1 ? '' : 's'} on screen?`)) return;
    setPhoto(null); setIdemKey(mintKey()); setRows([]); setVendor(''); setDate(todayPH()); setRef('');
    setReading(null); setResult(null);
  }

  /** Back to the lines with the same key: the replay applies the corrections. */
  function fixAndRetry() {
    const failedNames = new Set<string>((result?.failed ?? []).map((f: any) => f.name));
    setRows((prev) => prev.map((r) => {
      const name = r.createNew ? r.newName : (byId.get(r.rawMaterialId)?.name ?? '');
      const hit = (result?.failed ?? []).find((f: any) => f.name === name);
      return { ...r, failedReason: hit ? hit.reason : null };
    }));
    if (failedNames.size === 0) setRows((prev) => prev.map((r) => ({ ...r, failedReason: null })));
    setResult(null);
  }

  // ── done ─────────────────────────────────────────────────────────────────
  if (result) {
    const r = result;
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {r.failed?.length ? <AlertTriangle className="h-5 w-5 text-amber-500" /> : <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
            {r.duplicate ? 'Already posted' : r.failed?.length ? 'Partly posted' : 'Posted'}
            <span className="ml-auto font-mono text-xs text-muted-foreground">{r.request?.requestNumber}</span>
          </div>
          {r.posted?.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {r.posted.map((p: any) => (
                <li key={p.line}>
                  <div className="flex justify-between gap-3">
                    <span>{p.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{p.quantity.toLocaleString()} @ {formatPeso(p.unitCost)}</span>
                  </div>
                  {p.warning && <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">{p.warning}</p>}
                </li>
              ))}
            </ul>
          )}
          {r.expenses?.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
              {r.expenses.map((e: any, i: number) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    {e.description}
                    {e.status === 'PENDING_APPROVAL' && (
                      <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">waiting for approval — not in the books yet</span>
                    )}
                    {e.error && <span className="ml-2 text-xs text-red-600">{e.error}</span>}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatPeso(e.amount)}{e.entryNumber ? ` · ${e.entryNumber}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {r.created?.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              New in your list: {r.created.map((c: any) => c.name).join(', ')}.
            </p>
          )}
          {r.failed?.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
              {r.failed.map((f: any) => <li key={f.line}><strong>{f.name}:</strong> {f.reason}</li>)}
            </ul>
          )}
          {r.skipped?.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">{r.skipped.length} line{r.skipped.length === 1 ? '' : 's'} skipped: {r.skipped.map((s: any) => `${s.name} (${s.reason})`).join('; ')}</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {r.document ? 'The photo is filed with this request.' : photo ? 'The photo could not be filed, but the stock was posted.' : 'No photo was attached.'}
          </p>
        </div>
        {r.failed?.length > 0 && (
          <button onClick={fixAndRetry} className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--accent)]">
            <RotateCcw className="h-4 w-4" /> Fix the {r.failed.length === 1 ? 'line' : `${r.failed.length} lines`} and post again
          </button>
        )}
        <button onClick={() => reset(false)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white">
          <Camera className="h-4 w-4" /> Another receipt
        </button>
      </div>
    );
  }

  // ── the screen ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-28">
      <input ref={takeRef}   type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
      <input ref={chooseRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />

      {/* 1. the photo */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Upload a receipt</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Photograph it flat, whole, in good light. The reader fills the lines in; you correct
              what it got wrong and post. You can also type the lines without a photo.
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => takeRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
            <Camera className="h-4 w-4" /> {photo ? 'Retake' : 'Take a photo'}
          </button>
          <button onClick={() => chooseRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
            Choose a photo
          </button>
          {photo && (
            <button onClick={readReceipt} disabled={read.isPending || readsLeft === 0}
              title={readsLeft === 0 ? "Today's reads are used up" : undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {read.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {read.isPending ? 'Reading…' : reading ? 'Read again' : 'Read the receipt'}
            </button>
          )}
          {(photo || rows.length > 0) && (
            <button onClick={() => reset()} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-4 w-4" /> Start over
            </button>
          )}
        </div>
        {readsLeft != null && (
          <p className={`mt-2 text-[11px] ${readsLeft === 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
            {reads!.limit === 0
              ? 'Receipt reading is switched off for this account. Type the lines in instead.'
              : readsLeft === 0
                ? `Today's ${reads!.limit} receipt reads are used up — type the lines in, or read again after midnight.`
                : `${readsLeft} of ${reads!.limit} receipt reads left today.`}
          </p>
        )}
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.previewUrl} alt="The receipt" className="mt-3 max-h-64 rounded-lg border border-border object-contain" />
        )}
        {reading && reading.summary.footsToTotal === false && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            The lines add to {formatPeso(reading.summary.linesTotal)} but the receipt says {formatPeso(reading.total ?? 0)}. A line may have been missed — check against the paper.
          </p>
        )}
      </div>

      {/* 2. the header */}
      <div className="grid gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-4">
        <label className="text-[11px] text-muted-foreground sm:col-span-2">
          Bought from
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Puregold, the market, Shopee…"
            className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Receipt date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Receipt / OR no.
          <input value={ref} onChange={(e) => setRef(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
        </label>
        {showBranch && (
          <label className="text-[11px] text-muted-foreground sm:col-span-2">
            Received at
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        <div className="sm:col-span-2">
          <p className="text-[11px] text-muted-foreground">Who paid?</p>
          <div className="mt-0.5 grid grid-cols-2 gap-2">
            {([
              { v: 'OWNER_FUNDED', label: 'Owner paid',    sub: 'Out of their own pocket' },
              { v: 'CASH',         label: 'From the till',  sub: 'Cash taken from the drawer' },
            ] as const).map((o) => (
              <button key={o.v} type="button" onClick={() => setPaidBy(o.v)}
                className={`rounded-lg border px-3 py-1.5 text-left ${paidBy === o.v ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-border hover:bg-muted'}`}>
                <span className="block text-xs font-semibold">{o.label}</span>
                <span className="block text-[11px] text-muted-foreground">{o.sub}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. the lines */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Lines</span>
          <button onClick={() => setRows((p) => [...p, blankRow()])} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
            <Plus className="h-3.5 w-3.5" /> Add a line
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Take a photo and read it, or add lines by hand.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r, i) => {
              const ing = byId.get(r.rawMaterialId);
              const unit = r.createNew ? r.newUnit : (ing?.unit ?? '');
              const lineTotal = r.kind === 'stock' ? pos(r.packs) * pos(r.cost) : pos(r.amount);
              return (
                <li key={r.key} className={`px-4 py-3 ${r.kind === 'skip' ? 'opacity-50' : ''}`}>
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5 w-5 shrink-0 text-[11px] text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <input value={r.description} onChange={(e) => update(r.key, { description: e.target.value })}
                          placeholder="As printed on the receipt"
                          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                        {r.confidence != null && r.confidence < 0.7 && (
                          <span title="The reader was not sure it read this line correctly" className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">check the reading</span>
                        )}
                        {r.kind === 'stock' && !r.createNew && r.rawMaterialId && r.score != null && r.score < 0.85 && (
                          <span title="The match to an ingredient is a guess" className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">best guess — check</span>
                        )}
                        <button onClick={() => remove(r.key)} aria-label="Remove line" className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {([['stock', 'Goes on the shelf'], ['expense', 'Not stock — an expense'], ['skip', 'Skip']] as const).map(([k, label]) => (
                          <button key={k} type="button" onClick={() => update(r.key, { kind: k })}
                            className={`rounded-full border px-2.5 py-1 text-[11px] ${r.kind === k ? 'border-[var(--accent)] bg-[var(--accent)]/10 font-semibold' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                            {label}
                          </button>
                        ))}
                      </div>

                      {r.kind === 'stock' && (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            {!r.createNew ? (
                              <select value={r.rawMaterialId} onChange={(e) => {
                                  if (e.target.value === '__new__') { update(r.key, { createNew: true, newName: r.description, score: null }); return; }
                                  /*
                                    A hand pick is a decision, so the guess badge goes; and the
                                    receipt's own unit is not forgotten: a kilo line re-pointed at a
                                    gram-counted ingredient gets 1000 filled in, and a line whose
                                    unit cannot convert gets told so instead of a blank.
                                  */
                                  const chosen = byId.get(e.target.value);
                                  const f = factorBetween(r.printedUnit, chosen?.unit ?? null);
                                  const same = r.printedUnit && chosen && r.printedUnit.toLowerCase() === chosen.unit.toLowerCase();
                                  update(r.key, {
                                    rawMaterialId: e.target.value, score: null, failedReason: null,
                                    size: same ? '1' : f != null ? String(f) : '',
                                    note: chosen && r.printedUnit && !same && f == null
                                      ? `The receipt says ${r.printedQty ?? ''} ${r.printedUnit}; ${chosen.name} is counted in ${chosen.unit}. How many ${chosen.unit} is one ${r.printedUnit}?`
                                      : null,
                                  });
                                }}
                                className={`min-w-0 flex-1 rounded-lg border bg-background px-2 py-1.5 text-sm ${!r.rawMaterialId || (r.score != null && r.score < 0.85) ? 'border-amber-500/60' : 'border-border'}`}>
                                <option value="">Which ingredient is this?</option>
                                {r.alternatives.length > 0 && (
                                  <optgroup label="Closest">
                                    {r.alternatives.map((a) => <option key={a.rawMaterialId} value={a.rawMaterialId}>{a.name} ({a.unit})</option>)}
                                  </optgroup>
                                )}
                                <optgroup label="All">
                                  {ingredients.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
                                </optgroup>
                                <option value="__new__">＋ Not in the list — create it</option>
                              </select>
                            ) : (
                              <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                                <input value={r.newName} onChange={(e) => update(r.key, { newName: e.target.value })} placeholder="Name, no brand"
                                  className="col-span-2 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                                <input value={r.newUnit} onChange={(e) => update(r.key, { newUnit: e.target.value })} placeholder="g / ml / pc"
                                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                                <select value={r.newCategory} onChange={(e) => update(r.key, { newCategory: e.target.value as Row['newCategory'] })}
                                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
                                  {NEW_CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                                </select>
                                <button type="button" onClick={() => update(r.key, { createNew: false })} className="col-span-2 text-left text-[11px] text-muted-foreground hover:text-foreground sm:col-span-4">
                                  Pick from the list instead
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                            <label className="text-[11px] text-muted-foreground">
                              How many
                              <input inputMode="decimal" value={r.packs} onChange={(e) => update(r.key, { packs: e.target.value })}
                                className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                            </label>
                            <label className="text-[11px] text-muted-foreground">
                              One holds{unit ? ` (${unit})` : ''}
                              <input inputMode="decimal" value={r.size} onChange={(e) => update(r.key, { size: e.target.value })}
                                className={`mt-0.5 w-full rounded-lg border bg-background px-2 py-1.5 text-sm ${pos(r.size) > 0 ? 'border-border' : 'border-amber-500/60'}`} />
                            </label>
                            <label className="text-[11px] text-muted-foreground">
                              Price each
                              <input inputMode="decimal" value={r.cost} onChange={(e) => update(r.key, { cost: e.target.value })}
                                className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                            </label>
                            <label className="col-span-3 text-[11px] text-muted-foreground sm:col-span-2">
                              Brand (optional)
                              <input value={r.brand} onChange={(e) => update(r.key, { brand: e.target.value })}
                                className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                            </label>
                          </div>
                          {r.note && (
                            <p className="text-[11px] text-amber-700 dark:text-amber-400">{r.note}</p>
                          )}
                          {r.failedReason && (
                            <p className="rounded-lg border border-red-500/40 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-400">
                              Did not post last time: {r.failedReason}
                            </p>
                          )}
                          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <input type="checkbox" checked={r.acceptCostChange} onChange={(e) => update(r.key, { acceptCostChange: e.target.checked })} />
                            The price really changed a lot (skip the sanity check)
                          </label>
                        </>
                      )}

                      {r.kind === 'expense' && (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[11px] text-muted-foreground">
                            Amount
                            <input inputMode="decimal" value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })}
                              className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                          </label>
                          <label className="text-[11px] text-muted-foreground">
                            What kind
                            <select value={r.category} onChange={(e) => update(r.key, { category: e.target.value as Row['category'] })}
                              className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
                              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c[0] + c.slice(1).toLowerCase()}</option>)}
                            </select>
                          </label>
                        </div>
                      )}

                      {r.kind !== 'skip' && lineTotal > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          {r.kind === 'stock' && <>{pos(r.packs)} × {formatPeso(pos(r.cost))} = </>}
                          <strong className="font-mono text-foreground">{formatPeso(lineTotal)}</strong>
                          {r.kind === 'stock' && pos(r.size) > 0 && <> · {(pos(r.packs) * pos(r.size)).toLocaleString()} {unit} into stock</>}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-mono font-semibold">
              {formatPeso(total)}
              {offBy != null && Math.abs(offBy) >= 1 && (
                <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">receipt says {formatPeso(readTotal!)}</span>
              )}
            </span>
          </div>
        )}
      </div>

      {/* 4. post */}
      <div className="sticky bottom-4 space-y-2">
        {problems.length > 0 && rows.length > 0 && (
          <ul className="rounded-xl border border-border bg-card px-4 py-2 text-xs text-muted-foreground">
            {problems.slice(0, 3).map((p) => <li key={p}>{p}</li>)}
            {problems.length > 3 && <li>…and {problems.length - 3} more</li>}
          </ul>
        )}
        <button
          onClick={() => post.mutate()}
          disabled={post.isPending || problems.length > 0}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-lg disabled:opacity-50"
        >
          {post.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
          Post to stock{expenseTotal > 0 ? ' and the books' : ''}
        </button>
      </div>
    </div>
  );
}
