'use client';
/**
 * Sprint 19 — Pharmacy Rx attach modal.
 *
 * Opened from the cart panel when one or more Rx-required lines have no
 * prescriptionId yet. The cashier can:
 *   • Search an existing Rx record (by Rx number or patient name) and pick
 *     it — applies to all unattached Rx lines in the cart.
 *   • Quick-create a new Rx (full intake form lives at /pos/pharmacy/rx;
 *     here we offer a minimal "patient name + Rx number + physician name +
 *     PRC license + issue date" creator that satisfies RA 6675 / RA 9165).
 *
 * Once attached, the cart shows a green "Rx · <number>" badge per line
 * and the Charge button unlocks.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, FileBadge, Search, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useCartStore } from '@/store/pos/cart';

interface Prescription {
  id:           string;
  rxNumber:     string;
  patientName:  string;
  physicianName?: string | null;
  issuedDate:   string;
  refillsRemaining?: number;
}

interface Props {
  rxRequiredLineNames: string[];
  onClose: () => void;
}

export function RxAttachModal({ rxRequiredLineNames, onClose }: Props) {
  const qc = useQueryClient();
  const attach = useCartStore((s) => s.attachPrescription);

  const [tab,    setTab]    = useState<'search' | 'new'>('search');
  const [search, setSearch] = useState('');

  const { data: results = [], isLoading } = useQuery<{ data: Prescription[] }>({
    queryKey: ['pharmacy-rx-search', search],
    queryFn:  () => api.get(`/pharmacy/prescriptions?search=${encodeURIComponent(search)}&take=10`).then((r) => r.data),
    // Always enabled — empty search returns the most recent ones, which is
    // useful when the patient just walked up and we already have their Rx
    // on file from an earlier intake.
    enabled:  true,
    staleTime: 10_000,
  });

  // Tolerate either { data: [...] } or [...] depending on backend version.
  const items: Prescription[] = Array.isArray(results) ? results : (results.data ?? []);

  // Quick-create form
  const [rxNumber,     setRxNumber]     = useState('');
  const [patientName,  setPatientName]  = useState('');
  const [physician,    setPhysician]    = useState('');
  const [physicianPrc, setPhysicianPrc] = useState('');
  const [issueDate,    setIssueDate]    = useState(new Date().toISOString().slice(0, 10));

  const createMut = useMutation({
    mutationFn: () => api.post<Prescription>('/pharmacy/prescriptions', {
      rxNumber:           rxNumber.trim(),
      patientName:        patientName.trim(),
      physicianName:      physician.trim() || undefined,
      physicianPrc:       physicianPrc.trim() || undefined,
      issuedDate:         issueDate,
      refillsAllowed:     0,
    }).then((r) => r.data),
    onSuccess: (rx) => {
      qc.invalidateQueries({ queryKey: ['pharmacy-rx-search'] });
      attach(rx.id, rx.rxNumber);
      toast.success(`Rx ${rx.rxNumber} attached to ${rxRequiredLineNames.length} item${rxRequiredLineNames.length === 1 ? '' : 's'}.`);
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg[0] : (msg ?? 'Failed to create prescription.'));
    },
  });

  function pickExisting(rx: Prescription) {
    attach(rx.id, rx.rxNumber);
    toast.success(`Rx ${rx.rxNumber} attached to ${rxRequiredLineNames.length} item${rxRequiredLineNames.length === 1 ? '' : 's'}.`);
    onClose();
  }

  const inputCls = 'w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-card border border-border p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-base flex items-center gap-2">
              <FileBadge className="h-5 w-5 text-[var(--accent)]" />
              Attach prescription
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Will apply to {rxRequiredLineNames.length} Rx-required item{rxRequiredLineNames.length === 1 ? '' : 's'}: {rxRequiredLineNames.join(', ')}.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
          <button
            onClick={() => setTab('search')}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
              tab === 'search' ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Find existing
          </button>
          <button
            onClick={() => setTab('new')}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
              tab === 'new' ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            New Rx
          </button>
        </div>

        {tab === 'search' ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by Rx number or patient name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`pl-9 ${inputCls}`}
                autoFocus
              />
            </div>

            {isLoading ? (
              <div className="text-sm text-muted-foreground text-center py-6">Loading…</div>
            ) : items.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                {search
                  ? 'No matching prescriptions. Try a different search or create a new one.'
                  : 'No prescriptions on file yet.'}
              </div>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border max-h-72 overflow-y-auto">
                {items.map((rx) => (
                  <li key={rx.id}>
                    <button
                      onClick={() => pickExisting(rx)}
                      className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-mono text-sm font-semibold">{rx.rxNumber}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(rx.issuedDate).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-sm">{rx.patientName}</div>
                      {rx.physicianName && (
                        <div className="text-xs text-muted-foreground">Dr. {rx.physicianName}</div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Capture just the basics — for full intake (refills, controlled-drug schedule, S2 details),
              use <a href="/pos/pharmacy/rx" target="_blank" rel="noopener" className="underline">Prescriptions</a>.
            </p>
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Rx number</span>
              <input
                className={inputCls}
                value={rxNumber}
                onChange={(e) => setRxNumber(e.target.value)}
                placeholder="e.g. RX-2026-001"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Patient name</span>
              <input
                className={inputCls}
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Physician name</span>
                <input
                  className={inputCls}
                  value={physician}
                  onChange={(e) => setPhysician(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">PRC license</span>
                <input
                  className={inputCls}
                  value={physicianPrc}
                  onChange={(e) => setPhysicianPrc(e.target.value)}
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Issue date</span>
              <input
                type="date"
                className={inputCls}
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </label>
            <button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !rxNumber.trim() || !patientName.trim()}
              className="w-full rounded-lg bg-[var(--accent)] text-white text-sm px-3 py-2.5 hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {createMut.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Plus className="h-4 w-4" />}
              {createMut.isPending ? 'Creating…' : 'Create + attach'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
