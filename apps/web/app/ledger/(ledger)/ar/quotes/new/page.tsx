'use client';
/**
 * New Sales Quote form. Mirrors /ledger/ar/billing's create modal but
 * stripped of GL-account selection — Quotes don't post to the GL, so
 * lines are free-text description + qty + unit price + optional VAT.
 *
 * Default validUntil = quoteDate + 30 days.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, Plus, Trash2, ArrowLeft, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

interface Customer { id: string; name: string; isActive?: boolean }

interface LineDraft {
  description: string;
  quantity:    string;
  unitPrice:   string;
  taxAmount:   string;
}

const WRITE_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'SALES_LEAD'];

const INPUT_CLS =
  'h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ' +
  'focus:border-transparent transition-shadow w-full';

function emptyLine(): LineDraft {
  return { description: '', quantity: '1', unitPrice: '', taxAmount: '0' };
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDaysIso(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function NewQuotePage() {
  const router = useRouter();
  const user   = useAuthStore((s) => s.user);
  const canWrite = user ? WRITE_ROLES.includes(user.role) : false;

  const [customerId, setCustomerId]   = useState('');
  const [quoteDate, setQuoteDate]     = useState(todayIso());
  const [validUntil, setValidUntil]   = useState(addDaysIso(todayIso(), 30));
  const [terms, setTerms]             = useState('');
  const [notes, setNotes]             = useState('');
  const [lines, setLines]             = useState<LineDraft[]>([emptyLine()]);
  const [saving, setSaving]           = useState(false);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['ar-customers-list'],
    queryFn:  () => api.get('/ar/customers').then((r) => r.data?.data ?? r.data),
    enabled:  !!user,
  });

  function setLine(idx: number, field: keyof LineDraft, val: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: val } : l)));
  }
  function addLine() { setLines((p) => [...p, emptyLine()]); }
  function rmLine(idx: number) {
    setLines((p) => p.length > 1 ? p.filter((_, i) => i !== idx) : p);
  }

  const totals = useMemo(() => {
    let sub = 0, vat = 0, total = 0;
    for (const l of lines) {
      const q  = parseFloat(l.quantity)  || 0;
      const p  = parseFloat(l.unitPrice) || 0;
      const t  = parseFloat(l.taxAmount) || 0;
      sub   += q * p;
      vat   += t;
      total += q * p + t;
    }
    return { sub, vat, total };
  }, [lines]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { toast.error('Pick a customer'); return; }
    if (lines.some((l) => !l.description.trim() || !l.unitPrice)) {
      toast.error('Each line needs a description and unit price'); return;
    }
    setSaving(true);
    try {
      const res = await api.post('/ar/quotes', {
        customerId,
        quoteDate,
        validUntil,
        terms: terms.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => {
          const q  = parseFloat(l.quantity)  || 1;
          const p  = parseFloat(l.unitPrice) || 0;
          const t  = parseFloat(l.taxAmount) || 0;
          return {
            description: l.description.trim(),
            quantity:    q,
            unitPrice:   p,
            taxAmount:   t,
            lineTotal:   q * p + t,
          };
        }),
      });
      toast.success(`Quote ${res.data.quoteNumber} created`);
      router.push(`/ledger/ar/quotes/${res.data.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to create quote');
    } finally {
      setSaving(false);
    }
  }

  if (!canWrite) {
    return <div className="p-8 text-muted-foreground">Your role can&apos;t create quotes.</div>;
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileSignature className="w-6 h-6" /> New Quote
          </h1>
          <p className="text-sm text-muted-foreground">
            Save as DRAFT. Send when ready to share with the customer. No GL impact yet.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-background p-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Customer *</label>
            <select className={INPUT_CLS} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Quote Date *</label>
            <input type="date" className={INPUT_CLS} value={quoteDate}
              onChange={(e) => { setQuoteDate(e.target.value); setValidUntil(addDaysIso(e.target.value, 30)); }} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Valid Until *</label>
            <input type="date" className={INPUT_CLS} value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Terms</label>
            <input className={INPUT_CLS} placeholder="e.g. Net 30; 50% deposit"
              value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
          <input className={INPUT_CLS} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted-foreground">Lines *</label>
            <button type="button" onClick={addLine}
              className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add line
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-start p-2 rounded-lg bg-muted/30">
                <input className={`${INPUT_CLS} col-span-6`} placeholder="Description"
                  value={line.description} onChange={(e) => setLine(idx, 'description', e.target.value)} />
                <input type="number" step="0.01" className={`${INPUT_CLS} col-span-1`} placeholder="Qty"
                  value={line.quantity} onChange={(e) => setLine(idx, 'quantity', e.target.value)} />
                <input type="number" step="0.01" className={`${INPUT_CLS} col-span-2`} placeholder="Unit price"
                  value={line.unitPrice} onChange={(e) => setLine(idx, 'unitPrice', e.target.value)} />
                <input type="number" step="0.01" className={`${INPUT_CLS} col-span-2`} placeholder="VAT"
                  value={line.taxAmount} onChange={(e) => setLine(idx, 'taxAmount', e.target.value)} />
                <button type="button" onClick={() => rmLine(idx)}
                  className="col-span-1 h-9 flex items-center justify-center text-muted-foreground hover:text-red-600"
                  disabled={lines.length === 1}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-6 pt-2 border-t border-border text-sm">
          <div className="text-muted-foreground">Subtotal: <span className="text-foreground font-medium">{formatPeso(totals.sub)}</span></div>
          <div className="text-muted-foreground">VAT: <span className="text-foreground font-medium">{formatPeso(totals.vat)}</span></div>
          <div className="text-foreground font-semibold">Total: {formatPeso(totals.total)}</div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => router.back()} className="h-9 px-4 rounded-lg border border-border text-sm">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="h-9 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save as Draft'}
          </button>
        </div>
      </form>
    </div>
  );
}
