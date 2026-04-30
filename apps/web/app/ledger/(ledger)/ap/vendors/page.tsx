'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, X, Building2, ChevronDown, CheckCircle2, XCircle, Upload,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';
import { ImportModal } from '@/components/ui/ImportModal';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string;
  name: string;
  tin: string | null;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  defaultAtcCode: string | null;
  defaultWhtRate: string | null;
  isActive: boolean;
  notes: string | null;
  outstanding: number;
  _count: { expenses: number };
}

interface VendorFormData {
  name: string;
  tin: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  defaultAtcCode: string;
  defaultWhtRate: string;
  notes: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const WRITE_ROLES = new Set(['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT']);

const FIELD = 'h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow w-full';

function emptyForm(): VendorFormData {
  return { name: '', tin: '', address: '', contactEmail: '', contactPhone: '', defaultAtcCode: '', defaultWhtRate: '', notes: '' };
}

// ── Vendor Modal ──────────────────────────────────────────────────────────────

function VendorModal({
  vendor,
  onClose,
  onSaved,
}: {
  vendor: Vendor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!vendor;
  const [form, setForm] = useState<VendorFormData>(
    vendor
      ? {
          name: vendor.name,
          tin: vendor.tin ?? '',
          address: vendor.address ?? '',
          contactEmail: vendor.contactEmail ?? '',
          contactPhone: vendor.contactPhone ?? '',
          defaultAtcCode: vendor.defaultAtcCode ?? '',
          defaultWhtRate: vendor.defaultWhtRate ? String(Number(vendor.defaultWhtRate) * 100) : '',
          notes: vendor.notes ?? '',
        }
      : emptyForm(),
  );
  const [saving, setSaving] = useState(false);

  function patch(key: keyof VendorFormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Vendor name is required'); return; }

    const whtRateDecimal =
      form.defaultWhtRate.trim()
        ? String(parseFloat(form.defaultWhtRate) / 100)
        : undefined;

    const payload = {
      name: form.name.trim(),
      tin: form.tin.trim() || undefined,
      address: form.address.trim() || undefined,
      contactEmail: form.contactEmail.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      defaultAtcCode: form.defaultAtcCode.trim() || undefined,
      defaultWhtRate: whtRateDecimal,
      notes: form.notes.trim() || undefined,
    };

    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/ap/vendors/${vendor!.id}`, payload);
        toast.success('Vendor updated.');
      } else {
        await api.post('/ap/vendors', payload);
        toast.success('Vendor created.');
      }
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to save vendor');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Vendor' : 'New Vendor'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Legal Business Name <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => patch('name', e.target.value)}
                placeholder="e.g. Acme Supplies Inc."
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">BIR TIN</label>
              <Input
                value={form.tin}
                onChange={(e) => patch('tin', e.target.value)}
                placeholder="000-000-000-00000"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Contact Phone</label>
              <Input
                value={form.contactPhone}
                onChange={(e) => patch('contactPhone', e.target.value)}
                placeholder="+63 917 xxx xxxx"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Contact Email</label>
              <Input
                type="email"
                value={form.contactEmail}
                onChange={(e) => patch('contactEmail', e.target.value)}
                placeholder="billing@vendor.com"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Address</label>
              <Input
                value={form.address}
                onChange={(e) => patch('address', e.target.value)}
                placeholder="Street, City, Province"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Default ATC Code
              </label>
              <Input
                value={form.defaultAtcCode}
                onChange={(e) => patch('defaultAtcCode', e.target.value)}
                placeholder="e.g. WI160"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Default WHT Rate (%)
              </label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.defaultWhtRate}
                onChange={(e) => patch('defaultWhtRate', e.target.value)}
                placeholder="e.g. 5"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => patch('notes', e.target.value)}
                rows={2}
                placeholder="Optional notes"
                className={FIELD + ' resize-none h-auto py-2'}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Vendor'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VendorsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canWrite = user?.role ? WRITE_ROLES.has(user.role) : false;

  const [search, setSearch] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [modalVendor, setModalVendor] = useState<Vendor | null | 'new'>(null);

  const queryParams = new URLSearchParams();
  if (search) queryParams.set('search', search);
  if (!showInactive) queryParams.set('isActive', 'true');

  const { data: vendors = [], isLoading } = useQuery<Vendor[]>({
    queryKey: ['ap-vendors', search, showInactive],
    queryFn: () => api.get(`/ap/vendors?${queryParams}`).then((r) => r.data),
    enabled: !!user,
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => api.delete(`/ap/vendors/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ap-vendors'] });
      toast.success('Vendor deactivated.');
    },
    onError: () => toast.error('Failed to deactivate vendor'),
  });

