'use client';
/**
 * AP Bill Posting — Oracle EBS R12 / power-user style.
 *
 * Designed for an AP accountant processing a stack of vendor invoices
 * end-to-end without ever touching the mouse.
 *
 *   Tab / Shift+Tab  → Move between fields (header → lines L→R top→bottom → footer)
 *   Enter (in last cell of last row) → Add a new line and focus its first cell
 *   F2  → Save as Draft (no GL impact)
 *   F3  → Validate (run pre-post checks, surface errors inline)
 *   F4  → Post (Save Draft + Post in one shot)
 *   Esc → Cancel and return to the list
 *
 * Layout:
 *   ┌─ HEADER (sticky top) ──────────────────────────────────────┐
 *   │ Vendor | Bill Date | Vendor SI# | Terms | Ref | Desc       │
 *   ├─ LINES grid (full width, scroll within) ───────────────────┤
 *   │ # | Account | Description | Qty | Unit Price | VAT | Total │
 *   │ ...                                                         │
 *   ├─ TOTALS + WHT (sticky bottom) ─────────────────────────────┤
 *   │ Sub / VAT / Total / − WHT (ATC) / Net Payable              │
 *   ├─ ACTIONS ──────────────────────────────────────────────────┤
 *   │ [F2 Save] [F3 Validate] [F4 Post] [Esc Cancel]             │
 *   └────────────────────────────────────────────────────────────┘
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Receipt, Plus, Trash2, Save, ShieldCheck, Send, ArrowLeft, AlertCircle, Keyboard,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

// ── Types ───────────────────────────────────────────────────────────────────

interface Vendor {
  id:              string;
  name:            string;
  defaultAtcCode:  string | null;
  defaultWhtRate:  string | number | null;
  isActive:        boolean;
}
interface Account { id: string; code: string; name: string; type: string; }

interface Line {
  /** Stable id for React keys + focus refs. */
  key:         string;
  accountId:   string;
  description: string;
  quantity:    string;
  unitPrice:   string;
  taxAmount:   string;   // VAT amount
}

const ATC_CODES = [
  { code: '',      label: 'No WHT' },
  { code: 'WC158', label: 'WC158 — Goods (1%)' },
  { code: 'WC160', label: 'WC160 — Services (2%)' },
  { code: 'WI160', label: 'WI160 — Rentals (5%)' },
  { code: 'WI010', label: 'WI010 — Professionals (10%)' },
  { code: 'WI011', label: 'WI011 — Professionals (15%)' },
];

const HEADER_INPUT = 'h-9 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent';
const CELL_INPUT   = 'w-full h-9 px-2 bg-transparent text-sm focus:outline-none focus:bg-[var(--accent-soft)] focus:ring-2 focus:ring-[var(--accent)] focus:rounded-sm tabular-nums';

let lineKeySeq = 0;
function newLine(): Line {
  lineKeySeq += 1;
  return { key: `L${lineKeySeq}`, accountId: '', description: '', quantity: '1', unitPrice: '', taxAmount: '0' };
}
function todayIso() { return new Date().toISOString().slice(0, 10); }

// ── Page ───────────────────────────────────────────────────────────────────

