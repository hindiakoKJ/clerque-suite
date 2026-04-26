'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Pencil, Users, ChevronRight, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Customer {
  id: string;
  name: string;
  tin: string | null;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  creditTermDays: number;
  creditLimit: string | null;
  notes: string | null;
  isActive: boolean;
  outstandingBalance: number;
  createdAt: string;
}

interface CustomerFormData {
  name: string;
  tin: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  creditTermDays: string;
  creditLimit: string;
  notes: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const WRITE_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT'];

const INPUT_CLS =
  'h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ' +
  'focus:border-transparent transition-shadow w-full';

const EMPTY_FORM: CustomerFormData = {
  name: '',
  tin: '',
  address: '',
  contactEmail: '',
  contactPhone: '',
  creditTermDays: '0',
  creditLimit: '',
  notes: '',
};

function creditTermLabel(days: number): string {
  if (days === 0) return 'Cash';
  return `Net ${days}`;
}

// ── Customer Modal ─────────────────────────────────────────────────────────────

function CustomerModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CustomerFormData>(
    editing
      ? {
          name:           editing.name,
          tin:            editing.tin            ?? '',
          address:        editing.address        ?? '',
          contactEmail:   editing.contactEmail   ?? '',
          contactPhone:   editing.contactPhone   ?? '',
          creditTermDays: String(editing.creditTermDays),
          creditLimit:    editing.creditLimit    ?? '',
          notes:          editing.notes          ?? '',
        }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);

  function set(field: keyof CustomerFormData, val: string) {
    setForm((prev) => ({ ...prev, [field]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Business name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name:           form.name.trim(),
        tin:            form.tin.trim()         || undefined,
        address:        form.address.trim()     || undefined,
        contactEmail:   form.contactEmail.trim()|| undefined,
        contactPhone:   form.contactPhone.trim()|| undefined,
        creditTermDays: parseInt(form.creditTermDays, 10) || 0,
        creditLimit:    form.creditLimit ? parseFloat(form.creditLimit) : undefined,
        notes:          form.notes.trim()       || undefined,
      };

      if (editing) {
        await api.patch(`/ar/customers/${editing.id}`, payload);
        toast.success('Customer updated.');
      } else {
        await api.post('/ar/customers', payload);
        toast.success('Customer created.');
      }
      onSaved();
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.message;
      toast.error(msg ?? 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  }

  const title = editing ? 'Edit Customer' : 'New Customer';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-background rounded-2xl border border-border shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 py-4 space-y-3 overflow-y-auto flex-1">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Business Name <span className="text-red-500">*</span>
              </label>
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. ABC Corporation"
                required
                className={INPUT_CLS}
              />
            </div>

            {/* TIN */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">BIR TIN</label>
              <input
                value={form.tin}
                onChange={(e) => set('tin', e.target.value)}
                placeholder="000-000-000-00000"
                className={INPUT_CLS}
              />
            </div>

            {/* Address */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Address</label>
              <input
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="Registered business address"
                className={INPUT_CLS}
              />
            </div>

            {/* Contact row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Contact Email</label>
                <input
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => set('contactEmail', e.target.value)}
                  placeholder="billing@company.com"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Contact Phone</label>
                <input
                  value={form.contactPhone}
                  onChange={(e) => set('contactPhone', e.target.value)}
                  placeholder="+63 9XX XXX XXXX"
                  className={INPUT_CLS}
                />
              </div>
            </div>

            {/* Credit terms row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Credit Terms (days)</label>
                <select
                  value={form.creditTermDays}
                  onChange={(e) => set('creditTermDays', e.target.value)}
                  className={INPUT_CLS}
                >
                  <option value="0">Cash (0 days)</option>
                  <option value="7">Net 7</option>
                  <option value="15">Net 15</option>
                  <option value="30">Net 30</option>
                  <option value="45">Net 45</option>
                  <option value="60">Net 60</option>
                  <option value="90">Net 90</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Credit Limit (PHP)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.creditLimit}
                  onChange={(e) => set('creditLimit', e.target.value)}
                  placeholder="Leave blank for no limit"
                  className={INPUT_CLS}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Internal notes (not printed on invoice)"
                rows={2}
                className={`${INPUT_CLS} h-auto py-2 resize-none`}
              />
            </div>
          </div>

          <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 px-5 rounded-lg text-white text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-opacity"
              style={{ background: 'var(--accent)' }}
            >
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const { user } = useAuthStore();
  const qc       = useQueryClient();
  const canWrite = WRITE_ROLES.includes(user?.role ?? '');

  const [search,       setSearch]       = useState('');
  const [filterActive, setFilterActive] = useState<'' | 'true' | 'false'>('');
  const [showModal,    setShowModal]    = useState(false);
  const [editTarget,   setEditTarget]   = useState<Customer | null>(null);

  const params = new URLSearchParams();
  if (search)       params.set('search', search);
  if (filterActive) params.set('isActive', filterActive);

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ['ar-customers', search, filterActive],
    queryFn:  () => api.get(`/ar/customers?${params}`).then((r) => r.data),
    enabled:  !!user,
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => api.delete(`/ar/customers/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ar-customers'] });
      toast.success('Customer deactivated.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to deactivate customer'),
  });

  function openCreate() { setEditTarget(null); setShowModal(true); }
  function openEdit(c: Customer) { setEditTarget(c); setShowModal(true); }
  function onSaved() {
    setShowModal(false);
    qc.invalidateQueries({ queryKey: ['ar-customers'] });
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-[var(--accent)]" />
            Customers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{customers.length} customers</p>
        </div>
        {canWrite && (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 h-9 px-4 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap self-start sm:self-auto"
            style={{ background: 'var(--accent)' }}
          >
            <Plus className="w-4 h-4" /> New Customer
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, TIN, email…"
            className="h-9 pl-8 pr-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-shadow w-56"
          />
        </div>
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value as typeof filterActive)}
          className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          <option value="">All Statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        {(search || filterActive) && (
          <button
            onClick={() => { setSearch(''); setFilterActive(''); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading customers…</div>
      ) : customers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No customers found</div>
      ) : (
        <div className="bg-background rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase">
                  <th className="px-4 py-2.5 text-left font-semibold">Name</th>
                  <th className="px-4 py-2.5 text-left font-semibold hidden md:table-cell">TIN</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Credit Terms</th>
                  <th className="px-4 py-2.5 text-right font-semibold hidden lg:table-cell">Credit Limit</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Outstanding</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                  {canWrite && <th className="px-4 py-2.5 w-24" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{c.name}</div>
                      {c.contactEmail && (
                        <div className="text-xs text-muted-foreground mt-0.5">{c.contactEmail}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs hidden md:table-cell">
                      {c.tin ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {creditTermLabel(c.creditTermDays)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden lg:table-cell">
                      {c.creditLimit ? formatPeso(Number(c.creditLimit)) : 'No limit'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={
                          c.outstandingBalance > 0
                            ? 'font-semibold text-[var(--accent)]'
                            : 'text-muted-foreground'
                        }
                      >
                        {formatPeso(c.outstandingBalance)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          c.isActive
                            ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(c)}
                            title="Edit"
                            className="p-1.5 rounded text-muted-foreground hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {c.isActive && (
                            <button
                              onClick={() => {
                                if (confirm(`Deactivate "${c.name}"?`)) {
                                  deactivateMut.mutate(c.id);
                                }
                              }}
                              title="Deactivate"
                              className="p-1.5 rounded text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <CustomerModal editing={editTarget} onClose={() => setShowModal(false)} onSaved={onSaved} />
      )}
    </div>
  );
}
