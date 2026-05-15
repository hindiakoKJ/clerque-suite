'use client';
/**
 * Sprint 25 Phase 2C — Loyalty Pro admin page.
 *
 * Lists stamp programs and lets the owner create new ones. The POS-side
 * "grant stamp" button is a TODO; this commit ships the configuration UI
 * and reuses the existing customer-facing /stamps lookup.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stamp, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface StampProgram {
  id:              string;
  name:            string;
  stampsRequired:  number;
  rewardProductId: string | null;
  isActive:        boolean;
  createdAt:       string;
}

export default function LoyaltyProPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [stampsRequired, setStampsRequired] = useState(10);
  const [rewardProductId, setRewardProductId] = useState('');

  const { data: programs, isLoading } = useQuery({
    queryKey: ['loyalty-pro', 'programs'],
    queryFn:  async () => {
      const res = await api.get<StampProgram[]>('/loyalty-pro/programs');
      return res.data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post<StampProgram>('/loyalty-pro/programs', {
        name,
        stampsRequired,
        rewardProductId: rewardProductId || null,
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Stamp program created.');
      setName('');
      setStampsRequired(10);
      setRewardProductId('');
      qc.invalidateQueries({ queryKey: ['loyalty-pro', 'programs'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Could not create program.');
    },
  });

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5">
        <div className="flex items-center gap-3">
          <Stamp className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Loyalty Pro</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Digital stamp programs with QR-code redemption at the till. Pro-tier feature.
        </p>
      </header>

      <main className="p-4 sm:p-6 space-y-6">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3">Create stamp program</h2>
          <form
            className="grid gap-3 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              create.mutate();
            }}
          >
            <input
              className="rounded border border-input bg-background px-3 py-2 text-sm sm:col-span-2"
              placeholder="Program name (e.g. Buy 10, get 1 free)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              className="rounded border border-input bg-background px-3 py-2 text-sm"
              type="number"
              min={1}
              placeholder="Stamps required"
              value={stampsRequired}
              onChange={(e) => setStampsRequired(parseInt(e.target.value, 10) || 1)}
              required
            />
            <input
              className="rounded border border-input bg-background px-3 py-2 text-sm"
              placeholder="Reward product id (optional)"
              value={rewardProductId}
              onChange={(e) => setRewardProductId(e.target.value)}
            />
            <button
              type="submit"
              className="sm:col-span-4 inline-flex items-center justify-center gap-2 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              disabled={create.isPending}
            >
              <Plus className="h-4 w-4" />
              {create.isPending ? 'Creating…' : 'Create program'}
            </button>
          </form>
          {/* TODO: POS-side stamp grant button — Phase 2D. */}
        </section>

        <section className="rounded-lg border border-border bg-card">
          <header className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Programs</h2>
          </header>
          {isLoading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : !programs || programs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No stamp programs yet. Create your first one above.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {programs.map((p) => (
                <li key={p.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.stampsRequired} stamps required
                      {p.rewardProductId ? ` · reward product ${p.rewardProductId}` : ''}
                    </p>
                  </div>
                  <span
                    className={`text-xs rounded-full px-2 py-0.5 ${
                      p.isActive
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {p.isActive ? 'Active' : 'Inactive'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