export default function NewAPBillPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  // ── Header state ──────────────────────────────────────────────────────────
  const [vendorId,      setVendorId]      = useState('');
  const [billDate,      setBillDate]      = useState(todayIso());
  const [vendorBillRef, setVendorBillRef] = useState('');
  const [termsDays,     setTermsDays]     = useState('30');
  const [reference,     setReference]     = useState('');
  const [description,   setDescription]   = useState('');
  const [whtAmount,     setWhtAmount]     = useState('0');
  const [whtAtcCode,    setWhtAtcCode]    = useState('');

  // ── Lines state ───────────────────────────────────────────────────────────
  const [lines, setLines] = useState<Line[]>([newLine()]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<'save' | 'post' | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(true);

  // ── Reference data ────────────────────────────────────────────────────────
  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ['ap-vendors-list-active'],
    queryFn:  () => api.get('/ap/vendors').then((r) => r.data?.data ?? r.data),
    enabled:  !!user,
  });
  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts-list'],
    queryFn:  () => api.get('/accounting/accounts').then((r) => r.data),
    enabled:  !!user,
  });

  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'EXPENSE' || a.type === 'ASSET').sort((a, b) => a.code.localeCompare(b.code)),
    [accounts],
  );

  // ── Derived totals ────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let sub = 0, vat = 0, total = 0;
    for (const l of lines) {
      const q = parseFloat(l.quantity)  || 0;
      const p = parseFloat(l.unitPrice) || 0;
      const t = parseFloat(l.taxAmount) || 0;
      sub   += q * p;
      vat   += t;
      total += q * p + t;
    }
    const wht = parseFloat(whtAmount) || 0;
    return { sub, vat, total, wht, netPayable: total - wht };
  }, [lines, whtAmount]);

  const dueDate = useMemo(() => {
    const d = new Date(billDate);
    const days = parseInt(termsDays, 10) || 0;
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }, [billDate, termsDays]);

  // ── Vendor change auto-fills WHT defaults ─────────────────────────────────
  function handleVendorChange(id: string) {
    setVendorId(id);
    const v = vendors.find((vendor) => vendor.id === id);
    if (v) {
      if (v.defaultAtcCode && !whtAtcCode) setWhtAtcCode(v.defaultAtcCode);
      // If a default rate is set, leave the WHT amount as-is (user computes
      // it per bill — rate alone isn't enough without the base amount).
    }
  }

  // ── Line helpers ──────────────────────────────────────────────────────────
  function setLineField(idx: number, field: keyof Line, val: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: val } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }
  function removeLine(idx: number) {
    setLines((prev) => (prev.length === 1 ? [newLine()] : prev.filter((_, i) => i !== idx)));
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): string[] {
    const errs: string[] = [];
    if (!vendorId)        errs.push('Vendor is required.');
    if (!billDate)        errs.push('Bill Date is required.');
    if (parseInt(termsDays, 10) < 0) errs.push('Terms days must be 0 or more.');

    const validLines = lines.filter((l) => l.accountId || l.unitPrice || l.description);
    if (validLines.length === 0) errs.push('At least one line is required.');
    validLines.forEach((l, i) => {
      const num = i + 1;
      if (!l.accountId)              errs.push(`Line ${num}: Account is required.`);
      const p = parseFloat(l.unitPrice);
      if (isNaN(p) || p < 0)         errs.push(`Line ${num}: Unit Price must be a non-negative number.`);
      const q = parseFloat(l.quantity);
      if (isNaN(q) || q <= 0)        errs.push(`Line ${num}: Qty must be greater than zero.`);
    });

    const wht = parseFloat(whtAmount) || 0;
    if (wht > 0 && !whtAtcCode) errs.push('ATC Code is required when WHT amount is set.');
    if (wht > totals.total)     errs.push('WHT cannot exceed the gross total.');

    return errs;
  }

  // ── Save / Post ───────────────────────────────────────────────────────────
  async function buildPayload() {
    const validLines = lines.filter((l) => l.accountId);
    return {
      vendorId,
      billDate,
      termsDays:     parseInt(termsDays, 10) || 30,
      vendorBillRef: vendorBillRef.trim() || undefined,
      reference:     reference.trim() || undefined,
      description:   description.trim() || undefined,
      whtAmount:     parseFloat(whtAmount) || 0,
      whtAtcCode:    whtAtcCode || undefined,
      lines: validLines.map((l) => {
        const q = parseFloat(l.quantity)  || 1;
        const p = parseFloat(l.unitPrice) || 0;
        const t = parseFloat(l.taxAmount) || 0;
        return {
          accountId:   l.accountId,
          description: l.description.trim() || undefined,
          quantity:    q,
          unitPrice:   p,
          taxAmount:   t,
          lineTotal:   q * p + t,
        };
      }),
    };
  }

  async function saveDraft(thenPost: boolean) {
    const errs = validate();
    setErrors(errs);
    if (errs.length > 0) {
      toast.error(`${errs.length} validation error${errs.length === 1 ? '' : 's'}. Fix highlighted fields.`);
      return;
    }
    setBusy(thenPost ? 'post' : 'save');
    try {
      const payload = await buildPayload();
      const { data: bill } = await api.post('/ap/bills', payload);
      if (thenPost) {
        await api.patch(`/ap/bills/${bill.id}/post`);
        toast.success(`Bill ${bill.billNumber} posted to GL.`);
      } else {
        toast.success(`Bill ${bill.billNumber} saved as draft.`);
      }
      router.push('/ledger/ap/bills');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to save bill.');
    } finally {
      setBusy(null);
    }
  }

  // ── Keyboard shortcuts (form-level) ───────────────────────────────────────
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Don't intercept while inside a select dropdown
      if (e.target instanceof HTMLElement && e.target.tagName === 'OPTION') return;

      if (e.key === 'F2') {
        e.preventDefault();
        if (!busy) saveDraft(false);
      } else if (e.key === 'F3') {
        e.preventDefault();
        const errs = validate();
        setErrors(errs);
        toast[errs.length === 0 ? 'success' : 'error'](
          errs.length === 0 ? 'Validation passed — ready to post.' : `${errs.length} error${errs.length === 1 ? '' : 's'} found.`,
        );
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (!busy) saveDraft(true);
      } else if (e.key === 'Escape') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
          // Let Esc blur first; only navigate away if confirmed
          (e.target as HTMLElement).blur();
        }
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, vendorId, billDate, lines, whtAmount, whtAtcCode]);

  // ── Line cell focus management — Enter moves to next row ──────────────────
  const cellRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});

  function setCellRef(rowKey: string, col: string, el: HTMLInputElement | HTMLSelectElement | null) {
    cellRefs.current[`${rowKey}::${col}`] = el;
  }
  function focusCell(rowKey: string, col: string) {
    const el = cellRefs.current[`${rowKey}::${col}`];
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement) el.select?.();
    }
  }

  function handleCellKey(idx: number, col: string, e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const isLast = idx === lines.length - 1;
    const row = lines[idx];
    if (col === 'taxAmount' && isLast) {
      // Last cell of last row → add new row, focus its first cell
      addLine();
      requestAnimationFrame(() => {
        const newRowKey = `L${lineKeySeq}`;
        focusCell(newRowKey, 'accountId');
      });
    } else if (col === 'taxAmount') {
      // Last cell of a middle row → focus next row's first cell
      focusCell(lines[idx + 1].key, 'accountId');
    } else {
      // Move to next column in the same row
      const order = ['accountId', 'description', 'quantity', 'unitPrice', 'taxAmount'];
      const next = order[order.indexOf(col) + 1];
      if (next) focusCell(row.key, next);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const lineErrors = useMemo(() => {
    const map = new Set<number>();
    errors.forEach((e) => {
      const m = /Line (\d+):/.exec(e);
      if (m) map.add(parseInt(m[1], 10) - 1);
    });
    return map;
  }, [errors]);

  return (
    <div className="flex flex-col h-full bg-muted/30">

      {/* ── Sticky header bar ──────────────────────────────────────────────── */}
      <div className="bg-background border-b border-border sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <button onClick={() => router.push('/ledger/ap/bills')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> All Bills
          </button>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold flex items-center gap-2">
              <Receipt className="w-4 h-4 text-[var(--accent)]" />
              New AP Bill
            </h1>
          </div>
          <button
            onClick={() => setShowShortcuts((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Keyboard className="w-3.5 h-3.5" /> {showShortcuts ? 'Hide' : 'Show'} shortcuts
          </button>
        </div>

        {/* Shortcut bar */}
        {showShortcuts && (
          <div className="px-4 sm:px-6 pb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground border-t border-border/50 pt-2">
            <span><kbd className="px-1 rounded bg-muted">Tab</kbd> next field</span>
            <span><kbd className="px-1 rounded bg-muted">Enter</kbd> in last cell adds row</span>
            <span><kbd className="px-1 rounded bg-muted">F2</kbd> Save Draft</span>
            <span><kbd className="px-1 rounded bg-muted">F3</kbd> Validate</span>
            <span><kbd className="px-1 rounded bg-muted">F4</kbd> Post (creates GL JE)</span>
            <span><kbd className="px-1 rounded bg-muted">Esc</kbd> Blur</span>
          </div>
        )}

        {/* Header form */}
        <div className="px-4 sm:px-6 pb-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="col-span-2">
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Vendor *</label>
            <select autoFocus className={HEADER_INPUT + ' w-full'}
              value={vendorId} onChange={(e) => handleVendorChange(e.target.value)}>
              <option value="">— Select vendor —</option>
              {vendors.filter((v) => v.isActive).map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Bill Date *</label>
            <input type="date" className={HEADER_INPUT + ' w-full'}
              value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Vendor SI / OR #</label>
            <input className={HEADER_INPUT + ' w-full'} placeholder="Vendor's invoice no."
              value={vendorBillRef} onChange={(e) => setVendorBillRef(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Terms (days)</label>
            <input type="number" className={HEADER_INPUT + ' w-full'}
              value={termsDays} onChange={(e) => setTermsDays(e.target.value)} />
            <div className="text-[10px] text-muted-foreground mt-0.5">Due {dueDate}</div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Reference / PO#</label>
            <input className={HEADER_INPUT + ' w-full'}
              value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="col-span-2 md:col-span-3 lg:col-span-6">
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Description</label>
            <input className={HEADER_INPUT + ' w-full'}
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── Errors banner ──────────────────────────────────────────────────── */}
      {errors.length > 0 && (
        <div className="bg-red-500/10 border-b border-red-500/40 px-4 sm:px-6 py-2 text-xs">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-red-600 mb-0.5">{errors.length} validation error{errors.length === 1 ? '' : 's'}</div>
              <ul className="text-red-600/90 space-y-0.5 list-disc pl-5">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Lines grid ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 sm:px-6 py-3">
        <div className="rounded-lg border border-border bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="w-10 text-center py-2">#</th>
                <th className="text-left py-2">Account *</th>
                <th className="text-left py-2">Description</th>
                <th className="w-24 text-right py-2">Qty</th>
                <th className="w-32 text-right py-2">Unit Price (₱)</th>
                <th className="w-28 text-right py-2">VAT (₱)</th>
                <th className="w-32 text-right py-2">Line Total</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const q = parseFloat(line.quantity)  || 0;
                const p = parseFloat(line.unitPrice) || 0;
                const t = parseFloat(line.taxAmount) || 0;
                const lineTotal = q * p + t;
                const isErr = lineErrors.has(idx);
                return (
                  <tr key={line.key}
                    className={`border-t border-border ${isErr ? 'bg-red-500/5' : ''}`}>
                    <td className="text-center text-xs text-muted-foreground tabular-nums">{idx + 1}</td>
                    <td className="px-1">
                      <select
                        ref={(el) => setCellRef(line.key, 'accountId', el)}
                        onKeyDown={(e) => handleCellKey(idx, 'accountId', e)}
                        className={CELL_INPUT}
                        value={line.accountId}
                        onChange={(e) => setLineField(idx, 'accountId', e.target.value)}>
                        <option value="">— Pick account —</option>
                        {expenseAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1">
                      <input
                        ref={(el) => setCellRef(line.key, 'description', el)}
                        onKeyDown={(e) => handleCellKey(idx, 'description', e)}
                        className={CELL_INPUT}
                        value={line.description}
                        onChange={(e) => setLineField(idx, 'description', e.target.value)}
                        placeholder="(optional)"
                      />
                    </td>
                    <td className="px-1">
                      <input type="number" step="0.0001"
                        ref={(el) => setCellRef(line.key, 'quantity', el)}
                        onKeyDown={(e) => handleCellKey(idx, 'quantity', e)}
                        className={CELL_INPUT + ' text-right'}
                        value={line.quantity}
                        onChange={(e) => setLineField(idx, 'quantity', e.target.value)}
                      />
                    </td>
                    <td className="px-1">
                      <input type="number" step="0.01"
                        ref={(el) => setCellRef(line.key, 'unitPrice', el)}
                        onKeyDown={(e) => handleCellKey(idx, 'unitPrice', e)}
                        className={CELL_INPUT + ' text-right'}
                        value={line.unitPrice}
                        onChange={(e) => setLineField(idx, 'unitPrice', e.target.value)}
                      />
                    </td>
                    <td className="px-1">
                      <input type="number" step="0.01"
                        ref={(el) => setCellRef(line.key, 'taxAmount', el)}
                        onKeyDown={(e) => handleCellKey(idx, 'taxAmount', e)}
                        className={CELL_INPUT + ' text-right'}
                        value={line.taxAmount}
                        onChange={(e) => setLineField(idx, 'taxAmount', e.target.value)}
                      />
                    </td>
                    <td className="text-right pr-3 tabular-nums text-foreground/80">
                      {formatPeso(lineTotal)}
                    </td>
                    <td className="text-center">
                      <button onClick={() => removeLine(idx)}
                        className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                        title="Delete row">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t border-border">
            <button onClick={addLine}
              className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add line  <span className="text-muted-foreground ml-2">(or press Enter on the last cell)</span>
            </button>
          </div>
        </div>

        {/* WHT block */}
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
          <div className="font-semibold text-amber-900 mb-2">Withholding Tax (PH 2307)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-amber-900/70 mb-1">WHT Amount (₱)</label>
              <input type="number" step="0.01" className={HEADER_INPUT + ' w-full bg-white'}
                value={whtAmount} onChange={(e) => setWhtAmount(e.target.value)} />
            </div>
            <div>
              <label className="block text-amber-900/70 mb-1">ATC Code</label>
              <select className={HEADER_INPUT + ' w-full bg-white'}
                value={whtAtcCode} onChange={(e) => setWhtAtcCode(e.target.value)}>
                {ATC_CODES.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
              </select>
            </div>
            <div className="col-span-2 text-amber-900/80 leading-relaxed">
              We withhold this amount from the vendor and remit to BIR. The vendor receives a 2307 at year-end as a tax credit.
              The cash you actually pay = Gross Total − WHT.
            </div>
          </div>
        </div>
      </div>

      {/* ── Sticky footer with totals + actions ─────────────────────────────── */}
      <div className="bg-background border-t border-border sticky bottom-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex flex-wrap items-end gap-x-8 gap-y-2 justify-between">
          {/* Totals */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
            <div className="text-muted-foreground">Subtotal: <span className="text-foreground font-medium">{formatPeso(totals.sub)}</span></div>
            <div className="text-muted-foreground">VAT: <span className="text-foreground font-medium">{formatPeso(totals.vat)}</span></div>
            <div className="text-muted-foreground">Gross: <span className="text-foreground font-medium">{formatPeso(totals.total)}</span></div>
            {totals.wht > 0 && (
              <div className="text-amber-700">− WHT: <span className="font-medium">{formatPeso(totals.wht)}</span></div>
            )}
            <div className="font-bold">Net Payable: <span className="text-[var(--accent)]">{formatPeso(totals.netPayable)}</span></div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/ledger/ap/bills')}
              className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted transition-colors"
            >
              <span className="hidden sm:inline">Esc — </span>Cancel
            </button>
            <button
              onClick={() => { const errs = validate(); setErrors(errs); toast[errs.length === 0 ? 'success' : 'error'](errs.length === 0 ? 'Validation passed — ready to post.' : `${errs.length} error(s) found.`); }}
              className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted transition-colors flex items-center gap-1.5"
            >
              <ShieldCheck className="w-4 h-4" /> <span className="hidden sm:inline">F3 — </span>Validate
            </button>
            <button
              onClick={() => saveDraft(false)}
              disabled={busy !== null}
              className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-4 h-4" /> <span className="hidden sm:inline">F2 — </span>Save Draft
            </button>
            <button
              onClick={() => saveDraft(true)}
              disabled={busy !== null}
              className="h-9 px-3 rounded-md bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50"
            >
              <Send className="w-4 h-4" /> <span className="hidden sm:inline">F4 — </span>Post
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
