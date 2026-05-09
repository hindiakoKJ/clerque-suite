'use client';
/**
 * Project detail — overview + issuances + P&L.
 *
 * The P&L tab calls GET /projects/:id/pl which returns:
 *   { budgetAmount, totalIssuedCost, remainingBudget, issuanceCount }
 *
 * We derive a percentage-of-budget bar and a per-issuance breakdown from the
 * issuance lines on getOne (no extra query needed).
 */
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Hammer, Package, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { api } from '@/lib/api';

type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';

interface IssuanceLine {
  id: string;
  rawMaterialId: string;
  rawMaterial: { id: string; name: string; unit: string };
  quantity: string;
  unitCost: string;
}
interface Issuance {
  id: string;
  issuanceNumber: string;
  createdAt: string;
  branch: { id: string; name: string } | null;
  notes: string | null;
  lines: IssuanceLine[];
}
interface ProjectDetail {
  id: string;
  projectCode: string;
  name: string;
  status: ProjectStatus;
  budgetAmount: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  customer: { id: string; name: string } | null;
  branch: { id: string; name: string } | null;
  issuances: Issuance[];
}
interface ProjectPL {
  projectId: string;
  projectCode: string;
  name: string;
  status: ProjectStatus;
  budgetAmount: number | null;
  totalIssuedCost: number;
  remainingBudget: number | null;
  issuanceCount: number;
}

const TINT: Record<ProjectStatus, string> = {
  PLANNING:  'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  ACTIVE:    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  ON_HOLD:   'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  COMPLETED: 'bg-muted text-muted-foreground',
  CANCELLED: 'bg-red-500/15 text-red-600',
};

