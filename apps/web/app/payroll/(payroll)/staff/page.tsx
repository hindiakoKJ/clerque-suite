'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Search, Plus, Mail, Phone, ChevronRight, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Badge } from '@/components/ui/Badge';

const SALARY_TYPES = ['HOURLY', 'DAILY', 'SEMI_MONTHLY', 'MONTHLY'] as const;
type SalaryType = typeof SALARY_TYPES[number];

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  position: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE';
  startDate: string;
  basicRate: number;
}

const STATUS_STYLES: Record<Employee['status'], { tone: 'success' | 'warn' | 'default'; label: string }> = {
  ACTIVE:   { tone: 'success', label: 'Active'   },
  ON_LEAVE: { tone: 'warn',    label: 'On Leave' },
  INACTIVE: { tone: 'default', label: 'Inactive' },
};

export default function PayrollStaffPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  // Salary edit modal state
  const [editingEmp,    setEditingEmp]    = useState<Employee | null>(null);
  const [editRate,      setEditRate]      = useState('');
  const [editType,      setEditType]      = useState<SalaryType>('MONTHLY');
  const [editHired,     setEditHired]     = useState('');

  const canEditSalary = !!user && ['BUSINESS_OWNER', 'PAYROLL_MASTER', 'SUPER_ADMIN'].includes(user.role);

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['payroll-employees'],
    queryFn: () => api.get('/payroll/employees').then((r) => r.data),
    enabled: !!user,
    staleTime: 60_000,
  });

  const editMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      api.patch(`/payroll/employees/${id}/salary`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-employees'] });
      toast.success('Salary updated.');
      setEditingEmp(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  function openEdit(emp: Employee) {
    setEditingEmp(emp);
    setEditRate(emp.basicRate ? String(emp.basicRate) : '');
    setEditType('MONTHLY');
    setEditHired(emp.startDate ? emp.startDate.slice(0, 10) : '');
  }

  const filtered = employees.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.department.toLowerCase().includes(search.toLowerCase()) ||
    e.position.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col h-full overflow-auto">

      {/* Header */}
      <div className="bg-background border-b border-border px-4 sm:px-6 py-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold text-foreground">Employees</h1>
            <span className="text-sm text-muted-foreground">({employees.length})</span>
          </div>
          <button
            className="flex items-center gap-1.5 text-xs hover:opacity-90 text-white rounded-lg px-3 py-1.5 font-medium transition-opacity whitespace-nowrap"
            style={{ background: 'var(--accent)' }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Employee
          </button>
        </div>

        {/* Search */}
        <div className="relative mt-3 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search employees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 p-4 sm:p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-background rounded-lg border border-border p-4 flex gap-4">
                <div className="w-10 h-10 rounded-full bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-28 bg-muted animate-pulse rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Users className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">
              {search ? 'No employees match your search' : 'No employees yet'}
            </p>
          </div>
        ) : (
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="divide-y divide-border">
              {filtered.map((emp) => {
                const s = STATUS_STYLES[emp.status];
                return (
                  <div
                    key={emp.id}
                    className="flex items-center justify-between gap-4 px-4 sm:px-5 py-3.5 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    {/* Avatar */}
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                      style={{ background: 'var(--accent)' }}
                    >
                      {emp.name.slice(0, 1).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{emp.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {emp.position} · {emp.department}
                      </p>
                    </div>

                    {/* Contact */}
                    <div className="hidden sm:flex flex-col gap-0.5 text-xs text-muted-foreground min-w-0">
                      <span className="flex items-center gap-1 truncate">
                        <Mail className="h-3 w-3 shrink-0" />{emp.email}
                      </span>
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3 shrink-0" />{emp.phone}
                      </span>
                    </div>

                    {/* Status + actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {canEditSalary && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(emp); }}
                          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="Edit salary"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Salary edit modal ───────────────────────────────────────────── */}
      {editingEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <header className="px-5 pt-5 pb-3 flex items-start justify-between gap-2 border-b border-border">
              <div>
                <h2 className="font-semibold">Edit Salary</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{editingEmp.name}</p>
              </div>
              <button onClick={() => setEditingEmp(null)} className="text-muted-foreground hover:text-foreground p-1 rounded">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="px-5 py-4 space-y-3">
              <label className="text-sm block">
                <span className="text-xs text-muted-foreground">Salary rate (₱)</span>
                <input
                  type="number" step="0.01" inputMode="decimal"
                  value={editRate}
                  onChange={(e) => setEditRate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  placeholder="e.g. 18000"
                />
              </label>
              <label className="text-sm block">
                <span className="text-xs text-muted-foreground">Salary type</span>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as SalaryType)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {SALARY_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace('_', '-').toLowerCase()}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm block">
                <span className="text-xs text-muted-foreground">Hire date</span>
                <input
                  type="date"
                  value={editHired}
                  onChange={(e) => setEditHired(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
              <p className="text-xs text-muted-foreground italic">
                Changes are written to the audit log with before / after values.
              </p>
            </div>

            <footer className="px-5 pb-5 flex justify-end gap-2">
              <button
                onClick={() => setEditingEmp(null)}
                className="px-4 py-2 rounded-lg text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => editMut.mutate({
                  id: editingEmp.id,
                  body: {
                    salaryRate: editRate ? Number(editRate) : undefined,
                    salaryType: editType,
                    hiredAt:    editHired || undefined,
                  },
                })}
                disabled={editMut.isPending}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {editMut.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
