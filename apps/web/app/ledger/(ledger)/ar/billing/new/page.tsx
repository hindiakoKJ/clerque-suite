'use client';
/**
 * AR Invoice Posting — Oracle EBS R12 / power-user style.
 *
 * Mirror of /ledger/ap/bills/new but for customer invoicing. AR has no
 * withholding-tax block — that's an AP-only PH concept (we issue 2307,
 * we don't receive one from customers).
 *
 *   Tab / Shift+Tab  → Move between fields (header → lines L→R top→bottom → footer)
 *   Enter (in last cell of last row) → Add a new line and focus its first cell
 *   F2  → Save as Draft (no GL impact)
 *   F3  → Validate (run pre-post checks)
 *   F4  → Post (Save Draft + Post in one shot)
 *   Esc → Blur
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  FileText, Plus, Trash2, Save, ShieldCheck, Send, ArrowLeft, AlertCircle, Keyboard,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

// ── Types ───────────────────────────────────────────────────────────────────

interface Customer {
  id:              string;
  name:            string;
  creditTermDays:  number;
  isActive?:       boolean;
}
interface Account { id: string; code: string; name: string; type: string; }

interface Line {
  key:         string;
  accountId:   string;
  description: string;
  quantity:    string;
  unitPrice:   string;
  taxAmount:   string;
}

const HEADER_INPUT = 'h-9 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent';
const CELL_INPUT   = 'w-full h-9 px-2 bg-transparent text-sm focus:outline-none focus:bg-[var(--accent-soft)] focus:ring-2 focus:ring-[var(--accent)] focus:rounded-sm tabular-nums';

let lineKeySeq = 0;
function newLine(): Line {
  lineKeySeq += 1;
  return { key: `L${lineKeySeq}`, accountId: '', description: '', quantity: '1', unitPrice: '', taxAmount: '0' };
}
function todayIso() { return new Date().toISOString().slice(0, 10); }

// ── Page ───────────────────────────────────────────────────────────────────

export default function NewARInvoicePage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  // Header state
  const [customerId, setCustomerId]     = useState('');
  const [invoiceDate, setInvoiceDate]   = useState(todayIso());
  const [termsDays,  setTermsDays]      = useState('30');
  const [reference,  setReference]      = useState('');
  const [description, setDescription]   = useState('');

  // Lines state
  const [lines, setLines] = useState<Line[]>([newLine()]);

  // UI state
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<'save' | 'post' | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(true);

  // Reference data
  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['ar-customers-list-active'],
    queryFn:  () => api.get('/ar/customers').then((r) => r.data?.data ?? r.data),
    enabled:  !!user,
  });
  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts-list'],
    queryFn:  () => api.get('/accounting/accounts').then((r) => r.data),
    enabled:  !!user,
  });

  // Revenue accounts come first in the picker — most AR lines hit them
  const revenueAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'REVENUE').sort((a, b) => a.code.localeCompare(b.code)),
    [accounts],
  );
  const otherAccounts = useMemo(
    () => accounts.filter((a) => a.type !== 'REVENUE').sort((a, b) => a.code.localeCompare(b.code)),
    [accounts],
  );

  // When customer changes, pull their default credit terms
  function handleCustomerChange(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c && c.creditTermDays != null) setTermsDays(String(c.creditTermDays));
  }

  // Derived totals
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
    return { sub, vat, total };
  }, [lines]);

  const dueDate = useMemo(() => {
    const d = new Date(invoiceDate);
    const days = parseInt(termsDays, 10) || 0;
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }, [invoiceDate, termsDays]);

  // Line helpers
  function setLineField(idx: number, field: keyof Line, val: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: val } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }
  function removeLine(idx: number) {
    setLines((prev) => (prev.length === 1 ? [newLine()] : prev.filter((_, i) => i !== idx)));
  }

  // Validation
  function validate(): string[] {
    const errs: string[] = [];
    if (!customerId)      errs.push('Customer is required.');
    if (!invoiceDate)     errs.push('Invoice Date is required.');
    if (parseInt(termsDays, 10) < 0) errs.push('Terms days must be 0 or more.');

    const validLines = lines.filter((l) => l.accountId || l.unitPrice || l.description);
    if (validLines.length === 0) errs.push('At least one line is required.');
    validLines.forEach((l, i) => {
      const num = i + 1;
      if (!l.accountId)         errs.push(`Line ${num}: Account is required.`);
      const p = parseFloat(l.unitPrice);
      if (isNaN(p) || p < 0)    errs.push(`Line ${num}: Unit Price must be a non-negative number.`);
      const q = parseFloat(l.quantity);
      if (isNaN(q) || q <= 0)   errs.push(`Line ${num}: Qty must be greater than zero.`);
    });
    return errs;
  }

  // Save / Post
  function buildPayload() {
    const validLines = lines.filter((l) => l.accountId);
    return {
      customerId,
      invoiceDate,
      termsDays:   parseInt(termsDays, 10) || 30,
      reference:   reference.trim() || undefined,
      description: description.trim() || undefined,
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
      const payload = buildPayload();
      const { data: invoice } = await api.post('/ar/invoices', payload);
      if (thenPost) {
        await api.patch(`/ar/invoices/${invoice.id}/post`);
        toast.success(`Invoice ${invoice.invoiceNumber} posted to GL.`);
      } else {
        toast.success(`Invoice ${invoice.invoiceNumber} saved as draft.`);
      }
      router.push('/ledger/ar/billing');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to save invoice.');
    } finally {
      setBusy(null);
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.tagName === 'OPTION') return;
      if (e.key === 'F2') { e.preventDefault(); if (!busy) saveDraft(false); }
      else if (e.key === 'F3') {
        e.preventDefault();
        const errs = validate();
        setErrors(errs);
        toast[errs.length === 0 ? 'success' : 'error'](
          errs.length === 0 ? 'Validation passed — ready to post.' : `${errs.length} error(s) found.`,
        );
      }
      else if (e.key === 'F4') { e.preventDefault(); if (!busy) saveDraft(true); }
      else if (e.key === 'Escape') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
          (e.target as HTMLElement).blur();
        }
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, customerId, invoiceDate, lines]);

  // Cell focus management
  const cellRefs: Record<string, HTMLInputElement | HTMLSelectElement | null> = {};
  function setCellRef(rowKey: string, col: string, el: HTMLInputElement | HTMLSelectElement | null) {
    cellRefs[`${rowKey}::${col}`] = el;
  }
  function focusCell(rowKey: string, col: string) {
    const el = cellRefs[`${rowKey}::${col}`];
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
      addLine();
      requestAnimationFrame(() => {
        const newRowKey = `L${lineKeySeq}`;
        focusCell(newRowKey, 'accountId');
      });
    } else if (col === 'taxAmount') {
      focusCell(lines[idx + 1].key, 'accountId');
    } else {
      const order = ['accountId', 'description', 'quantity', 'unitPrice', 'taxAmount'];
      const next = order[order.indexOf(col) + 1];
      if (next) focusCell(row.key, next);
    }
  }

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

      {/* Sticky header bar */}
      <div className="bg-background border-b border-border sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <button onClick={() => router.push('/ledger/ar/billing')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> All Invoices
          </button>
          <h1 className="text-base font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-[var(--accent)]" />
            New AR Invoice
          </h1>
          <button onClick={() => setShowShortcuts((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <Keyboard className="w-3.5 h-3.5" /> {showShortcuts ? 'Hide' : 'Show'} shortcuts
          </button>
        </div>

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

        <div className="px-4 sm:px-6 pb-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="col-span-2">
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Customer *</label>
            <select autoFocus className={HEADER_INPUT + ' w-full'}
              value={customerId} onChange={(e) => handleCustomerChange(e.target.value)}>
              <option value="">— Select customer —</option>
              {customers.filter((c) => c.isActive !== false).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Invoice Date *</label>
            <input type="date" className={HEADER_INPUT + ' w-full'}
              value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
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

      {/* Errors banner */}
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

      {/* Lines grid */}
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
                  <tr key={line.key} className={`border-t border-border ${isErr ? 'bg-red-500/5' : ''}`}>
                    <td className="text-center text-xs text-muted-foreground tabular-nums">{idx + 1}</td>
                    <td className="px-1">
                      <select
                        ref={(el) => setCellRef(line.key, 'accountId', el)}
                        onKeyDown={(e) => handleCellKey(idx, 'accountId', e)}
                        className={CELL_INPUT}
                        value={line.accountId}
                        onChange={(e) => setLineField(idx, 'accountId', e.target.value)}>
                        <option value="">— Pick account —</option>
                        <optgroup label="Revenue">
                          {revenueAccounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Other">
                          {otherAccounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                          ))}
                        </optgroup>
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
                    <td className="text-right pr-3 tabular-nums text-foreground/80">{formatPeso(lineTotal)}</td>
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
      </div>

      {/* Sticky footer */}
      <div className="bg-background border-t border-border sticky bottom-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex flex-wrap items-end gap-x-8 gap-y-2 justify-between">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
            <div className="text-muted-foreground">Subtotal: <span className="text-foreground font-medium">{formatPeso(totals.sub)}</span></div>
            <div className="text-muted-foreground">VAT: <span className="text-foreground font-medium">{formatPeso(totals.vat)}</span></div>
            <div className="font-bold">Total: <span className="text-[var(--accent)]">{formatPeso(totals.total)}</span></div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => router.push('/ledger/ar/billing')}
              className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted transition-colors">
              <span className="hidden sm:inline">Esc — </span>Cancel
            </button>
            <button onClick={() => { const errs = validate(); setErrors(errs); toast[errs.length === 0 ? 'success' : 'error'](errs.length === 0 ? 'Validation passed — ready to post.' : `${errs.length} error(s) found.`); }}
              className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted transition-colors flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" /> <span className="hidden sm:inline">F3 — </span>Validate
            </button>
            <button onClick={() => saveDraft(false)} disabled={busy !== null}
              className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted transition-colors flex items-center gap-1.5 disabled:opacity-50">
              <Save className="w-4 h-4" /> <span className="hidden sm:inline">F2 — </span>Save Draft
            </button>
            <button onClick={() => saveDraft(true)} disabled={busy !== null}
              className="h-9 px-3 rounded-md bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50">
              <Send className="w-4 h-4" /> <span className="hidden sm:inline">F4 — </span>Post
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
