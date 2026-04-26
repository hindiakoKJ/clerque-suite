'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw, Printer, WifiOff, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { db } from '@/lib/pos/db';
import { syncPendingOrders } from '@/lib/pos/sync';
import { formatPeso } from '@/lib/utils';
import { useOnlineStatus } from '@/hooks/pos/useOnlineStatus';
import { toast } from 'sonner';

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash', GCASH_PERSONAL: 'GCash Personal', GCASH_BUSINESS: 'GCash Business',
  MAYA_PERSONAL: 'Maya Personal', MAYA_BUSINESS: 'Maya Business', QR_PH: 'QR Ph',
};

const STATUS_PILL: Record<string, string> = {
  PENDING: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  SYNCING: 'bg-[var(--accent-soft)] text-[var(--accent)]',
  FAILED:  'bg-red-500/10 text-red-500',
};

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function PendingOrdersPage() {
  const isOnline = useOnlineStatus();
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const pendingOrders = useLiveQuery(
    () => db.pendingOrders.orderBy('queuedAt').reverse().toArray(),
    [],
  ) ?? [];

  async function handleSync() {
    if (!isOnline) { toast.error('Cannot sync while offline.'); return; }
    setSyncing(true);
    try {
      const { synced, failed } = await syncPendingOrders();
      if (synced > 0) toast.success(`${synced} order${synced > 1 ? 's' : ''} synced.`);
      if (failed > 0) toast.error(`${failed} order${failed > 1 ? 's' : ''} failed to sync.`);
      if (synced === 0 && failed === 0) toast('Nothing to sync.');
    } catch {
      toast.error('Sync error.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Remove this pending order from the queue? It will NOT be synced.')) return;
    await db.pendingOrders.delete(id);
    toast.success('Order removed from queue.');
  }

  function printReceipt(order: (typeof pendingOrders)[0]) {
    const snap = order.receiptSnapshot as Record<string, unknown>;
    const win = window.open('', '_blank', 'width=400,height=700');
    if (!win) return;
    const lines = (snap.lines as Array<Record<string, unknown>> ?? []);
    const payments = (snap.payments as Array<Record<string, unknown>> ?? []);
    const linesHtml = lines.map((l) => `
      <div style="display:flex;justify-content:space-between;">
        <span>${l.productName}</span><span>₱${Number(l.lineTotal).toFixed(2)}</span>
      </div>
      <div style="color:#888;padding-left:8px;">${l.quantity} × ₱${Number(l.unitPrice).toFixed(2)}</div>
    `).join('');
    const paymentsHtml = payments.map((p) => `
      <div style="display:flex;justify-content:space-between;">
        <span>${METHOD_LABELS[p.method as string] ?? p.method}</span>
        <span>₱${Number(p.amount).toFixed(2)}</span>
      </div>
    `).join('');
    win.document.write(`<html><head><title>Receipt</title>
      <style>body{font-family:monospace;font-size:12px;margin:0;padding:16px}
      hr{border:none;border-top:1px dashed #000;margin:8px 0}</style></head>
      <body>
        <div style="background:#f59e0b;color:#fff;text-align:center;padding:4px;font-weight:bold;margin-bottom:8px;">
          OFFLINE ORDER — PENDING SYNC
        </div>
        <div style="text-align:center;margin-bottom:12px;">
          <strong>${String(snap.orderNumber ?? '')}</strong><br/>
          ${new Date(order.queuedAt).toLocaleString('en-PH')}
        </div>
        <hr/>${linesHtml}<hr/>
        <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:16px;">
          <span>TOTAL</span><span>₱${Number(snap.totalAmount ?? 0).toFixed(2)}</span>
        </div><hr/>
        ${paymentsHtml}
        <hr/><p style="text-align:center;color:#888;">Order queued — will sync when online.</p>
      </body></html>`);
    win.document.close();
    win.print();
    win.close();
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-auto">

      {/* Page header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Pending Offline Orders</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pendingOrders.length} order{pendingOrders.length !== 1 ? 's' : ''} waiting to sync
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isOnline && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-md px-2.5 py-1.5">
              <WifiOff className="h-3.5 w-3.5" />
              Offline
            </div>
          )}
          {pendingOrders.length > 0 && (
            <button
              onClick={handleSync}
              disabled={syncing || !isOnline}
              className="flex items-center gap-1.5 text-xs hover:opacity-90 disabled:opacity-50 text-white rounded-md px-3 py-1.5 font-medium transition-opacity"
              style={{ background: 'var(--accent)' }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {pendingOrders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <RefreshCw className="h-10 w-10 opacity-30" />
          <p className="text-sm">No pending orders. You&apos;re all caught up!</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-2">
          {pendingOrders.map((order) => {
            const snap = order.receiptSnapshot as Record<string, unknown>;
            const isExp = expanded === order.id;
            return (
              <div key={order.id} className="bg-card rounded-lg border border-border overflow-hidden">

                {/* Summary row */}
                <div
                  className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => setExpanded(isExp ? null : order.id!)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-foreground">
                        {String(snap.orderNumber ?? `LOCAL-${order.id}`)}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_PILL[order.status] ?? 'bg-secondary text-secondary-foreground'}`}>
                        {order.status}
                      </span>
                      {order.retries > 0 && (
                        <span className="text-[10px] text-muted-foreground">{order.retries} retries</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(order.queuedAt)}</p>
                    {order.lastError && (
                      <p className="text-[10px] text-red-500 mt-0.5 truncate">{order.lastError}</p>
                    )}
                  </div>
                  <span className="font-bold text-foreground text-sm shrink-0">
                    {formatPeso(Number(snap.totalAmount ?? 0))}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); printReceipt(order); }}
                      className="text-muted-foreground hover:text-[var(--accent)] transition-colors"
                      title="Print receipt"
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(order.id!); }}
                      className="text-muted-foreground hover:text-red-400 transition-colors"
                      title="Remove from queue"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    {isExp
                      ? <ChevronUp   className="h-4 w-4 text-muted-foreground" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    }
                  </div>
                </div>

                {/* Expanded detail */}
                {isExp && (
                  <div className="border-t border-border px-4 py-3 bg-muted/30 text-xs space-y-2">
                    <div>
                      <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-1">Items</p>
                      {(snap.lines as Array<Record<string, unknown>> ?? []).map((l, i) => (
                        <div key={i} className="flex justify-between text-foreground">
                          <span>{String(l.productName)} × {Number(l.quantity)}</span>
                          <span>{formatPeso(Number(l.lineTotal))}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-1">Payments</p>
                      {(snap.payments as Array<Record<string, unknown>> ?? []).map((p, i) => (
                        <div key={i} className="flex justify-between text-foreground">
                          <span className="text-muted-foreground">{METHOD_LABELS[String(p.method)] ?? String(p.method)}</span>
                          <span>{formatPeso(Number(p.amount))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