function fmtPeso(n: number | string | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(n));
}
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-PH', { dateStyle: 'medium' });
}

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const [tab, setTab] = useState<'overview' | 'issuances' | 'pl'>('overview');

  const { data: project, isLoading } = useQuery<ProjectDetail>({
    queryKey: ['project', id],
    queryFn:  () => api.get(`/projects/${id}`).then((r) => r.data),
    enabled:  !!id,
  });

  const { data: pl } = useQuery<ProjectPL>({
    queryKey: ['project-pl', id],
    queryFn:  () => api.get(`/projects/${id}/pl`).then((r) => r.data),
    enabled:  !!id,
  });

  if (isLoading) return <div className="p-10 text-sm text-muted-foreground">Loading project…</div>;
  if (!project)  return <div className="p-10 text-sm text-muted-foreground">Project not found.</div>;

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center gap-3 flex-wrap">
        <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Hammer className="h-5 w-5 text-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">{project.projectCode}</span>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${TINT[project.status]}`}>
              {project.status.replace('_', ' ')}
            </span>
          </div>
          <h1 className="text-xl font-semibold truncate">{project.name}</h1>
        </div>
      </header>

      <div className="border-b border-border px-4 sm:px-6 shrink-0 flex items-center gap-1 overflow-auto">
        <Tab active={tab === 'overview'}    onClick={() => setTab('overview')}    label="Overview" />
        <Tab active={tab === 'issuances'}   onClick={() => setTab('issuances')}   label={`Issuances (${project.issuances.length})`} />
        <Tab active={tab === 'pl'}          onClick={() => setTab('pl')}          label="P&L" />
      </div>

      <div className="px-4 sm:px-6 py-5 space-y-4 flex-1 overflow-auto">
        {tab === 'overview' && <OverviewTab project={project} />}
        {tab === 'issuances' && <IssuancesTab issuances={project.issuances} />}
        {tab === 'pl' && <PLTab pl={pl} issuances={project.issuances} />}
      </div>
    </div>
  );
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={
        'px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ' +
        (active
          ? 'border-[var(--accent)] text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground')
      }
    >
      {label}
    </button>
  );
}

function OverviewTab({ project }: { project: ProjectDetail }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
        <Field label="Customer" value={project.customer?.name ?? '—'} />
        <Field label="Branch"   value={project.branch?.name ?? '—'} />
        <Field label="Budget"   value={fmtPeso(project.budgetAmount)} mono />
        <Field label="Start"    value={fmtDate(project.startDate)} />
        <Field label="End"      value={fmtDate(project.endDate)} />
        <Field label="Issuances" value={String(project.issuances.length)} />
      </div>
      {project.notes && (
        <div className="text-sm border-t border-border pt-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Notes</div>
          <p className="whitespace-pre-wrap">{project.notes}</p>
        </div>
      )}
    </div>
  );
}

function IssuancesTab({ issuances }: { issuances: Issuance[] }) {
  if (issuances.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
        No material issuances yet.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {issuances.map((iss) => {
        const total = iss.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0);
        return (
          <div key={iss.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono font-semibold text-sm">{iss.issuanceNumber}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(iss.createdAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                {iss.branch && (
                  <span className="text-xs text-muted-foreground">· {iss.branch.name}</span>
                )}
              </div>
              <span className="font-mono font-semibold text-sm">{fmtPeso(total)}</span>
            </div>
            {iss.notes && (
              <div className="text-xs text-muted-foreground italic">{iss.notes}</div>
            )}
            <div className="border-t border-border pt-2 space-y-1">
              {iss.lines.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">{l.rawMaterial.name}</span>
                  <span className="font-mono shrink-0 text-muted-foreground">
                    {l.quantity} {l.rawMaterial.unit} × {fmtPeso(l.unitCost)} ={' '}
                    <span className="text-foreground font-semibold">
                      {fmtPeso(Number(l.quantity) * Number(l.unitCost))}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PLTab({ pl, issuances }: { pl: ProjectPL | undefined; issuances: Issuance[] }) {
  if (!pl) {
    return <div className="text-sm text-muted-foreground p-4">Loading P&L…</div>;
  }

  const budget = pl.budgetAmount;
  const issued = pl.totalIssuedCost;
  const remaining = pl.remainingBudget;
  const overBudget = remaining != null && remaining < 0;
  const pct = budget && budget > 0 ? Math.min(100, (issued / budget) * 100) : 0;
  const overPct = budget && budget > 0 ? Math.max(0, (issued / budget) * 100 - 100) : 0;

  // By-material breakdown derived from issuance lines.
  const byMaterial = new Map<string, { name: string; unit: string; qty: number; cost: number }>();
  for (const iss of issuances) {
    for (const l of iss.lines) {
      const k = l.rawMaterialId;
      const cur = byMaterial.get(k) ?? { name: l.rawMaterial.name, unit: l.rawMaterial.unit, qty: 0, cost: 0 };
      cur.qty  += Number(l.quantity);
      cur.cost += Number(l.quantity) * Number(l.unitCost);
      byMaterial.set(k, cur);
    }
  }
  const breakdown = Array.from(byMaterial.values()).sort((a, b) => b.cost - a.cost);

  return (
    <div className="space-y-4">
      {/* Big numbers */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PLCard label="Budget"        value={budget}    icon={<Activity className="h-4 w-4" />} />
        <PLCard label="Issued cost"   value={issued}    icon={<TrendingDown className="h-4 w-4" />} tone="red" />
        <PLCard
          label={overBudget ? 'OVER BUDGET' : 'Remaining'}
          value={remaining != null ? Math.abs(remaining) : null}
          icon={<TrendingUp className="h-4 w-4" />}
          tone={overBudget ? 'red' : remaining != null ? 'green' : undefined}
        />
      </div>

      {/* Burn-down bar */}
      {budget != null && budget > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Budget consumption</span>
            <span className="font-mono font-semibold text-foreground">
              {((issued / budget) * 100).toFixed(1)}%
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden flex">
            <div
              className={overBudget ? 'bg-red-500' : 'bg-emerald-500'}
              style={{ width: `${pct}%` }}
            />
            {overBudget && (
              <div className="bg-red-700 animate-pulse" style={{ width: `${Math.min(100, overPct)}%` }} />
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
            <span>{fmtPeso(0)}</span>
            <span>{fmtPeso(budget)}</span>
          </div>
        </div>
      )}

      {budget == null && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-3 text-xs text-amber-900 dark:text-amber-200">
          No budget set on this project. P&L is showing actual cost only — set a budget on the project to enable
          variance tracking.
        </div>
      )}

      {/* Material breakdown */}
      {breakdown.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Package className="h-4 w-4" /> Cost by material
          </h3>
          <div className="divide-y divide-border">
            {breakdown.map((row) => {
              const share = issued > 0 ? (row.cost / issued) * 100 : 0;
              return (
                <div key={row.name} className="py-2 grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm">
                  <div className="min-w-0">
                    <div className="truncate">{row.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {row.qty} {row.unit}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {share.toFixed(1)}%
                  </div>
                  <div className="font-mono font-semibold">{fmtPeso(row.cost)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        Issued cost = sum of (issuance line quantity × locked unit cost). Unit cost is captured at the moment
        of issuance from the raw material WAC, so future cost changes don't retro-affect this P&L.
      </div>
    </div>
  );
}

function PLCard({ label, value, icon, tone }: {
  label: string;
  value: number | null;
  icon: React.ReactNode;
  tone?: 'red' | 'green';
}) {
  const cls =
    tone === 'red' ? 'text-red-600' :
    tone === 'green' ? 'text-emerald-700 dark:text-emerald-400' :
    'text-foreground';
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}<span>{label}</span>
      </div>
      <div className={`mt-1.5 text-xl font-mono font-semibold ${cls}`}>
        {value != null ? fmtPeso(value) : '—'}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={'text-sm font-medium ' + (mono ? 'font-mono' : '')}>{value}</div>
    </div>
  );
}
