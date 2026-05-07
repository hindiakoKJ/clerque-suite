'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Shirt, Phone, ArrowRight, X,
  WashingMachine, Wind, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// ── Types ───────────────────────────────────────────────────────────────────
type LaundryStatus =
  | 'RECEIVED' | 'WASHING' | 'DRYING' | 'FOLDING' | 'READY_FOR_PICKUP'
  | 'CLAIMED' | 'CANCELLED';

type LaundryServiceType =
  | 'WASH_FOLD' | 'WASH_ONLY' | 'DRY_ONLY'
  | 'DRY_CLEAN' | 'IRON_ONLY' | 'FULL_SERVICE';

interface LaundryOrder {
  id:           string;
  claimNumber:  string;
  status:       LaundryStatus;
  serviceType:  LaundryServiceType | null;
  pricingMode:  'PER_KG' | 'PER_LOAD' | 'PER_PIECE' | 'PER_GARMENT' | null;
  weightKg:     string | null;
  loadCount:    number | null;
  pieceCount:   number | null;
  totalAmount:  string;
  receivedAt:   string;
  promisedAt:   string | null;
  customer:     { id: string; name: string; contactPhone: string | null } | null;
  branch:       { id: string; name: string } | null;
  items:        Array<{ id: string; garmentType: string; quantity: number }>;
  lines?:       Array<{
    id: string;
    machineStatus: 'NOT_STARTED' | 'RUNNING' | 'DONE';
    machine: { id: string; code: string; kind: 'WASHER' | 'DRYER' | 'COMBO' } | null;
  }>;
}

const FLOW: LaundryStatus[] = ['RECEIVED', 'WASHING', 'DRYING', 'FOLDING', 'READY_FOR_PICKUP'];

const COLUMN_LABEL: Record<LaundryStatus, string> = {
  RECEIVED:         'Received',
  WASHING:          'Washing',
  DRYING:           'Drying',
  FOLDING:          'Folding',
  READY_FOR_PICKUP: 'Ready',
  CLAIMED:          'Claimed',
  CANCELLED:        'Cancelled',
};

const COLUMN_TINT: Record<LaundryStatus, string> = {
  RECEIVED:         'border-blue-200 bg-blue-50/50 dark:bg-blue-950/20',
  WASHING:          'border-cyan-200 bg-cyan-50/50 dark:bg-cyan-950/20',
  DRYING:           'border-amber-200 bg-amber-50/50 dark:bg-amber-950/20',
  FOLDING:          'border-violet-200 bg-violet-50/50 dark:bg-violet-950/20',
  READY_FOR_PICKUP: 'border-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/30',
  CLAIMED:          'border-muted bg-muted/30',
  CANCELLED:        'border-red-200 bg-red-50/40 dark:bg-red-950/20',
};

function fmtPrice(s: string | null) {
  if (s == null) return '—';
  const n = Number(s);
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);
}

