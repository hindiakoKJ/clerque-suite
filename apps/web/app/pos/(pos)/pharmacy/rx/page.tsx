'use client';
/**
 * Pharmacy → Prescriptions
 *
 * Intake + list of Rx records. Required by RA 6675 (Generics Act) before
 * dispensing any Rx-required product, and by RA 9165 (DDB) for controlled
 * substances. The cashier links an Rx to OrderItems at sale time via the
 * lot picker; this page is where the Rx itself is recorded.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileBadge, Plus, Search, ArrowLeft, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface Prescription {
  id:                 string;
  rxNumber:           string;
  patientName:        string;
  patientIdType:      string | null;
  patientIdNumber:    string | null;
  prescribingDoctor:  string;
  doctorPrcLicense:   string;
  doctorS2License:    string | null;
  doctorClinic:       string | null;
  issuedAt:           string;
  refillsRemaining:   number;
  notes:              string | null;
  customer:           { id: string; name: string } | null;
}

export default function PrescriptionsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch]     = useState('');
  const [showForm, setShowForm] = useState(false);

  const { data: rxs = [], refetch, isFetching } = useQuery<Prescription[]>({
    queryKey: ['pharmacy-rxs', search],
    queryFn:  () => api.get('/pharmacy/prescriptions', {
      params: search ? { search } : {},
    }).then((r) => r.data),
  });

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <FileBadge className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Prescriptions</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="px-3 py-2 rounded-md text-sm border border-border hover:bg-muted disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New Prescription
          </button>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-5 space-y-4 flex-1 overflow-auto">
        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search by Rx # or patient name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm"
          />
        </div>

        {/* List */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {rxs.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {search ? 'No prescriptions match your search.' : 'No prescriptions yet. Click "New Prescription" to record one.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                    <th className="px-4 py-2.5 font-medium">Rx #</th>
                    <th className="px-4 py-2.5 font-medium">Patient</th>
                    <th className="px-4 py-2.5 font-medium">Doctor</th>
                    <th className="px-4 py-2.5 font-medium">PRC</th>
                    <th className="px-4 py-2.5 font-medium">S2 License</th>
                    <th className="px-4 py-2.5 font-medium">Issued</th>
                    <th className="px-4 py-2.5 font-medium text-right">Refills left</th>
                  </tr>
                </thead>
                <tbody>
                  {rxs.map((rx) => (
                    <tr key={rx.id} className="border-b border-border/60 last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-mono text-xs">{rx.rxNumber}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{rx.patientName}</div>
                        {rx.patientIdType && (
                          <div className="text-[10px] text-muted-foreground">{rx.patientIdType}: {rx.patientIdNumber}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div>{rx.prescribingDoctor}</div>
                        {rx.doctorClinic && <div className="text-[10px] text-muted-foreground">{rx.doctorClinic}</div>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{rx.doctorPrcLicense}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{rx.doctorS2License ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                        {new Date(rx.issuedAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' +
                          (rx.refillsRemaining > 0
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground')
                        }>
                          {rx.refillsRemaining}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <NewRxModal
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ['pharmacy-rxs'] });
          }}
        />
      )}
    </div>
  );
}

// ─── New prescription modal ─────────────────────────────────────────────────

function NewRxModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    rxNumber:          '',
    patientName:       '',
    patientIdType:     '',
    patientIdNumber:   '',
    prescribingDoctor: '',
    doctorPrcLicense:  '',
    doctorS2License:   '',
    doctorClinic:      '',
    issuedAt:          new Date().toISOString().slice(0, 10),
    refillsRemaining:  '0',
    notes:             '',
  });
  function field<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  const mut = useMutation({
    mutationFn: () => api.post('/pharmacy/prescriptions', {
      rxNumber:          form.rxNumber.trim(),
      patientName:       form.patientName.trim(),
      patientIdType:     form.patientIdType.trim() || undefined,
      patientIdNumber:   form.patientIdNumber.trim() || undefined,
      prescribingDoctor: form.prescribingDoctor.trim(),
      doctorPrcLicense:  form.doctorPrcLicense.trim(),
      doctorS2License:   form.doctorS2License.trim() || undefined,
      doctorClinic:      form.doctorClinic.trim() || undefined,
      issuedAt:          new Date(form.issuedAt).toISOString(),
      refillsRemaining:  Number(form.refillsRemaining) || 0,
      notes:             form.notes.trim() || undefined,
    }).then((r) => r.data),
    onSuccess: () => { toast.success('Prescription recorded.'); onSuccess(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl bg-card border border-border shadow-xl">
        <header className="px-5 py-4 border-b border-border sticky top-0 bg-card">
          <h3 className="text-base font-semibold">New Prescription</h3>
          <p className="text-xs text-muted-foreground mt-0.5">RA 6675 + RA 9165 — required for Rx and controlled-drug dispensing.</p>
        </header>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Rx number *" v={form.rxNumber} on={(v) => field('rxNumber', v)} mono />
            <Field label="Issue date *" v={form.issuedAt} on={(v) => field('issuedAt', v)} type="date" />
          </div>

          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="text-xs font-semibold text-foreground">Patient</div>
            <Field label="Full name *" v={form.patientName} on={(v) => field('patientName', v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="ID type" v={form.patientIdType} on={(v) => field('patientIdType', v)} placeholder="PWD / Senior / DL" />
              <Field label="ID number" v={form.patientIdNumber} on={(v) => field('patientIdNumber', v)} mono />
            </div>
          </div>

          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="text-xs font-semibold text-foreground">Prescribing physician</div>
            <Field label="Full name *" v={form.prescribingDoctor} on={(v) => field('prescribingDoctor', v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="PRC license *" v={form.doctorPrcLicense} on={(v) => field('doctorPrcLicense', v)} mono />
              <Field label="S2 license (controlled drugs)" v={form.doctorS2License} on={(v) => field('doctorS2License', v)} mono />
            </div>
            <Field label="Clinic / hospital" v={form.doctorClinic} on={(v) => field('doctorClinic', v)} />
          </div>

          <Field
            label="Refills allowed"
            v={form.refillsRemaining}
            on={(v) => field('refillsRemaining', v)}
            type="number"
            placeholder="0 = single dispense only"
          />

          <Field label="Notes" v={form.notes} on={(v) => field('notes', v)} />
        </div>

        <footer className="px-5 pb-5 flex justify-end gap-2 sticky bottom-0 bg-card border-t border-border pt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.rxNumber || !form.patientName || !form.prescribingDoctor || !form.doctorPrcLicense}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
          >
            {mut.isPending ? 'Saving…' : 'Save Prescription'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, v, on, type = 'text', placeholder, mono }: {
  label: string; v: string; on: (v: string) => void;
  type?: string; placeholder?: string; mono?: boolean;
}) {
  return (
    <label className="text-sm block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        value={v}
        onChange={(e) => on(e.target.value)}
        placeholder={placeholder}
        className={'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm ' + (mono ? 'font-mono' : '')}
      />
    </label>
  );
}
