'use client';
/**
 * Laundromat Fleet Dashboard (Sprint 19)
 *
 * Operator-facing wall view of every machine in the fleet. Each tile is a
 * full-size box with:
 *   - Big mm:ss countdown when running (red when over)
 *   - Filled progress bar (elapsed / cycle duration)
 *   - Cycle name, claim #, customer below
 *   - Color-coded status: emerald (idle) / amber (running) / red (over) / gray (out of order)
 *
 * Click a tile to open a quick-action sheet: mark done now, mark out of
 * order, navigate to the related order. Read-only otherwise.
 *
 * Refresh: machine list every 5 seconds; every-second tick re-renders
 * countdown labels without burning network calls.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity, WashingMachine, Wind, AlertTriangle, CheckCircle2, X,
  ExternalLink, Combine,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface RunningLine {
  id:                string;
  startedAt:         string | null;
  cycleEndsAt:       string | null;
  cycleAutoComplete: boolean;
  cycle: { id: string; name: string; durationMinutes: number } | null;
  order: { id: string; claimNumber: string; customer: { id: string; name: string } | null };
}

interface Machine {
  id:         string;
  code:       string;
  kind:       'WASHER' | 'DRYER' | 'COMBO';
  capacityKg: string;
  status:     'IDLE' | 'RUNNING' | 'OUT_OF_ORDER';
  branch:     { id: string; name: string };
  lines:      RunningLine[];
}

function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function formatCountdown(endIso: string | null, durationMin: number | null) {
  if (!endIso) return { mmss: '', over: false, fillPct: 0 };
  const end = new Date(endIso).getTime();
  const remainingMs = end - Date.now();
  const totalMs = (durationMin ?? 30) * 60_000;
  const elapsedMs = Math.max(0, totalMs - remainingMs);
  const fillPct = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));

  if (remainingMs <= 0) {
    const overSec = Math.floor(-remainingMs / 1000);
    const m = Math.floor(overSec / 60);
    const s = overSec % 60;
    return { mmss: `+${m}:${String(s).padStart(2, '0')}`, over: true, fillPct: 100 };
  }
  const totalSec = Math.floor(remainingMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return { mmss: `${m}:${String(s).padStart(2, '0')}`, over: false, fillPct };
}

function elapsedSinceStart(startedAtIso: string | null) {
  if (!startedAtIso) return '';
  const sec = Math.floor((Date.now() - new Date(startedAtIso).getTime()) / 1000);
  if (sec < 60) return `${sec}s elapsed`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')} elapsed`;
}

export default function LaundryFleetPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState<Machine | null>(null);

  const { data: machines = [] } = useQuery<Machine[]>({
    queryKey: ['laundry-machines-fleet'],
    queryFn:  () => api.get('/laundry/machines').then((r) => r.data),
    refetchInterval: 5_000,
  });
  useTick(1000);

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Machine['status'] }) =>
      api.patch(`/laundry/machines/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-machines-fleet'] });
      qc.invalidateQueries({ queryKey: ['laundry-machines'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const markDone = useMutation({
    mutationFn: (lineId: string) =>
      api.patch(`/laundry/lines/${lineId}/done`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-machines-fleet'] });
      qc.invalidateQueries({ queryKey: ['laundry-machines'] });
      qc.invalidateQueries({ queryKey: ['laundry-orders'] });
      toast.success('Marked done.');
      setActive(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const idleCount    = machines.filter((m) => m.status === 'IDLE').length;
  const runningCount = machines.filter((m) => m.status === 'RUNNING').length;
  const oooCount     = machines.filter((m) => m.status === 'OUT_OF_ORDER').length;

  return (
    <div className="flex flex-col h-full overflow-auto bg-muted/20">
      {/* Header */}
      <header className="bg-background border-b border-border px-4 sm:px-6 py-4 shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-[var(--accent)]" />
          <h1 className="text-xl font-semibold">Fleet</h1>
          <span className="text-xs text-muted-foreground ml-2">
            {machines.length} machine{machines.length === 1 ? '' : 's'} ·{' '}
            <span className="text-emerald-600">{idleCount} idle</span> ·{' '}
            <span className="text-amber-600">{runningCount} running</span>
            {oooCount > 0 && <> · <span className="text-red-600">{oooCount} out</span></>}
          </span>
        </div>
        <Link
          href="/pos/laundry/queue"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Queue view <ExternalLink className="h-3 w-3" />
        </Link>
      </header>

      {/* Tile grid */}
      <main className="flex-1 p-3 sm:p-5">
        {machines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
            <Activity className="h-10 w-10 opacity-30" />
            <p className="text-sm">No machines yet.</p>
            <Link
              href="/settings/laundry?tab=machines"
              className="text-xs text-[var(--accent)] hover:underline"
            >
              Add washers + dryers under Settings → Laundry → Machines
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {machines.map((m) => (
              <MachineTile
                key={m.id}
                machine={m}
                onClick={() => setActive(m)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Quick-action sheet */}
      {active && (
        <QuickActionSheet
          machine={active}
          onClose={() => setActive(null)}
          onMarkDone={(lineId) => markDone.mutate(lineId)}
          onSetStatus={(s) => setStatus.mutate({ id: active.id, status: s })}
          busy={markDone.isPending || setStatus.isPending}
        />
      )}
    </div>
  );
}

// ─── Machine tile ────────────────────────────────────────────────────────────

function MachineTile({ machine, onClick }: { machine: Machine; onClick: () => void }) {
  const Icon =
    machine.kind === 'WASHER' ? WashingMachine :
    machine.kind === 'DRYER'  ? Wind            :
                                Combine;
  const runningLine = machine.lines[0] ?? null;

  // Color tints — we deliberately go bold here; this tile is meant to read
  // from across the room.
  const tint =
    machine.status === 'OUT_OF_ORDER' ? 'border-red-500/50    bg-red-50    dark:bg-red-950/30 text-red-700  dark:text-red-400'  :
    machine.status === 'IDLE'         ? 'border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300' :
                                        'border-amber-500/50  bg-amber-50  dark:bg-amber-950/30 text-amber-800 dark:text-amber-300';

  // Countdown / progress when a cycle was picked at start.
  const cd = formatCountdown(
    runningLine?.cycleEndsAt ?? null,
    runningLine?.cycle?.durationMinutes ?? null,
  );
  const overTime = cd.over;

  // Outline flips to red when over time — the eye-catcher.
  const ringClass = machine.status === 'RUNNING' && overTime
    ? 'ring-2 ring-red-500/60 animate-pulse'
    : '';

  return (
    <button
      onClick={onClick}
      className={`group relative rounded-2xl border-2 ${tint} ${ringClass} p-4 flex flex-col gap-2.5 transition-all hover:shadow-lg hover:-translate-y-0.5 text-left min-h-[180px]`}
    >
      {/* Top: icon + code + status pill */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className="h-5 w-5 shrink-0 opacity-90" />
          <span className="text-3xl font-bold font-mono tracking-tight leading-none">
            {machine.code}
          </span>
        </div>
        <span className="text-[9px] font-bold uppercase tracking-wider opacity-80 mt-1.5">
          {machine.status === 'OUT_OF_ORDER' ? 'OUT' : machine.status}
        </span>
      </div>
      <div className="text-[10px] opacity-70">
        {Number(machine.capacityKg).toFixed(0)}kg · {machine.kind.toLowerCase()}
      </div>

      {/* Body: countdown OR idle placeholder */}
      {machine.status === 'RUNNING' && runningLine ? (
        <>
          {runningLine.cycleEndsAt ? (
            <div className="flex flex-col items-center gap-1.5 mt-1">
              <div className={`text-4xl font-mono font-bold tabular-nums ${overTime ? 'text-red-700 dark:text-red-400' : ''}`}>
                {cd.mmss}
              </div>
              {/* Progress bar */}
              <div className="w-full h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                <div
                  className={`h-full transition-all ${overTime ? 'bg-red-500' : 'bg-amber-500'}`}
                  style={{ width: `${cd.fillPct}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="text-xs italic opacity-70 mt-1">
              {elapsedSinceStart(runningLine.startedAt)}
            </div>
          )}

          {/* Bottom: cycle name + claim # + customer */}
          <div className="mt-auto space-y-0.5">
            {runningLine.cycle && (
              <div className="text-xs font-semibold truncate">{runningLine.cycle.name}</div>
            )}
            <div className="text-[10px] font-mono opacity-80 truncate">
              {runningLine.order.claimNumber}
            </div>
            <div className="text-[11px] truncate">
              {runningLine.order.customer?.name ?? <span className="italic opacity-60">Walk-in</span>}
            </div>
            {runningLine.cycleAutoComplete && (
              <div className="text-[9px] uppercase tracking-wider opacity-60">auto</div>
            )}
          </div>
        </>
      ) : machine.status === 'OUT_OF_ORDER' ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-1 opacity-80">
          <AlertTriangle className="h-6 w-6" />
          <div className="text-xs font-medium">Out of Order</div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 gap-1 opacity-50">
          <CheckCircle2 className="h-6 w-6" />
          <div className="text-xs font-medium">Idle</div>
        </div>
      )}
    </button>
  );
}

// ─── Quick-action sheet ──────────────────────────────────────────────────────

function QuickActionSheet({
  machine, onClose, onMarkDone, onSetStatus, busy,
}: {
  machine:     Machine;
  onClose:     () => void;
  onMarkDone:  (lineId: string) => void;
  onSetStatus: (status: Machine['status']) => void;
  busy:        boolean;
}) {
  const runningLine = machine.lines[0] ?? null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-md bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold font-mono">{machine.code}</span>
            <span className="text-xs text-muted-foreground">
              {machine.kind.toLowerCase()} · {Number(machine.capacityKg).toFixed(0)}kg
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-5 space-y-3">
          {runningLine && (
            <div className="rounded-lg bg-muted/40 p-3 space-y-1">
              <div className="text-xs text-muted-foreground">Currently running</div>
              <div className="text-sm font-semibold">{runningLine.cycle?.name ?? 'No cycle picked'}</div>
              <div className="text-xs">
                <Link href={`/pos/laundry/${runningLine.order.id}`} className="font-mono text-[var(--accent)] hover:underline">
                  {runningLine.order.claimNumber}
                </Link>
                {runningLine.order.customer && <> · {runningLine.order.customer.name}</>}
              </div>
            </div>
          )}

          {machine.status === 'RUNNING' && runningLine && (
            <button
              onClick={() => onMarkDone(runningLine.id)}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" /> Mark Done & Free Machine
            </button>
          )}

          {machine.status === 'IDLE' && (
            <button
              onClick={() => onSetStatus('OUT_OF_ORDER')}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-md border border-red-300 text-red-600 hover:bg-red-500/10 text-sm font-medium disabled:opacity-50"
            >
              <AlertTriangle className="h-4 w-4" /> Mark Out of Order
            </button>
          )}

          {machine.status === 'OUT_OF_ORDER' && (
            <button
              onClick={() => onSetStatus('IDLE')}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" /> Mark Repaired (Idle)
            </button>
          )}

          <Link
            href="/pos/laundry/queue"
            className="block text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Open queue view →
          </Link>
        </div>
      </div>
    </div>
  );
}