function fmtQty(o: LaundryOrder) {
  // v2 multi-line: count total sets across service lines.
  if (o.lines && o.lines.length > 0) {
    return `${o.lines.length} line${o.lines.length === 1 ? '' : 's'}`;
  }
  if (o.pricingMode === 'PER_KG' && o.weightKg)    return `${Number(o.weightKg).toFixed(2)} kg`;
  if (o.pricingMode === 'PER_LOAD' && o.loadCount) return `${o.loadCount} load${o.loadCount > 1 ? 's' : ''}`;
  if (o.pieceCount)                                 return `${o.pieceCount} pcs`;
  return '—';
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Manila',
  });
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function LaundryQueuePage() {
  const qc = useQueryClient();

  const { data: page, isLoading } = useQuery<{ data: LaundryOrder[]; total: number; take: number; skip: number }>({
    queryKey: ['laundry-orders'],
    queryFn:  () => api.get('/laundry/orders?take=100').then((r) => {
      // Backward-compat: older API returned a bare array
      const d = r.data;
      if (Array.isArray(d)) return { data: d, total: d.length, take: d.length, skip: 0 };
      return d;
    }),
    refetchInterval: 30_000,
  });
  const orders: LaundryOrder[] = page?.data ?? [];

  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LaundryStatus }) =>
      api.patch(`/laundry/orders/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-orders'] });
      toast.success('Status updated.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Failed to update status.');
    },
  });

  // Group orders by status column.
  const grouped = useMemo(() => {
    const map: Record<LaundryStatus, LaundryOrder[]> = {
      RECEIVED: [], WASHING: [], DRYING: [], FOLDING: [], READY_FOR_PICKUP: [],
      CLAIMED: [], CANCELLED: [],
    };
    for (const o of orders) map[o.status].push(o);
    return map;
  }, [orders]);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Shirt className="h-6 w-6 text-[var(--accent)]" />
            Laundry Queue
          </h1>
          <p className="text-sm text-muted-foreground">Tap a card to advance through the workflow.</p>
        </div>
        <Link
          href="/pos/laundry/intake"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          New Intake
        </Link>
      </header>

      {/* Machine grid panel */}
      <MachineGrid />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading orders…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {FLOW.map((col, idx) => {
            const next = FLOW[idx + 1];
            const list = grouped[col];
            return (
              <section
                key={col}
                className={`rounded-xl border ${COLUMN_TINT[col]} flex flex-col min-h-[200px]`}
              >
                <header className="px-3 py-2 border-b border-inherit flex items-center justify-between text-xs font-semibold uppercase tracking-wide">
                  <span>{COLUMN_LABEL[col]}</span>
                  <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {list.length}
                  </span>
                </header>
                <div className="p-2 flex-1 space-y-2">
                  {list.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-6">— empty —</div>
                  )}
                  {list.map((o) => (
                    <article
                      key={o.id}
                      className="rounded-lg bg-background border border-border p-3 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/pos/laundry/${o.id}`} className="font-mono text-xs font-semibold text-[var(--accent)] hover:underline">
                          {o.claimNumber}
                        </Link>
                        <span className="text-xs font-semibold">{fmtPrice(o.totalAmount)}</span>
                      </div>
                      <div className="mt-1 text-sm font-medium leading-tight">
                        {o.customer?.name ?? <span className="text-muted-foreground italic">Walk-in</span>}
                      </div>
                      {o.customer?.contactPhone && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {o.customer.contactPhone}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">
                        {fmtQty(o)}{o.serviceType ? ` · ${o.serviceType.replace(/_/g, ' ').toLowerCase()}` : ''}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Received {fmtTime(o.receivedAt)}
                      </div>

                      {/* Machine chips — show codes currently assigned to this customer's lines */}
                      {(() => {
                        const machines = (o.lines ?? [])
                          .filter((l) => l.machine)
                          .map((l) => ({ code: l.machine!.code, kind: l.machine!.kind, status: l.machineStatus }));
                        if (machines.length === 0) return null;
                        return (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {machines.map((m, i) => {
                              const tint =
                                m.status === 'RUNNING' ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40' :
                                m.status === 'DONE'    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' :
                                                          'bg-muted text-muted-foreground border-border';
                              return (
                                <span
                                  key={i}
                                  className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-mono font-bold ${tint}`}
                                  title={`${m.code} · ${m.kind.toLowerCase()} · ${m.status.toLowerCase()}`}
                                >
                                  {m.code}
                                </span>
                              );
                            })}
                          </div>
                        );
                      })()}

                      <div className="mt-2 flex gap-1.5">
                        {next && (
                          <button
                            onClick={() => advance.mutate({ id: o.id, status: next })}
                            disabled={advance.isPending}
                            className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] text-xs font-medium px-2 py-1.5 transition-colors disabled:opacity-50"
                          >
                            {COLUMN_LABEL[next]}
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        )}
                        {col === 'READY_FOR_PICKUP' && (
                          <Link
                            href={`/pos/laundry/${o.id}`}
                            className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 text-xs font-semibold px-2 py-1.5"
                          >
                            Claim
                          </Link>
                        )}
                        {col !== 'READY_FOR_PICKUP' && (
                          <button
                            onClick={() => advance.mutate({ id: o.id, status: 'CANCELLED' })}
                            className="rounded-md bg-red-500/8 hover:bg-red-500/15 text-red-600 px-2 py-1.5"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Machine grid (washer/dryer fleet panel) ────────────────────────────────
interface Machine {
  id:         string;
  code:       string;
  kind:       'WASHER' | 'DRYER' | 'COMBO';
  capacityKg: string;
  status:     'IDLE' | 'RUNNING' | 'OUT_OF_ORDER';
  branch:     { id: string; name: string };
  lines:      Array<{
    id: string;
    order: {
      id: string;
      claimNumber: string;
      customer: { id: string; name: string } | null;
    };
  }>;
}

function MachineGrid() {
  const qc = useQueryClient();

  const { data: machines = [] } = useQuery<Machine[]>({
    queryKey: ['laundry-machines'],
    queryFn:  () => api.get('/laundry/machines').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Machine['status'] }) =>
      api.patch(`/laundry/machines/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-machines'] });
      qc.invalidateQueries({ queryKey: ['laundry-orders'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const markDone = useMutation({
    mutationFn: (lineId: string) =>
      api.patch(`/laundry/lines/${lineId}/done`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-machines'] });
      qc.invalidateQueries({ queryKey: ['laundry-orders'] });
      toast.success('Marked done.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  if (machines.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
        No machines configured. Add washers + dryers under Settings → Laundry → Machines.
      </section>
    );
  }

  const idleCount    = machines.filter((m) => m.status === 'IDLE').length;
  const runningCount = machines.filter((m) => m.status === 'RUNNING').length;
  const oooCount     = machines.filter((m) => m.status === 'OUT_OF_ORDER').length;

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-semibold flex items-center gap-2">
          Machines
          <span className="text-xs font-normal text-muted-foreground">
            {idleCount} idle · {runningCount} running · {oooCount} out
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-5 gap-2">
        {machines.map((m) => {
          const Icon = m.kind === 'WASHER' ? WashingMachine : Wind;
          const tint =
            m.status === 'IDLE'         ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400' :
            m.status === 'RUNNING'      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'   :
                                          'border-red-500/40 bg-red-500/10 text-red-600';
          const runningLine = m.lines[0];
          const customerName = runningLine?.order.customer?.name;
          return (
            <div
              key={m.id}
              className={`rounded-lg border ${tint} p-2.5 flex flex-col gap-1 transition-colors min-h-[110px]`}
            >
              {/* Top row: machine code + icon + status */}
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="text-base font-bold font-mono leading-none">{m.code}</span>
                </div>
                <span className="text-[9px] uppercase tracking-wide font-semibold opacity-80">
                  {m.status === 'OUT_OF_ORDER' ? 'OUT' : m.status.toLowerCase()}
                </span>
              </div>
              <div className="text-[10px] opacity-70">{Number(m.capacityKg).toFixed(0)}kg · {m.kind.toLowerCase()}</div>

              {/* Customer + claim # — only for RUNNING */}
              {runningLine ? (
                <Link
                  href={`/pos/laundry/${runningLine.order.id}`}
                  className="block mt-auto rounded bg-background/60 hover:bg-background px-1.5 py-1 text-left transition-colors"
                  title={runningLine.order.claimNumber}
                >
                  <div className="text-xs font-semibold truncate text-foreground">
                    {customerName ?? <span className="italic text-muted-foreground">Walk-in</span>}
                  </div>
                  <div className="text-[10px] font-mono opacity-70 truncate">{runningLine.order.claimNumber}</div>
                </Link>
              ) : (
                <div className="mt-auto h-[2.4rem]" />
              )}

              {/* Action row */}
              <div className="flex items-center justify-end gap-1 -mt-0.5">
                {m.status === 'RUNNING' && runningLine && (
                  <button
                    onClick={() => markDone.mutate(runningLine.id)}
                    className="inline-flex items-center gap-0.5 rounded text-[10px] bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 font-semibold"
                    title="Mark done"
                  >
                    <CheckCircle2 className="h-3 w-3" /> done
                  </button>
                )}
                {m.status === 'IDLE' && (
                  <button
                    onClick={() => setStatus.mutate({ id: m.id, status: 'OUT_OF_ORDER' })}
                    className="text-[10px] text-muted-foreground hover:text-red-600"
                    title="Mark out of order"
                  >
                    <AlertTriangle className="inline h-3 w-3" />
                  </button>
                )}
                {m.status === 'OUT_OF_ORDER' && (
                  <button
                    onClick={() => setStatus.mutate({ id: m.id, status: 'IDLE' })}
                    className="text-[10px] text-emerald-600 hover:underline"
                  >
                    fix
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
