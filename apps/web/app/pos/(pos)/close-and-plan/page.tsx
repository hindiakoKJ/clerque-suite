'use client';

/**
 * Clerque Cloud — Close & Plan
 *
 * The evening routine for MSME bakery owners. One screen, mobile-first.
 * Sections in vertical order:
 *
 *   1. Today recap (gross sales, orders, shift status)
 *   2. Add deliveries (optional — with live duplicate detection)
 *   3. Tomorrow plan (bake list + use-first perishables + pickups)
 *   4. Print morning briefing
 *
 * Owner opens this at ~10 PM, runs through it in 5-15 minutes, sticks
 * the printed briefing on the kitchen wall. Cook reads it at 5 AM.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList, AlertTriangle, Plus, Printer, Loader2, X, Check,
  Sun, ChefHat, ShoppingBag, Clock, TrendingUp, Package,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

// ─── Types matching the API contract ────────────────────────────────
interface BakeItem    { productName: string; recommendedQty: number; reason?: string; unit?: string }
interface UseFirstItem {
  rawMaterialName: string; lotCode: string; qtyRemaining: number; unit: string;
  expirationDate: string | null;
  tier: 'USE_FIRST' | 'EXPIRING_SOON' | 'EXPIRED' | 'NORMAL';
}
interface Pickup { time: string; customerName: string; details: string }
interface DaySummary {
  date:                 string;
  bakeryName:           string;
  grossSalesCents:      number;
  netSalesCents:        number;
  orderCount:           number;
  voidCount:            number;
  varianceCents:        number | null;
  shiftStatus:          'OPEN' | 'CLOSED' | 'NONE';
  bakeListTomorrow:     BakeItem[];
  useFirstTomorrow:     UseFirstItem[];
  pickupsTomorrow:      Pickup[];
  pickupsCount:         number;
  stickersNeedingReprint: number;
}

interface RawMaterial { id: string; name: string; unit?: string | null; costPrice?: number }

interface DupeCandidate {
  id:               string;
  rawMaterialName:  string;
  qtyReceived:      number;
  qtyRemaining:     number;
  expirationDate:   string | null;
  receivedAt:       string;
  ageMinutes:       number;
  score:            number;
}

interface ReceiveLineDraft {
  key:             string;
  rawMaterialId:   string;
  rawMaterialName: string;
  qtyReceived:     number;
  unitCost:        number;
  expirationDate:  string;
  referenceNumber: string;
  unit?:           string;
  // soft-warning UI state
  dupesPending?:   DupeCandidate[];
  dupeOverride?:   boolean;
  saved?:          boolean;
  savedLotId?:     string;
  savedTier?:      string;
}

// ─── Helpers ───────────────────────────────────────────────────────
const peso = (cents: number) =>
  '₱' + (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function todayYmdPh(): string {
  const off = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + off).toISOString().slice(0, 10);
}

// ─── Component ─────────────────────────────────────────────────────
export default function CloseAndPlanPage() {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? '';
  const qc = useQueryClient();
  const [date] = useState(todayYmdPh());

  // ── Day summary ──
  const summaryQ = useQuery<DaySummary>({
    queryKey: ['close-and-plan', 'summary', branchId, date],
    enabled:  !!branchId,
    queryFn:  () => api.get('/close-and-plan/summary', { params: { branchId, date } }).then((r) => r.data),
    staleTime: 60_000,
  });

  // ── Raw materials for the picker ──
  const materialsQ = useQuery<RawMaterial[]>({
    queryKey: ['raw-materials', branchId],
    enabled:  !!branchId,
    queryFn:  () => api.get('/inventory/raw-materials').then((r) => r.data),
    staleTime: 300_000,
  });

  // ── Add-delivery state ──
  const [drafts, setDrafts] = useState<ReceiveLineDraft[]>([]);
  const [showAddRow, setShowAddRow] = useState(false);
  const [picker, setPicker] = useState({
    rawMaterialId:  '',
    qtyReceived:    1,
    unitCost:       0,
    expirationDate: '',
    referenceNumber:'',
  });

  const addDraft = async () => {
    if (!picker.rawMaterialId || picker.qtyReceived <= 0) return;
    const material = materialsQ.data?.find((m) => m.id === picker.rawMaterialId);
    if (!material) return;
    // Live duplicate check
    let dupes: DupeCandidate[] = [];
    try {
      const r = await api.post('/close-and-plan/check-duplicate', {
        branchId,
        rawMaterialId:  picker.rawMaterialId,
        qtyReceived:    picker.qtyReceived,
        expirationDate: picker.expirationDate || null,
      });
      dupes = r.data;
    } catch {
      /* check is best-effort; if it errors, just proceed */
    }
    setDrafts((d) => [
      ...d,
      {
        key:             `${Date.now()}-${Math.random()}`,
        rawMaterialId:   picker.rawMaterialId,
        rawMaterialName: material.name,
        qtyReceived:     picker.qtyReceived,
        unitCost:        picker.unitCost,
        expirationDate:  picker.expirationDate,
        referenceNumber: picker.referenceNumber,
        unit:            material.unit ?? '',
        dupesPending:    dupes.length > 0 ? dupes : undefined,
      },
    ]);
    setPicker({ rawMaterialId: '', qtyReceived: 1, unitCost: 0, expirationDate: '', referenceNumber: '' });
    setShowAddRow(false);
  };

  const removeDraft = (key: string) => setDrafts((d) => d.filter((x) => x.key !== key));
  const overrideDupe = (key: string) =>
    setDrafts((d) => d.map((x) => x.key === key ? { ...x, dupesPending: undefined, dupeOverride: true } : x));

  // ── Batch save ──
  const saveM = useMutation({
    mutationFn: async () => {
      const r = await api.post('/close-and-plan/batch-receive', {
        branchId,
        lines: drafts.filter((d) => !d.saved).map((d) => ({
          rawMaterialId:   d.rawMaterialId,
          qtyReceived:     d.qtyReceived,
          unitCost:        d.unitCost,
          expirationDate:  d.expirationDate || null,
          referenceNumber: d.referenceNumber || undefined,
          dupeOverride:    !!d.dupeOverride,
        })),
      });
      return r.data;
    },
    onSuccess: (res) => {
      // Mark saved + tier
      setDrafts((d) => d.map((x) => {
        const hit = res.saved?.find((s: any) => s.rawMaterialId === x.rawMaterialId);
        return hit ? { ...x, saved: true, savedLotId: hit.lotId, savedTier: hit.stickerTier } : x;
      }));
      qc.invalidateQueries({ queryKey: ['close-and-plan', 'summary'] });
    },
  });

  // ── Print briefing ──
  const printM = useMutation({
    mutationFn: async () => {
      const r = await api.post('/close-and-plan/briefing/print', { branchId, date });
      return r.data as { base64: string; length: number };
    },
    onSuccess: (data) => {
      // Browser-side: pop a preview tab with the plain-text version so
      // the user can verify before sending to a printer.
      api.get('/close-and-plan/briefing/text', { params: { branchId, date } })
        .then((r) => {
          const w = window.open('', '_blank');
          if (w) {
            w.document.write(`<pre style="font-family:'Courier New',monospace;font-size:14px;line-height:1.4;white-space:pre">${
              (r.data.text as string).replace(/</g, '&lt;')
            }</pre>`);
            w.document.title = 'Morning Briefing';
            setTimeout(() => w.print(), 500);
          }
        });
    },
  });

  if (!branchId) {
    return <div className="p-8 text-muted-foreground">Select a branch first.</div>;
  }

  const s = summaryQ.data;
  const pendingDupes = drafts.filter((d) => d.dupesPending && d.dupesPending.length > 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 pb-32">
      {/* ── Header ── */}
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-amber-700">
          <Sun className="h-5 w-5" />
          <span className="text-xs uppercase tracking-wide font-semibold">Evening routine</span>
        </div>
        <h1 className="text-3xl font-bold text-foreground">Close &amp; Plan</h1>
        <p className="text-sm text-muted-foreground">
          Take 5-15 minutes to wrap up today and prep tomorrow. The printed briefing goes on the kitchen wall.
        </p>
      </header>

      {/* ── Section 1: Today recap ── */}
      <section className="rounded-2xl border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Today recap</h2>
        </div>
        {summaryQ.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : !s ? (
          <div className="text-sm text-muted-foreground">No data yet for today.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Gross sales" value={peso(s.grossSalesCents)} highlight />
            <Stat label="Orders"      value={String(s.orderCount)} />
            <Stat label="Voids"       value={String(s.voidCount)} />
            <Stat label="Shift"       value={s.shiftStatus === 'OPEN' ? 'Open' : s.shiftStatus === 'CLOSED' ? 'Closed' : '—'} />
          </div>
        )}
      </section>

      {/* ── Section 2: Add deliveries ── */}
      <section className="rounded-2xl border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Today's deliveries</h2>
          </div>
          <span className="text-xs text-muted-foreground">{drafts.length} item{drafts.length === 1 ? '' : 's'} pending</span>
        </div>

        {/* Drafts list */}
        {drafts.length === 0 && !showAddRow && (
          <p className="text-sm text-muted-foreground italic">
            No deliveries to record today? You can skip this section.
          </p>
        )}
        <ul className="space-y-2">
          {drafts.map((d) => (
            <li key={d.key} className={`rounded-xl border p-3 ${d.saved ? 'bg-emerald-50 border-emerald-200' : 'bg-background'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">{d.rawMaterialName}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.qtyReceived} {d.unit} · {peso(d.unitCost * 100)}/{d.unit ?? 'unit'}
                    {d.expirationDate ? ` · exp ${d.expirationDate}` : ''}
                  </div>
                </div>
                {d.saved ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-700">
                    <Check className="h-4 w-4" /> Saved {d.savedTier === 'USE_FIRST' ? '(USE FIRST!)' : ''}
                  </span>
                ) : (
                  <button onClick={() => removeDraft(d.key)} className="text-muted-foreground hover:text-red-500">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Duplicate warning */}
              {d.dupesPending && d.dupesPending.length > 0 && (
                <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm space-y-2">
                  <div className="flex items-center gap-1 font-semibold text-amber-800">
                    <AlertTriangle className="h-4 w-4" /> Possible duplicate
                  </div>
                  <p className="text-amber-900">
                    You already entered a similar receive {Math.round(d.dupesPending[0].ageMinutes)} min ago:
                    &nbsp;{d.dupesPending[0].qtyReceived} {d.unit}
                    {d.dupesPending[0].expirationDate ? `, exp ${d.dupesPending[0].expirationDate.slice(0, 10)}` : ''}.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => removeDraft(d.key)}
                      className="flex-1 rounded-lg bg-amber-100 text-amber-800 py-2 text-sm font-medium hover:bg-amber-200"
                    >
                      Skip — it was a duplicate
                    </button>
                    <button
                      onClick={() => overrideDupe(d.key)}
                      className="flex-1 rounded-lg bg-amber-700 text-white py-2 text-sm font-medium hover:bg-amber-800"
                    >
                      It's real — save anyway
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {/* Add row */}
        {showAddRow ? (
          <div className="rounded-xl border bg-background p-3 space-y-3">
            <select
              value={picker.rawMaterialId}
              onChange={(e) => {
                const m = materialsQ.data?.find((x) => x.id === e.target.value);
                setPicker({ ...picker, rawMaterialId: e.target.value, unitCost: m?.costPrice ?? 0 });
              }}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="">Pick a raw material…</option>
              {(materialsQ.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-muted-foreground">Quantity</span>
                <input type="number" step="0.01" min="0"
                  value={picker.qtyReceived}
                  onChange={(e) => setPicker({ ...picker, qtyReceived: Number(e.target.value) })}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Cost / unit (P)</span>
                <input type="number" step="0.01" min="0"
                  value={picker.unitCost}
                  onChange={(e) => setPicker({ ...picker, unitCost: Number(e.target.value) })}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs text-muted-foreground">Expiration date (optional)</span>
              <input type="date"
                value={picker.expirationDate}
                onChange={(e) => setPicker({ ...picker, expirationDate: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Reference / DR # (optional)</span>
              <input type="text"
                value={picker.referenceNumber}
                onChange={(e) => setPicker({ ...picker, referenceNumber: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
            <div className="flex gap-2">
              <button onClick={() => setShowAddRow(false)} className="flex-1 rounded-lg border py-2 text-sm">Cancel</button>
              <button
                onClick={addDraft}
                disabled={!picker.rawMaterialId || picker.qtyReceived <= 0}
                className="flex-1 rounded-lg bg-amber-700 text-white py-2 text-sm font-medium hover:bg-amber-800 disabled:opacity-50"
              >
                Add to delivery
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddRow(true)}
            className="w-full rounded-xl border-2 border-dashed border-muted-foreground/40 py-3 text-sm font-medium text-muted-foreground hover:border-amber-700 hover:text-amber-700"
          >
            <Plus className="h-4 w-4 inline mr-1" /> Add a delivery
          </button>
        )}

        {/* Save batch button */}
        {drafts.filter((d) => !d.saved && !d.dupesPending).length > 0 && (
          <button
            onClick={() => saveM.mutate()}
            disabled={saveM.isPending || pendingDupes.length > 0}
            className="w-full rounded-lg bg-emerald-700 text-white py-3 text-sm font-medium hover:bg-emerald-800 disabled:opacity-50"
          >
            {saveM.isPending ? <Loader2 className="h-4 w-4 inline animate-spin mr-1" /> : <Check className="h-4 w-4 inline mr-1" />}
            Save {drafts.filter((d) => !d.saved).length} delivery item{drafts.filter((d) => !d.saved).length === 1 ? '' : 's'}
          </button>
        )}
      </section>

      {/* ── Section 3: Tomorrow plan ── */}
      <section className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tomorrow's plan</h2>
        </div>

        {/* Bake list */}
        <div>
          <div className="flex items-center gap-1 text-sm font-medium text-foreground mb-2">
            <ChefHat className="h-4 w-4 text-amber-700" /> Bake list
          </div>
          {(s?.bakeListTomorrow?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground italic">No products with recent sales yet.</p>
          ) : (
            <ul className="space-y-1">
              {s!.bakeListTomorrow.map((b, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{b.productName}</span>
                  <span className="font-semibold text-foreground tabular-nums">{b.recommendedQty}{b.unit ? ' ' + b.unit : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Use first */}
        <div>
          <div className="flex items-center gap-1 text-sm font-medium text-foreground mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-700" /> Use first (perishables)
          </div>
          {(s?.useFirstTomorrow?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nothing flagged.</p>
          ) : (
            <ul className="space-y-2">
              {s!.useFirstTomorrow.map((u, i) => (
                <li key={i} className={`rounded-lg p-2 text-sm flex items-center justify-between ${
                  u.tier === 'USE_FIRST'     ? 'bg-amber-50 border border-amber-300' :
                  u.tier === 'EXPIRING_SOON' ? 'bg-orange-50 border border-orange-200' :
                  u.tier === 'EXPIRED'       ? 'bg-red-50 border border-red-300' :
                  'bg-background border'
                }`}>
                  <div>
                    <div className="font-medium text-foreground">{u.rawMaterialName}</div>
                    <div className="text-xs text-muted-foreground">
                      Lot {u.lotCode} · {u.qtyRemaining} {u.unit}
                      {u.expirationDate ? ` · exp ${u.expirationDate.slice(0, 10)}` : ''}
                    </div>
                  </div>
                  <span className={`text-xs font-semibold uppercase tracking-wide ${
                    u.tier === 'USE_FIRST'     ? 'text-amber-800' :
                    u.tier === 'EXPIRING_SOON' ? 'text-orange-700' :
                    u.tier === 'EXPIRED'       ? 'text-red-700'    : 'text-muted-foreground'
                  }`}>
                    {u.tier === 'USE_FIRST' ? 'Use first' :
                     u.tier === 'EXPIRING_SOON' ? 'Soon' :
                     u.tier === 'EXPIRED' ? 'Expired' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pickups */}
        <div>
          <div className="flex items-center gap-1 text-sm font-medium text-foreground mb-2">
            <ShoppingBag className="h-4 w-4 text-amber-700" /> Pickups
          </div>
          {(s?.pickupsTomorrow?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground italic">No scheduled pickups.</p>
          ) : (
            <ul className="space-y-1">
              {s!.pickupsTomorrow.map((p, i) => (
                <li key={i} className="text-sm">
                  <div className="flex items-center gap-2 text-foreground">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{p.time}</span>
                    <span>{p.customerName}</span>
                  </div>
                  <div className="text-xs text-muted-foreground ml-5">{p.details}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Section 4: Print briefing ── */}
      <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-900">Done with tonight?</h2>
        <p className="text-sm text-amber-900">
          Print the morning briefing — one sheet for the cook. Stick it on the kitchen wall before you go to bed.
        </p>
        <button
          onClick={() => printM.mutate()}
          disabled={printM.isPending}
          className="w-full rounded-xl bg-amber-700 text-white py-4 text-base font-semibold hover:bg-amber-800 disabled:opacity-50"
        >
          {printM.isPending ? <Loader2 className="h-5 w-5 inline animate-spin mr-2" /> : <Printer className="h-5 w-5 inline mr-2" />}
          Print morning briefing
        </button>
        <p className="text-xs text-amber-800 italic">
          Preview opens in a new tab — print from there to your usual receipt printer.
        </p>
      </section>
    </div>
  );
}

// ─── Atoms ─────────────────────────────────────────────────────────
function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'bg-amber-50 border-amber-200' : 'bg-background'}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${highlight ? 'text-amber-900' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}
