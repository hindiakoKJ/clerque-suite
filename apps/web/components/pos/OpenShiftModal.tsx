'use client';
import { useState } from 'react';
import { DollarSign } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatPeso } from '@/lib/utils';

const BILL_DENOMINATIONS = [1000, 500, 200, 100, 50, 20];
const COIN_DENOMINATIONS = [10, 5, 1];

interface OpenShiftModalProps {
  onOpen: (openingCash: number, notes?: string) => Promise<void>;
  cashierName: string;
}

export function OpenShiftModal({ onOpen, cashierName }: OpenShiftModalProps) {
  const [mode, setMode] = useState<'simple' | 'denomination'>('simple');
  const [simpleAmount, setSimpleAmount] = useState('');
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const denomTotal = [...BILL_DENOMINATIONS, ...COIN_DENOMINATIONS].reduce(
    (sum, d) => sum + d * (counts[d] ?? 0),
    0,
  );

  const openingCash = mode === 'simple'
    ? parseFloat(simpleAmount) || 0
    : denomTotal;

  function setCount(denom: number, value: string) {
    const n = parseInt(value) || 0;
    setCounts((prev) => ({ ...prev, [denom]: Math.max(0, n) }));
  }

  async function handleSubmit() {
    if (openingCash < 0) { setError('Opening cash cannot be negative.'); return; }
    setLoading(true);
    try {
      await onOpen(openingCash, notes || undefined);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to open shift.');
    } finally {
      setLoading(false);
    }
  }

  return (
    // non-dismissable: always open until shift is started
    <Dialog open modal>
      <DialogContent className="max-w-sm" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" style={{ color: 'var(--accent)' }} />
            Open Shift
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-2 space-y-4">
          <p className="text-sm text-gray-500">
            Welcome, <span className="font-medium text-gray-800">{cashierName}</span>. Enter the
            opening cash before starting your shift.
          </p>

          {/* Mode toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            {(['simple', 'denomination'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 transition-colors capitalize ${
                  mode === m ? 'text-white' : 'text-gray-500 hover:bg-gray-50'
                }`}
                style={mode === m ? { background: 'var(--accent)' } : undefined}
              >
                {m === 'simple' ? 'Enter total' : 'Count by denomination'}
              </button>
            ))}
          </div>

          {mode === 'simple' ? (
            <div>
              <label className="text-xs text-gray-500 font-medium">Opening cash (₱)</label>
              <input
                type="number"
                value={simpleAmount}
                onChange={(e) => { setSimpleAmount(e.target.value); setError(''); }}
                placeholder="0.00"
                className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-xl font-bold focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                autoFocus
              />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 font-medium">Count bills and coins</p>
              {[...BILL_DENOMINATIONS, ...COIN_DENOMINATIONS].map((d) => (
                <div key={d} className="flex items-center gap-3">
                  <span className="w-16 text-sm font-medium text-right">{formatPeso(d)}</span>
                  <span className="text-gray-300">×</span>
                  <input
                    type="number"
                    min={0}
                    value={counts[d] ?? ''}
                    onChange={(e) => setCount(d, e.target.value)}
                    placeholder="0"
                    className="w-20 h-8 rounded border border-gray-200 px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  />
                  <span className="text-xs text-gray-400 ml-auto">
                    = {formatPeso(d * (counts[d] ?? 0))}
                  </span>
                </div>
              ))}
              <div className="flex justify-between font-bold text-sm pt-2 border-t border-gray-200">
                <span>Total</span>
                <span style={{ color: 'var(--accent)' }}>{formatPeso(denomTotal)}</span>
              </div>
            </div>
          )}

          {/* Notes (optional) */}
          <div>
            <label className="text-xs text-gray-500 font-medium">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Drawer A, morning shift"
              className="mt-1 w-full h-9 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {/* Summary */}
          <div className="rounded-xl p-3 text-center" style={{ background: 'color-mix(in oklab, var(--accent) 8%, white)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Opening Cash</p>
            <p className="text-3xl font-bold mt-0.5" style={{ color: 'var(--accent)' }}>{formatPeso(openingCash)}</p>
          </div>

          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
        </div>

        <div className="px-6 pb-6">
          <Button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full"
            style={{ background: 'var(--accent)' }}
          >
            {loading ? 'Opening shift…' : 'Start Shift'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
