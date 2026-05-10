'use client';
/**
 * Sprint 19 — Stamp cards modal for a single customer.
 *
 * Mounted from the AR customers list. Shows every active program's card
 * for this customer (lazy-created on first open via the backend), with:
 *   • current stamp count + threshold
 *   • public token URL (copy + show as QR for printing)
 *   • Redeem (resets to 0) when threshold met
 *   • Adjust (manual delta with mandatory note)
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Copy, Stamp as StampIcon, RotateCcw, Sliders, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface CustomerLite { id: string; name: string }

interface Card {
  id: string;
  templateId: string;
  templateName: string;
  rewardLabel: string;
  requiredStamps: number;
  stamps: number;
  lifetimeStamps: number;
  redemptionCount: number;
  publicToken: string;
  lastEarnedAt: string | null;
  isActive: boolean;
}

export function StampCardsModal({ customer, onClose }: { customer: CustomerLite; onClose: () => void }) {
  const qc = useQueryClient();

  const { data: cards = [], isLoading } = useQuery<Card[]>({
    queryKey: ['loyalty-cards', customer.id],
    queryFn: () => api.get(`/loyalty/customers/${customer.id}/cards`).then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['loyalty-cards', customer.id] });

  const redeemMut = useMutation({
    mutationFn: (cardId: string) =>
      api.post(`/loyalty/cards/${cardId}/redeem`, { note: 'Redeemed at till' }).then((r) => r.data),
    onSuccess: () => { invalidate(); toast.success('Reward redeemed.'); },
    onError:   (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to redeem.'),
  });

  const [adjustOpen, setAdjustOpen] = useState<Card | null>(null);

  function publicUrl(token: string) {
    if (typeof window === 'undefined') return `/stamps/${token}`;
    return `${window.location.origin}/stamps/${token}`;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-card border border-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <StampIcon className="h-5 w-5 text-[var(--accent)]" />
              Stamp Cards · {customer.name}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each active program shows this customer's progress. The link works without login — share via SMS or print on a receipt.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : cards.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No active stamp programs. Set one up under <a href="/settings/loyalty" className="underline">Settings → Stamp Cards</a>.
          </div>
        ) : (
          <div className="space-y-3">
            {cards.map((card) => {
              const ready = card.stamps >= card.requiredStamps;
              const url = publicUrl(card.publicToken);
              return (
                <div key={card.id} className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{card.templateName}</div>
                      <div className="text-xs text-muted-foreground">{card.rewardLabel}</div>
                    </div>
                    {ready && (
                      <span className="rounded px-2 py-0.5 text-xs font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                        Reward ready
                      </span>
                    )}
                  </div>

                  {/* Stamp grid */}
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: card.requiredStamps }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-7 w-7 rounded-full border-2 flex items-center justify-center text-[10px] ${
                          i < card.stamps
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                            : 'border-border text-muted-foreground'
                        }`}
                      >
                        {i < card.stamps ? '★' : i + 1}
                      </div>
                    ))}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {card.stamps} / {card.requiredStamps} stamps
                    {card.redemptionCount > 0 && <> · {card.redemptionCount} reward{card.redemptionCount === 1 ? '' : 's'} claimed</>}
                  </div>

                  {/* Public URL row */}
                  <div className="flex items-center gap-2 rounded bg-muted/40 px-2.5 py-1.5">
                    <code className="text-[11px] flex-1 truncate text-muted-foreground">{url}</code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(url);
                        toast.success('Link copied');
                      }}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title="Copy link"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => window.open(`/stamps/${card.publicToken}?print=1`, '_blank')}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title="Print card with QR"
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => setAdjustOpen(card)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted"
                    >
                      <Sliders className="h-3.5 w-3.5" /> Adjust
                    </button>
                    <button
                      disabled={!ready || redeemMut.isPending}
                      onClick={() => redeemMut.mutate(card.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] text-white text-xs px-2.5 py-1.5 hover:opacity-90 disabled:opacity-40"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Redeem reward
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {adjustOpen && (
        <AdjustModal
          card={adjustOpen}
          customerId={customer.id}
          onClose={() => setAdjustOpen(null)}
          onDone={() => { setAdjustOpen(null); invalidate(); }}
        />
      )}
    </div>
  );
}

function AdjustModal({
  card, customerId, onClose, onDone,
}: { card: Card; customerId: string; onClose: () => void; onDone: () => void }) {
  void customerId;
  const [delta, setDelta] = useState(1);
  const [note, setNote]   = useState('');
  const adjustMut = useMutation({
    mutationFn: () => api.post(`/loyalty/cards/${card.id}/adjust`, { delta, note: note.trim() }).then((r) => r.data),
    onSuccess: () => { toast.success('Adjusted.'); onDone(); },
    onError:   (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to adjust.'),
  });
  const inputCls = 'w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40';
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl bg-card border border-border p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Adjust stamps · {card.templateName}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground">
          Use this to fix data-entry mistakes or honor a manual punch. Both positive and negative
          deltas are recorded with the staff member who applied them.
        </p>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Delta</span>
          <input
            type="number"
            className={inputCls}
            value={delta}
            onChange={(e) => setDelta(Number(e.target.value || 0))}
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Reason (required)</span>
          <input
            className={inputCls}
            placeholder="e.g. Honoring punch from yesterday's missed scan"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => adjustMut.mutate()}
            disabled={adjustMut.isPending || !note.trim() || delta === 0}
            className="rounded-lg bg-[var(--accent)] text-white text-sm px-3 py-2 hover:opacity-90 disabled:opacity-50"
          >
            {adjustMut.isPending ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
