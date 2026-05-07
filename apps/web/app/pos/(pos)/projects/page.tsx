'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Hammer, Plus, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface Project {
  id:           string;
  projectCode:  string;
  name:         string;
  status:       'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
  budgetAmount: string | null;
  startDate:    string | null;
  endDate:      string | null;
  customer:     { id: string; name: string } | null;
  branch:       { id: string; name: string } | null;
  _count:       { issuances: number };
}

const TINT: Record<string, string> = {
  PLANNING:  'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  ACTIVE:    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  ON_HOLD:   'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  COMPLETED: 'bg-muted text-muted-foreground',
  CANCELLED: 'bg-red-500/15 text-red-600',
};

function fmtPeso(s: string | null) {
  if (s == null) return '—';
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(s));
}

export default function ProjectsPage() {
  const [showNew, setShowNew] = useState(false);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn:  () => api.get('/projects').then((r) => r.data),
  });

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Hammer className="h-6 w-6 text-[var(--accent)]" />
            Projects
          </h1>
          <p className="text-sm text-muted-foreground">Construction / job-cost projects with material issuance.</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New Project
        </button>
      </header>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        {projects.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No projects yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Code</th>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Customer</th>
                <th className="text-right px-4 py-2 font-medium">Budget</th>
                <th className="text-right px-4 py-2 font-medium">Issuances</th>
                <th className="text-center px-4 py-2 font-medium">Status</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-mono text-xs">{p.projectCode}</td>
                  <td className="px-4 py-2.5 font-medium">{p.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">{p.customer?.name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">{fmtPeso(p.budgetAmount)}</td>
                  <td className="px-4 py-2.5 text-right">{p._count.issuances}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${TINT[p.status]}`}>
                      {p.status.toLowerCase().replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <Link href={`/pos/projects/${p.id}`} className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
                      Open <ArrowRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: customers = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['customers'],
    queryFn:  () => api.get('/customers').then((r) => Array.isArray(r.data) ? r.data : (r.data?.data ?? [])),
  });
  const [name, setName]               = useState('');
  const [budget, setBudget]           = useState('');
  const [customerId, setCustomerId]   = useState('');
  const [startDate, setStartDate]     = useState('');
  const [endDate, setEndDate]         = useState('');
  const [notes, setNotes]             = useState('');

  const create = useMutation({
    mutationFn: () => api.post('/projects', {
      name,
      budgetAmount: budget ? Number(budget) : undefined,
      customerId:   customerId || undefined,
      startDate:    startDate || undefined,
      endDate:      endDate || undefined,
      notes:        notes || undefined,
    }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success('Project created.'); onClose(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg p-5 space-y-3">
        <h2 className="font-semibold">New Project</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <option value="">— customer (optional) —</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="number" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Budget (₱)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">Start
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-muted-foreground">End
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
          </label>
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!name || create.isPending} className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50">
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
