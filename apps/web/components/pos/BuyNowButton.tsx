'use client';

/**
 * "What do we need to buy?" — in the POS header, where a cashier is.
 *
 * Cashiers are the first to notice something running out, but they cannot open
 * /pos/inventory (that is manager-only), so the answer has to come to them. One
 * tap shows the list; from there it prints on the same thermal printer that
 * does receipts, or downloads as the shopping sheet.
 *
 * The list is never invented here. It is whatever sits at or below the alert
 * level the owner set, worst first, and the slip on screen is byte-for-byte
 * what the printer produces — both come from one place on the server so the
 * paper and the screen cannot drift apart.
 */
import { useState } from 'react';
import { PackageSearch, Printer, Download, X, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { sendViaRawBt } from '@/lib/pos/printer-dispatch';
import { cn } from '@/lib/utils';

interface Slip {
  text:      string;
  count:     number;
  outCount:  number;
}

export function BuyNowButton({ branchId }: { branchId?: string }) {
  const [open,     setOpen]     = useState(false);
  const [slip,     setSlip]     = useState<Slip | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';

  async function show() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      setSlip((await api.get(`/inventory/low-stock/slip${qs}`)).data);
    } catch {
      // The cashier cannot fix a failed request; saying so plainly beats an
      // empty panel that reads as "nothing to buy".
      setError('Could not load the list. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }

  async function print() {
    setPrinting(true);
    setError(null);
    try {
      const { data } = await api.post('/inventory/low-stock/print', { branchId });
      const bin = atob(data.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      sendViaRawBt(bytes);
    } catch {
      setError('Could not reach the printer. The list is still on screen.');
    } finally {
      setPrinting(false);
    }
  }

  function download() {
    // Goes through the same axios instance so the auth header rides along;
    // a bare window.open would hit the endpoint signed out.
    api.get(`/inventory/low-stock/export${qs}`, { responseType: 'blob' })
      .then((res) => {
        const url = URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'clerque-buy-now.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => setError('Could not build the sheet. Try again in a moment.'));
  }

  return (
    <>
      <button
        onClick={show}
        className="hidden sm:flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 rounded-md px-2.5 py-1.5 transition-colors"
        title="What is running low, and what to buy"
      >
        <PackageSearch className="h-3.5 w-3.5" />
        Buy Now
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white dark:bg-slate-900 shadow-xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">Buy Now</h2>
                {slip && (
                  <p className="text-xs text-slate-500">
                    {slip.count === 0
                      ? 'Nothing is below its alert level'
                      : `${slip.count} to buy${slip.outCount ? ` · ${slip.outCount} out of stock` : ''}`}
                  </p>
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loading && (
                <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking stock…
                </div>
              )}
              {error && (
                <p className="text-sm text-rose-600 dark:text-rose-400 mb-3">{error}</p>
              )}
              {slip && !loading && (
                // monospace, because it is the receipt laid out for 32 columns
                <pre className="font-mono text-[11px] leading-[1.45] text-slate-800 dark:text-slate-200 whitespace-pre">
                  {slip.text}
                </pre>
              )}
            </div>

            <div className="flex gap-2 border-t border-slate-200 dark:border-slate-700 px-4 py-3">
              <button
                onClick={print}
                disabled={printing || loading || !slip}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium',
                  'bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50',
                  'dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
                )}
              >
                {printing
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Printer className="h-4 w-4" />}
                Print
              </button>
              <button
                onClick={download}
                disabled={loading}
                className="flex items-center justify-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                title="Excel sheet to take shopping — fill in what you buy"
              >
                <Download className="h-4 w-4" />
                Sheet
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
