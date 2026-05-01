'use client';
import { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

type AdjustType = 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT';

const REASONS: Record<AdjustType, string[]> = {
  STOCK_IN:  ['Delivery received', 'Transfer in', 'Returned to stock', 'Initial count', 'Other'],
  STOCK_OUT: ['Damaged / spoiled', 'Transfer out', 'Theft / loss', 'Sample / tasting', 'Other'],
  ADJUSTMENT: ['Physical count correction', 'System error correction', 'Other'],
};

interface StockAdjustModalProps {
  open: boolean;
  productId: string;
  productName: string;
  currentQty: number;
  branchId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function StockAdjustModal({
  open,
  productId,
  productName,
  currentQty,
  branchId,
  onClose,
  onSuccess,
}: StockAdjustModalProps) {
  const [direction, setDirection] = useState<AdjustType>('STOCK_IN');
  const [qtyStr, setQtyStr] = useState('');
  const [unitCostStr, setUnitCostStr] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const qty = parseFloat(qtyStr) || 0;
  const delta = direction === 'STOCK_OUT' ? -qty : qty;
  const newQty = currentQty + delta;
  const canSubmit = qty > 0 && reason;

  async function handleSubmit() {
    if (!canSubmit) { setError('Enter a quantity and select a reason.'); return; }
    if (newQty < 0) { setError('Stock cannot go below zero.'); return; }
    setLoading(true);
    try {
      const unitCost = parseFloat(unitCostStr);
      await api.post('/inventory/adjust', {
        productId,
        branchId,
        quantity: delta,
        type: direction,
        reason,
        note: note || undefined,
        // Only send unitCost on positive-qty receipts (STOCK_IN)
        unitCost: direction === 'STOCK_IN' && qty > 0 && !isNaN(unitCost) && unitCost >= 0
          ? unitCost
          : undefined,
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to adjust stock.',
      );
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (loading) return;
    setQtyStr(''); setUnitCostStr(''); setReason(''); setNote(''); setError('');
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust Stock</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-2 space-y-4">
          <p className="text-sm font-medium text-foreground truncate">{productName}</p>

          {/* Current / new qty display */}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-muted rounded-xl p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Current</p>
              <p className="text-2xl font-bold text-foreground mt-0.5">{currentQty}</p>
            </div>
            <div className={`rounded-xl p-3 ${newQty < 0 ? 'bg-red-500/10' : qty > 0 ? 'bg-[var(--accent-soft)]' : 'bg-muted'}`}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">After</p>
              <p className={`text-2xl font-bold mt-0.5 ${newQty < 0 ? 'text-red-500' : qty > 0 ? 'text-[var(--accent)]' : 'text-foreground'}`}>
                {qty > 0 ? newQty : '—'}
              </p>
            </div>
          </div>

          {/* Direction tabs */}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
            {(['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'] as AdjustType[]).map((d) => (
              <button
                key={d}
                onClick={() => { setDirection(d); setReason(''); setError(''); }}
                className={`flex-1 py-2 flex items-center justify-center gap-1 transition-colors ${
                  direction === d ? 'text-white' : 'text-muted-foreground hover:bg-muted'
                }`}
                style={direction === d ? { background: 'var(--accent)' } : undefined}
              >
                {d === 'STOCK_IN' && <ArrowUpCircle className="h-3.5 w-3.5" />}
                {d === 'STOCK_OUT' && <ArrowDownCircle className="h-3.5 w-3.5" />}
                {d === 'STOCK_IN' ? 'Stock In' : d === 'STOCK_OUT' ? 'Stock Out' : 'Adjust'}
              </button>
            ))}
          </div>

          {/* Quantity */}
          <div>
            <label className="text-xs text-muted-foreground font-medium">Quantity</label>
            <input
              type="number"
              min={0}
              step={1}
              value={qtyStr}
              onChange={(e) => { setQtyStr(e.target.value); setError(''); }}
              placeholder="0"
              className="mt-1 w-full h-11 rounded-lg border border-border bg-input text-foreground px-3 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              autoFocus
            />
          </div>

          {/* Unit Cost — only for STOCK_IN, drives Moving-Average Cost */}
          {direction === 'STOCK_IN' && (
            <div>
              <label className="text-xs text-muted-foreground font-medium">
                Unit Cost (₱) <span className="text-[10px] text-muted-foreground/70">— optional, drives gross-profit accuracy</span>
              </label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={unitCostStr}
                onChange={(e) => setUnitCostStr(e.target.value)}
                placeholder="What you paid this delivery"
                className="mt-1 w-full h-9 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <p className="mt-1 text-[10px] text-muted-foreground leading-snug">
                When set, your COGS uses Moving-Average Cost going forward — handles
                volatile-cost items (produce, FX-imported goods) accurately.
              </p>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="text-xs text-muted-foreground font-medium">Reason</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {REASONS[direction].map((r) => (
                <button
                  key={r}
                  onClick={() => { setReason(r); setError(''); }}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    reason === r ? 'text-white' : 'bg-muted text-muted-foreground hover:bg-secondary'
                  }`}
                  style={reason === r ? { background: 'var(--accent)' } : undefined}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Note (optional) */}
          <div>
            <label className="text-xs text-muted-foreground font-medium">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Supplier invoice #1234"
              className="mt-1 w-full h-9 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || loading} className="min-w-28">
            {loading ? 'Saving…' : 'Save Adjustment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
