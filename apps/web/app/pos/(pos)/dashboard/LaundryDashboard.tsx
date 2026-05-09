'use client';
/**
 * Laundromat dashboard — replaces the F&B / Retail Sales Dashboard for tenants
 * whose businessType === LAUNDRY. Surfaces what a laundromat operator actually
 * cares about: active loads in each stage, today's intake count, pickup-due,
 * and recent revenue.
 *
 * Builds on existing backend endpoints (/laundry/orders + /orders) — no new
 * APIs needed for the v1 of this page.
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Sparkles, WashingMachine, Wind, Combine, Shirt, PackageCheck,
  Clock, ShoppingBag, TrendingUp, CheckCircle2, Circle, ArrowRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';

type LaundryStatus =
  | 'RECEIVED' | 'WASHING' | 'DRYING' | 'FOLDING'
  | 'READY_FOR_PICKUP' | 'CLAIMED' | 'CANCELLED';

interface LaundryOrder {
  id:           string;
  claimNumber:  string;
  status:       LaundryStatus;
  totalAmount:  string;
  receivedAt:   string;
  promisedAt:   string | null;
  customer:     { name: string } | null;
}

const STAGE_TILES: Array<{ label: string; status: LaundryStatus; icon: any; color: string }> = [
  { label: 'Received',   status: 'RECEIVED',         icon: Sparkles,        color: 'sky' },
  { label: 'Washing',    status: 'WASHING',          icon: WashingMachine,  color: 'blue' },
  { label: 'Drying',     status: 'DRYING',           icon: Wind,            color: 'amber' },
  { label: 'Folding',    status: 'FOLDING',          icon: Combine,         color: 'violet' },
  { label: 'Ready',      status: 'READY_FOR_PICKUP', icon: PackageCheck,    color: 'emerald' },
];

const COLOR_CLASSES: Record<string, string> = {
  sky:     'border-sky-300/40 bg-sky-50/40 dark:bg-sky-950/20 text-sky-700 dark:text-sky-300',
  blue:    'border-blue-300/40 bg-blue-50/40 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300',
  amber:   'border-amber-300/40 bg-amber-50/40 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300',
  violet:  'border-violet-300/40 bg-violet-50/40 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300',
  emerald: 'border-emerald-300/40 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300',
};

function todayBoundsPH(): { startISO: string; endISO: string } {
  const now = new Date();
  const ph  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const dayKey = ph.toISOString().slice(0, 10);
  const start  = new Date(`${dayKey}T00:00:00+08:00`).toISOString();
  const end    = new Date(`${dayKey}T23:59:59+08:00`).toISOString();
  return { startISO: start, endISO: end };
}

interface ServicePrice { unitPrice: string; isActive: boolean }
interface MachineLite  { id: string }
interface BranchLite   { id: string; isActive: boolean }

export function LaundryDashboard() {
  // Active orders — anything not CLAIMED / CANCELLED.
  // Backend returns paginated shape { data, total, take, skip }, but a
  // legacy stub returned a bare array. Defensively unwrap both.
  const { data: activeOrders = [] } = useQuery<LaundryOrder[]>({
    queryKey: ['laundry-active-orders'],
    queryFn:  () => api.get('/laundry/orders?status=active').then((r) => {
      const payload = r.data;
      return Array.isArray(payload) ? payload : (payload?.data ?? []);
    }),
    refetchInterval: 30_000, // 30s — board feels live without hammering the API
  });

  // Setup-checklist signals — read-only queries used to determine which steps
  // a fresh tenant still has to complete. Each query is small and cached;
  // unused on already-set-up tenants because the checklist is hidden.
  const { data: prices = [] }   = useQuery<ServicePrice[]>({
    queryKey: ['laundry-service-prices'],
    queryFn:  () => api.get('/laundry/service-prices').then((r) => r.data),
    staleTime: 60_000,
  });
  const { data: machines = [] } = useQuery<MachineLite[]>({
    queryKey: ['laundry-machines-dash'],
    queryFn:  () => api.get('/laundry/machines').then((r) => r.data),
    staleTime: 60_000,
  });
  const { data: branches = [] } = useQuery<BranchLite[]>({
    queryKey: ['tenant-branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
    staleTime: 60_000,
  });

  const hasPrices    = prices.some((p) => p.isActive && Number(p.unitPrice) > 0);
  const hasMachines  = machines.length > 0;
  const hasBranch    = branches.some((b) => b.isActive);
  const hasOrders    = activeOrders.length > 0;
  const showChecklist = !hasPrices || !hasMachines || !hasOrders;

  // Today's intake — count of orders where receivedAt is today (PH time).
  const { data: todayOrders = [] } = useQuery<LaundryOrder[]>({
    queryKey: ['laundry-today-intake'],
    queryFn:  async () => {
      const { startISO, endISO } = todayBoundsPH();
      const r = await api.get(`/laundry/orders?from=${encodeURIComponent(startISO)}&to=${encodeURIComponent(endISO)}`);
      // Same paginated-shape unwrap as activeOrders above.
      const payload = r.data;
      return Array.isArray(payload) ? payload : (payload?.data ?? []);
    },
  });

  // Pickup-due today — orders with promisedAt today and not yet CLAIMED.
  const pickupDue = activeOrders.filter((o) => {
    if (!o.promisedAt) return false;
    const promised = new Date(o.promisedAt);
    const ph       = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return promised.toISOString().slice(0, 10) === ph.toISOString().slice(0, 10);
  });

  // Today's claimed revenue — sum totalAmount of CLAIMED orders received today.
  const todayClaimedRevenue = todayOrders
    .filter((o) => o.status === 'CLAIMED')
    .reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

  const counts: Record<LaundryStatus, number> = {
    RECEIVED:         0, WASHING: 0, DRYING: 0, FOLDING: 0,
    READY_FOR_PICKUP: 0, CLAIMED: 0, CANCELLED: 0,
  };
  for (const o of activeOrders) counts[o.status] = (counts[o.status] ?? 0) + 1;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Laundry Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Live workflow board, today's intake, and pickups due.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/pos/laundry/intake"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] text-white text-sm px-3 py-2 hover:opacity-90"
          >
            <Sparkles className="w-4 h-4" /> New Intake
          </Link>
          <Link
            href="/pos/laundry/queue"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border text-sm px-3 py-2 hover:bg-muted"
          >
            <Shirt className="w-4 h-4" /> Open Queue
          </Link>
        </div>
      </header>

      {/* ── First-run setup checklist ─────────────────────────────────── */}
      {showChecklist && (
        <section className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[var(--accent)]" />
              Get started
            </h2>
            <span className="text-xs text-muted-foreground">
              {[hasBranch, hasPrices, hasMachines, hasOrders].filter(Boolean).length} of 4 done
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Three things and you're ready to take your first claim. We'll hide this once you're set up.
          </p>
          <div className="space-y-1 pt-1">
            <ChecklistRow
              done={hasBranch}
              label="Add at least one branch"
              hint="If this is a single-location laundromat, the default Main branch is fine."
              href="/settings/branches"
            />
            <ChecklistRow
              done={hasPrices}
              label="Set service prices"
              hint="One-tap apply Manila default rates from Settings → Laundry."
              href="/settings/laundry"
            />
            <ChecklistRow
              done={hasMachines}
              label="Add washers + dryers (optional)"
              hint="Skip if you're starting small. You can assign loads to specific machines later."
              href="/settings/laundry?tab=machines"
            />
            <ChecklistRow
              done={hasOrders}
              label="Take your first intake"
              hint="Once prices are set, head to Intake and create a claim ticket."
              href="/pos/laundry/intake"
            />
          </div>
        </section>
      )}

      {/* ── Workflow board (live counts per stage) ─────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Active loads — workflow
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {STAGE_TILES.map(({ label, status, icon: Icon, color }) => (
            <Link
              key={status}
              href={`/pos/laundry/queue?status=${status}`}
              className={`rounded-xl border ${COLOR_CLASSES[color]} px-4 py-3 hover:opacity-90 transition`}
            >
              <div className="flex items-center justify-between">
                <Icon className="w-4 h-4 opacity-80" />
                <span className="text-2xl font-bold">{counts[status]}</span>
              </div>
              <p className="text-xs font-medium mt-1">{label}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Today's metrics ───────────────────────────────────────────── */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="uppercase tracking-wider">Today's intake</span>
            <ShoppingBag className="w-4 h-4" />
          </div>
          <p className="text-2xl font-bold mt-1">{todayOrders.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {todayOrders.filter((o) => o.status === 'CLAIMED').length} claimed · {todayOrders.length - todayOrders.filter((o) => o.status === 'CLAIMED').length} in progress
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="uppercase tracking-wider">Pickup due today</span>
            <Clock className="w-4 h-4" />
          </div>
          <p className="text-2xl font-bold mt-1">{pickupDue.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pickupDue.filter((o) => o.status === 'READY_FOR_PICKUP').length} ready · {pickupDue.filter((o) => o.status !== 'READY_FOR_PICKUP').length} still in queue
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="uppercase tracking-wider">Claimed today</span>
            <TrendingUp className="w-4 h-4" />
          </div>
          <p className="text-2xl font-bold mt-1">{formatPeso(todayClaimedRevenue)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            From {todayOrders.filter((o) => o.status === 'CLAIMED').length} pickups
          </p>
        </div>
      </section>

      {/* ── Pickup due list ───────────────────────────────────────────── */}
      {pickupDue.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Pickup due today
          </h2>
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {pickupDue.slice(0, 8).map((o) => (
              <Link
                key={o.id}
                href={`/pos/laundry/${o.id}`}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {o.customer?.name ?? 'Walk-in'} · <span className="font-mono text-xs text-muted-foreground">{o.claimNumber}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Promised {new Date(o.promisedAt!).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                    {' · '}
                    <span className={
                      o.status === 'READY_FOR_PICKUP'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }>
                      {o.status.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </p>
                </div>
                <span className="text-sm font-semibold">{formatPeso(Number(o.totalAmount))}</span>
              </Link>
            ))}
          </div>
          {pickupDue.length > 8 && (
            <Link href="/pos/laundry/queue" className="text-xs text-muted-foreground hover:text-foreground mt-2 inline-block">
              + {pickupDue.length - 8} more in the queue →
            </Link>
          )}
        </section>
      )}
    </div>
  );
}

function ChecklistRow({
  done, label, hint, href,
}: { done: boolean; label: string; hint: string; href: string }) {
  return (
    <Link
      href={href}
      className={`flex items-start gap-2 px-2 py-1.5 rounded-md transition-colors ${
        done ? 'opacity-60' : 'hover:bg-muted/40'
      }`}
    >
      {done
        ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
        : <Circle       className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
          {label}
        </p>
        {!done && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {!done && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground mt-1 shrink-0" />}
    </Link>
  );
}
