'use client';

/**
 * Sprint 25 — API Keys admin page.
 *
 * Owners on plans with `apiAccess !== 'none'` can issue API keys for
 * read-only (or readwrite, on SUITE_T3+) access to /public-api/v1/*. The
 * plaintext key is shown ONCE at creation time and then never again — the
 * user must copy it to their integration before closing the modal.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, Plus, Trash2, Copy, Check, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { PLAN_FEATURES } from '@repo/shared-types';
import type { PlanCode, ApiAccessLevel } from '@repo/shared-types';

interface ApiKeyRow {
  id:          string;
  label:       string;
  keyPrefix:   string;
  accessLevel: ApiAccessLevel;
  isActive:    boolean;
  lastUsedAt:  string | null;
  expiresAt:   string | null;
  createdAt:   string;
}

interface IssuedApiKey extends ApiKeyRow {
  key: string;
}

export default function ApiKeysPage() {
  const user      = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate]   = useState(false);
  const [label, setLabel]             = useState('');
  const [accessLevel, setAccessLevel] = useState<ApiAccessLevel>('read');
  const [issued, setIssued]           = useState<IssuedApiKey | null>(null);
  const [copied, setCopied]           = useState(false);

  // Resolve plan feature gate from JWT planCode (fallback to SUITE_T2 if missing).
  const planCode = (user?.planCode ?? 'SUITE_T2') as PlanCode;
  const apiAccess: ApiAccessLevel = PLAN_FEATURES[planCode]?.apiAccess ?? 'none';
  const allowed = apiAccess !== 'none';
  const canIssueReadwrite = apiAccess === 'readwrite';

  const { data: keys, isLoading } = useQuery<ApiKeyRow[]>({
    queryKey: ['api-keys'],
    queryFn:  () => api.get<ApiKeyRow[]>('/api-keys').then((r) => r.data),
    enabled:  allowed,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await api.post<IssuedApiKey>('/api-keys', { label, accessLevel });
      return res.data;
    },
    onSuccess: (data) => {
      setIssued(data);
      setShowCreate(false);
      setLabel('');
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  if (!allowed) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <h2 className="font-semibold">API access not on your plan</h2>
            <p className="text-sm mt-1">
              Upgrade to Solo Pro or Suite T2 to issue API keys for your accountant or third-party tools.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Key className="h-6 w-6" /> API Keys
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" /> Issue Key
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-500">Loading keys…</div>
      ) : !keys?.length ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
          No API keys yet. Issue one to integrate with your accountant or external tools.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Label</th>
                <th className="px-4 py-2">Prefix</th>
                <th className="px-4 py-2">Access</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Last Used</th>
                <th className="px-4 py-2">Expires</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t">
                  <td className="px-4 py-2">{k.label}</td>
                  <td className="px-4 py-2 font-mono text-xs">{k.keyPrefix}…</td>
                  <td className="px-4 py-2">{k.accessLevel}</td>
                  <td className="px-4 py-2">
                    {k.isActive
                      ? <span className="text-emerald-700">Active</span>
                      : <span className="text-slate-400">Revoked</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {k.isActive && (
                      <button
                        onClick={() => {
                          if (confirm(`Revoke key "${k.label}"? This cannot be undone.`)) {
                            revokeMut.mutate(k.id);
                          }
                        }}
                        className="text-red-600 hover:text-red-700"
                        aria-label="Revoke"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Issue modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold mb-4">Issue API Key</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Label</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Maria's bookkeeper"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Access Level</label>
                <select
                  value={accessLevel}
                  onChange={(e) => setAccessLevel(e.target.value as ApiAccessLevel)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                >
                  <option value="read">Read only</option>
                  {canIssueReadwrite && <option value="readwrite">Read &amp; write</option>}
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                disabled={!label.trim() || createMut.isPending}
                onClick={() => createMut.mutate()}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50 hover:bg-slate-800"
              >
                {createMut.isPending ? 'Issuing…' : 'Issue Key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Show-once secret modal */}
      {issued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold mb-2">Your new API key</h2>
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 mb-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>Copy this key now. For security, we will not show it again.</p>
            </div>
            <div className="flex gap-2">
              <code className="flex-1 break-all rounded-md bg-slate-100 px-3 py-2 font-mono text-xs">
                {issued.key}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(issued.key);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => { setIssued(null); setCopied(false); }}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"
              >
                I&apos;ve copied the key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