  function handleSaved() {
    setModalVendor(null);
    qc.invalidateQueries({ queryKey: ['ap-vendors'] });
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Vendors</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {vendors.length} vendor{vendors.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button variant="outline" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4 mr-1.5" /> Import
            </Button>
            <Button onClick={() => setModalVendor('new')}>
              <Plus className="h-4 w-4 mr-1.5" /> New Vendor
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendors…"
            className="h-9 pl-8 pr-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] w-64"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-border"
          />
          Show inactive
        </label>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading vendors…</div>
      ) : vendors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Building2 className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">No vendors found</p>
          {canWrite && (
            <Button className="mt-4" onClick={() => setModalVendor('new')}>
              <Plus className="h-4 w-4 mr-1.5" /> Add First Vendor
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-background rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase">
                  <th className="px-4 py-2.5 text-left font-semibold">Vendor</th>
                  <th className="px-4 py-2.5 text-left font-semibold">TIN</th>
                  <th className="px-4 py-2.5 text-left font-semibold">ATC Code</th>
                  <th className="px-4 py-2.5 text-right font-semibold">WHT Rate</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Outstanding</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                  {canWrite && <th className="px-4 py-2.5 w-28 text-right font-semibold">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vendors.map((vendor) => (
                  <tr key={vendor.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{vendor.name}</p>
                      {vendor.contactEmail && (
                        <p className="text-xs text-muted-foreground mt-0.5">{vendor.contactEmail}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                      {vendor.tin ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {vendor.defaultAtcCode ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground text-xs">
                      {vendor.defaultWhtRate
                        ? `${(Number(vendor.defaultWhtRate) * 100).toFixed(2)}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-foreground">
                      {vendor.outstanding > 0 ? (
                        <span className="text-amber-600 font-semibold">
                          {formatPeso(vendor.outstanding)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{formatPeso(0)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {vendor.isActive ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                          <XCircle className="w-3 h-3" /> Inactive
                        </span>
                      )}
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setModalVendor(vendor)}
                            className="text-xs font-medium text-[var(--accent)] hover:underline"
                          >
                            Edit
                          </button>
                          {vendor.isActive && (
                            <button
                              onClick={() => {
                                if (confirm(`Deactivate "${vendor.name}"?`)) {
                                  deactivateMut.mutate(vendor.id);
                                }
                              }}
                              disabled={deactivateMut.isPending}
                              className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-50"
                            >
                              Deactivate
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

      {/* Modal */}
      {modalVendor !== null && (
        <VendorModal
          vendor={modalVendor === 'new' ? null : modalVendor}
          onClose={() => setModalVendor(null)}
          onSaved={handleSaved}
        />
      )}

      <ImportModal
        open={showImport}
        title="Import Vendors"
        description="Upload a spreadsheet to bulk-create or update vendors (AP master). Vendors are matched by exact Name."
        templateUrl="/api/v1/import/template/vendors"
        uploadUrl="/import/vendors"
        onClose={() => setShowImport(false)}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['vendors'] });
          setShowImport(false);
        }}
      />
    </div>
  );
}
