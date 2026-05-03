'use client';

/**
 * ParkedSalesModal — recall list for parked sales on this terminal.
 *
 * Shows a vertical list with the parked-sale name, age, item count, and
 * total. Tapping "Recall" replaces the current cart (warning if non-empty).
 * Tapping the trash icon discards the parked sale.
 */

import { useEffect, useState } from 'react';
import { Clock, ShoppingBag, Trash2, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useParkedSalesStore, type ParkedSale } from '@/store/pos/parkedSales';
import { useCartStore } from '@/store/pos/cart';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

interface ParkedSalesModalProps {
  open: boolean;
  onClose: () => void;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

export function ParkedSalesModal({ open, onClose }: ParkedSalesModalProps) {
  const sales = useParkedSalesStore((s) => s.sales);
  const remove = useParkedSalesStore((s) => s.remove);
  const prune  = useParkedSalesStore((s) => s.prune);
  const currentLines = useCartStore((s) => s.lines);
  const clearCart    = useCartStore((s) => s.clearCart);

  const [confirmRecall, setConfirmRecall] = useState<ParkedSale | null>(null);

  // Drop expired entries every time the modal opens so we never show
  // sales that are about to disappear from the underlying store.
  useEffect(() => {
    if (open) prune();
  }, [open, prune]);

  function recall(sale: ParkedSale) {
    // Re-hydrate cart from the parked sale's snapshot.
    // Note: we set state directly via useCartStore.setState() because the
    // store doesn't expose a single "loadFromSnapshot" action and mutating
    // through addItem() would lose the original promo/discount state.
    useCartStore.setState({
      lines: sale.lines,
      orderDiscount: sale.orderDiscount,
      // Restore multi-PWD entries so a paused shared-meal order survives
      // the park/recall cycle. Older parked sales (saved before this field
      // existed) get an empty array — graceful degradation.
      additionalPwdScEntries: sale.additionalPwdScEntries ?? [],
      branchId: sale.branchId,
      shiftId: sale.shiftId,
    });
    remove(sale.id);
    setConfirmRecall(null);
    onClose();
    toast.success(`Recalled "${sale.name}"`);
  }

  function tryRecall(sale: ParkedSale) {
    if (currentLines.length > 0) {
      setConfirmRecall(sale);
    } else {
      recall(sale);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              Parked Sales
              {sales.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground">({sales.length})</span>
              )}
            </DialogTitle>
          </DialogHeader>

          {sales.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No parked sales. Tap "Park Sale" in the cart to save the current order for later.
            </div>
          ) : (
            <ul className="divide-y divide-border max-h-[60vh] overflow-y-auto -mx-6">
              {sales
                .slice()
                .sort((a, b) => b.parkedAt - a.parkedAt)
                .map((sale) => (
                  <li key={sale.id} className="px-6 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{sale.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <Clock className="h-3 w-3" />
                        {timeAgo(sale.parkedAt)}
                        <span>·</span>
                        <span>{sale.itemCount} item{sale.itemCount !== 1 ? 's' : ''}</span>
                        <span>·</span>
                        <span className="font-semibold text-foreground">{formatPeso(sale.totalAmount)}</span>
                      </p>
                    </div>
                    <Button
                      onClick={() => tryRecall(sale)}
                      size="sm"
                      variant="default"
                      className="gap-1"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Recall
                    </Button>
                    <button
                      onClick={() => remove(sale.id)}
                      aria-label="Discard parked sale"
                      className="p-2 rounded-lg text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm replace */}
      <Dialog open={!!confirmRecall} onOpenChange={(v) => !v && setConfirmRecall(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Replace current cart?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Recalling <span className="font-semibold text-foreground">"{confirmRecall?.name}"</span> will discard
            the {currentLines.length} item{currentLines.length !== 1 ? 's' : ''} currently in your cart.
          </p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setConfirmRecall(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                clearCart();
                if (confirmRecall) recall(confirmRecall);
              }}
            >
              Discard &amp; recall
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
