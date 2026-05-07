'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Truck, Plus, Send, Inbox, X, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type TransferStatus = 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';

interface Transfer {
  id:             string;
  transferNumber: string;
  status:         TransferStatus;
  fromBranch:     { id: string; name: string };
  toBranch:       { id: string; name: string };
  createdAt:      string;
  sentAt:         string | null;
  receivedAt:     string | null;
  notes:          string | null;
  _count:         { lines: number };
}

interface Branch       { id: string; name: string }
interface RawMaterial  { id: string; name: string; unit: string; costPrice: string | null }

const TINT: Record<TransferStatus, string> = {
  DRAFT:      'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  IN_TRANSIT: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  RECEIVED:   'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  CANCELLED:  'bg-red-500/15 text-red-600',
};

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium' });
}

export default function StockTransfersPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const { data: transfers = [], isLoading } = useQuery<Transfer[]>({
    queryKey: ['stock-transfers'],
    queryFn:  () => api.get('/warehouse/transfers').then((r) => r.data),
  });

  const send = useMutation({
    mutationFn: (id: string) => api.post(`/warehouse/transfers/${id}/send`).then((r) => r.data),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['stock-transfers'] }); toast.success('Sent.'); },
    onError:    (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });
  const receive = useMutation({
    mutationFn: (id: string) => api.post(`/warehouse/transfers/${id}/receive`).then((r) => r.data),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['stock-transfers'] }); toast.success('Received.'); },
    onError:    (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/warehouse/transfers/${id}/cancel`).then((r) => r.data),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['stock-transfers'] }); toast.success('Cancelled.'); },
    onError:    (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Truck className="h-6 w-6 text-[var(--accent)]" />
            Stock Transfers
          </h1>
          <p className="text-sm text-muted-foreground">Move raw materials between branches.</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New Transfer
        </button>
      </header>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground text-center">Loading…</div>
        ) : transfers.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No transfers yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Number</th>
                <th className="text-left px-4 py-2 font-medium">From → To</th>
                <th className="text-right px-4 py-2 font-medium">Lines</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Created</th>
                <th className="text-center px-4 py-2 font-medium">Status</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id} className="border-t border-border/40">
                  <td className="px-4 py-2.5 font-mono text-xs">{t.transferNumber}</td>
                  <td className="px-4 py-2.5">
                    {t.fromBranch.name} <ArrowRight className="inline h-3 w-3 mx-1 text-muted-foreground" /> {t.toBranch.name}
                  </td>
                  <td className="px-4 py-2.5 text-right">{t._count.lines}</td>
                  <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">{fmt(t.createdAt)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${TINT[t.status]}`}>
                      {t.status.toLowerCase().replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap">
                    {t.status === 'DRAFT' && (
                      <button onClick={() => send.mutate(t.id)} disabled={send.isPending} className="p-1.5 rounded text-blue-600 hover:bg-blue-500/15" title="Send">
                        <Send className="h-4 w-4" />
                      </button>
                    )}
                    {t.status === 'IN_TRANSIT' && (
                      <button onClick={() => receive.mutate(t.id)} disabled={receive.isPending} className="p-1.5 rounded text-emerald-700 hover:bg-emerald-500/15" title="Receive">
                        <Inbox className="h-4 w-4" />
                      </button>
                    )}
                    {(t.status === 'DRAFT' || t.status === 'IN_TRANSIT') && (
                      <button onClick={() => cancel.mutate(t.id)} disabled={cancel.isPending} className="p-1.5 rounded text-red-600 hover:bg-red-500/15 ml-1" title="Cancel">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showNew && <NewTransferModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

// ── New transfer modal ──────────────────────────────────────────────────────
function NewTransferModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();

  const { data: branchData } = useQuery<{ data: Branch[] }>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
  });
  const branches = branchData?.data ?? [];

  const { data: rawMaterials = [] } = useQuery<RawMaterial[]>({
    queryKey: ['raw-materials'],
    queryFn:  () => api.get('/inventory/raw-materials').then((r) => r.data).catch(() => []),
  });

  const [fromBranchId, setFromBranchId] = useState('');
  const [toBranchId,   setToBranchId]   = useState('');
  const [notes,        setNotes]        = useState('');
  const [lines,        setLines]        = useState<Array<{ rawMaterialId: string; quantity: number }>>([]);

  const create = useMutation({
    mutationFn: () => api.post('/warehouse/transfers', { fromBranchId, toBranchId, notes, lines }).then((r) => r.data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['stock-transfers'] });
      toast.success('Transfer created (DRAFT).');
      onClose();
    },
    onError:    (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  function addLine() { setLines([...lines, { rawMaterialId: '', quantity: 0 }]); }
  function patchLine(idx: number, p: Partial<{ rawMaterialId: string; quantity: number }>) {
    setLines(lines.map((l, i) => i === idx ? { ...l, ...p } : l));
  }
  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <header className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-border">
          <h2 className="font-semibold">New Stock Transfer</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-xs text-muted-foreground">From branch</span>
              <select value={fromBranchId} onChange={(e) => setFromBranchId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <option value="">— select —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-xs text-muted-foreground">To branch</span>
              <select value={toBranchId} onChange={(e) => setToBranchId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <option value="">— select —</option>
                {branches.filter((b) => b.id !== fromBranchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          </div>

          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Notes</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </label>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Lines</span>
              <button type="button" onClick={addLine} className="text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-1">
                <Plus className="h-3 w-3" /> Add line
              </button>
            </div>
            {lines.length === 0 && <p className="text-xs text-muted-foreground italic">No lines yet.</p>}
            {lines.map((l, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center mb-1.5">
                <select
                  value={l.rawMaterialId}
                  onChange={(e) => patchLine(idx, { rawMaterialId: e.target.value })}
                  className="col-span-7 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">— ingredient —</option>
                  {rawMaterials.map((rm) => <option key={rm.id} value={rm.id}>{rm.name} ({rm.unit})</option>)}
                </select>
                <input
                  type="number" step="0.001" placeholder="Qty"
                  value={l.quantity || ''}
                  onChange={(e) => patchLine(idx, { quantity: Number(e.target.value) })}
                  className="col-span-4 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                />
                <button type="button" onClick={() => removeLine(idx)} className="col-span-1 text-red-500 hover:bg-red-500/10 rounded p-1.5">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
        <footer className="px-5 pb-5 flex justify-end gap-2 border-t border-border pt-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending || !fromBranchId || !toBranchId || lines.length === 0 || lines.some((l) => !l.rawMaterialId || l.quantity <= 0)}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create DRAFT'}
          </button>
        </footer>
      </div>
    </div>
  );
}
