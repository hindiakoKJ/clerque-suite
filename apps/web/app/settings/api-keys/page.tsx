'use client';

/**
 * API keys, for the shop owner.
 *
 * The screen used to live only under /admin, whose layout sends anyone who is
 * not SUPER_ADMIN away, so the owner the keys are for could never open it.
 * /admin/api-keys now shows this same page.
 *
 * Two kinds of key (apps/api/src/api-keys/scopes.ts):
 *   - For AIBA: named permissions, each one a thing a machine may read or
 *     draft for this shop. Nothing a key can do posts, approves, voids or
 *     deletes: a person finishes every draft in Clerque.
 *   - The original kind: read, or read and write, on the orders and import
 *     routes, for an accountant's tool or another app.
 *
 * The key is shown once. AIBA also needs the branch id it works on, so the
 * shop's branch ids are listed here too.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronLeft, KeyRound, Copy, Check, AlertTriangle, Trash2, Loader2, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { planFeaturesFor } from '@repo/shared-types';
import type { ApiAccessLevel } from '@repo/shared-types';

const SCOPES = [
  { id: 'inventory:read',  draft: false, title: 'Read the stock',          desc: 'Items, lots, movements, counts and open buy lists of a branch.' },
  { id: 'inventory:draft', draft: true,  title: 'Draft stock work',        desc: 'Open a count, add to the buy list, hold a supplier delivery for you to confirm.' },
  { id: 'ledger:read',     draft: false, title: 'Read account balances',   desc: 'The balance of chosen accounts at a date.' },
  { id: 'journal:draft',   draft: true,  title: 'Draft journal entries',   desc: 'A journal entry in DRAFT, which a person posts.' },
] as const;
type Scope = (typeof SCOPES)[number]['id'];

interface ApiKeyRow {
  id: string;
  label: string;
  keyPrefix: string;
  accessLevel: ApiAccessLevel;
  scopes?: string[] | null;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}
interface IssuedApiKey extends ApiKeyRow { key: string }
interface Branch { id: string; name: string; isActive?: boolean }

const errText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : m ?? fallback;
};

const scopeTitle = (s: string) => SCOPES.find((x) => x.id === s)?.title ?? s;

export default function ApiKeysPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const apiAccess: ApiAccessLevel = planFeaturesFor(user?.planCode).apiAccess;
  const isOwner = user?.role === 'BUSINESS_OWNER';
  const allowed = isOwner && apiAccess !== 'none';
  const canDraft = apiAccess === 'readwrite';

  const [kind, setKind] = useState<'aiba' | 'plain'>('aiba');
  const [label, setLabel] = useState('AIBA');
  const [scopes, setScopes] = useState<Scope[]>(SCOPES.map((s) => s.id));
  // A read-only plan cannot give a draft permission; the plan may load after the first render.
  const granted = scopes.filter((s) => canDraft || !SCOPES.find((x) => x.id === s)?.draft);
  const [accessLevel, setAccessLevel] = useState<ApiAccessLevel>('read');
  const [issued, setIssued] = useState<IssuedApiKey | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: keys, isLoading, isError, error, refetch } = useQuery<ApiKeyRow[]>({
    queryKey: ['api-keys'],
    queryFn: () => api.get<ApiKeyRow[]>('/api-keys').then((r) => r.data),
    enabled: allowed,
  });
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api.get<Branch[]>('/tenant/branches').then((r) => r.data),
    enabled: allowed,
    staleTime: 300_000,
  });
  const activeBranches = branches.filter((b) => b.isActive !== false);

  const create = useMutation({
    mutationFn: () =>
      api.post<IssuedApiKey>('/api-keys', kind === 'aiba'
        ? { label: label.trim(), scopes: granted }
        : { label: label.trim(), accessLevel }).then((r) => r.data),
    onSuccess: (data) => {
      setIssued(data);
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e: any) => toast.error(errText(e, 'Could not issue the key.')),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['api-keys'] }); toast.success('Key revoked. It stops working within a minute.'); },
    onError: (e: any) => toast.error(errText(e, 'Could not revoke the key.')),
  });

  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => toast.error('Could not copy. Select the text and copy it by hand.'));
  };

  const toggle = (s: Scope) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const canIssue = !!label.trim() && (kind === 'plain' || granted.length > 0) && !create.isPending;

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        {/* router.back(), never a push to /settings: pushing traps Back in a two-page loop. */}
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) router.back();
            else router.push('/settings');
          }}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1"
        >
          <ChevronLeft className="h-3 w-3" /> Settings
        </button>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <KeyRound className="h-5 w-5" style={{ color: 'var(--accent)' }} />
          API keys
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Keys let AIBA or another tool read this shop or leave drafts for you. A key never posts, approves or deletes.
        </p>
      </div>

      <div className="flex-1 p-4 sm:p-6 max-w-3xl space-y-6">
        {!isOwner ? (
          <div className="rounded-xl border border-border bg-card p-4 flex gap-3">
            <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">Only the owner can issue or revoke API keys.</p>
          </div>
        ) : apiAccess === 'none' ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-foreground">API keys are not on this shop&apos;s plan.</p>
          </div>
        ) : (
          <>
            {/* Issue a key */}
            <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4">
              <h2 className="text-sm font-semibold">Issue a key</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={`rounded-lg border p-3 cursor-pointer ${kind === 'aiba' ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-border'}`}>
                  <input type="radio" name="kind" className="mr-2" checked={kind === 'aiba'}
                    onChange={() => { setKind('aiba'); if (!label.trim()) setLabel('AIBA'); }} />
                  <span className="text-sm font-medium">For AIBA</span>
                  <p className="text-xs text-muted-foreground mt-1">Pick exactly what it may read or draft.</p>
                </label>
                <label className={`rounded-lg border p-3 cursor-pointer ${kind === 'plain' ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-border'}`}>
                  <input type="radio" name="kind" className="mr-2" checked={kind === 'plain'} onChange={() => setKind('plain')} />
                  <span className="text-sm font-medium">For another tool</span>
                  <p className="text-xs text-muted-foreground mt-1">Orders and imports, read or read and write.</p>
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium">Label</span>
                <input
                  type="text"
                  value={label}
                  maxLength={60}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={kind === 'aiba' ? 'AIBA' : "e.g. Maria's bookkeeper"}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                <span className="text-xs text-muted-foreground">The audit trail shows this name on everything the key drafts.</span>
              </label>

              {kind === 'aiba' ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium mb-1">What it may do</legend>
                  {SCOPES.map((s) => {
                    const off = s.draft && !canDraft;
                    return (
                      <label key={s.id} className={`flex gap-3 rounded-lg border border-border p-3 ${off ? 'opacity-50' : 'cursor-pointer hover:bg-muted/40'}`}>
                        <input type="checkbox" className="mt-0.5" disabled={off}
                          checked={scopes.includes(s.id) && !off} onChange={() => toggle(s.id)} />
                        <span>
                          <span className="text-sm font-medium">{s.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {s.desc}{off ? ' Not on this plan (read only).' : ''}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : (
                <label className="block">
                  <span className="text-sm font-medium">Access</span>
                  <select
                    value={accessLevel}
                    onChange={(e) => setAccessLevel(e.target.value as ApiAccessLevel)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="read">Read only</option>
                    {canDraft && <option value="readwrite">Read and write</option>}
                  </select>
                </label>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!canIssue}
                  onClick={() => create.mutate()}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {create.isPending ? 'Issuing...' : 'Issue key'}
                </button>
              </div>
            </section>

            {/* Branch ids: AIBA asks for the branch it works on. */}
            <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <h2 className="text-sm font-semibold">Branch ids</h2>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">AIBA asks for the id of the branch it reads and drafts for.</p>
              {activeBranches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No branches found.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {activeBranches.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 py-2">
                      <span className="text-sm flex-1 min-w-0 truncate">{b.name}</span>
                      <code className="font-mono text-xs text-muted-foreground break-all">{b.id}</code>
                      <button type="button" onClick={() => copy(b.id, `b:${b.id}`)}
                        className="rounded-md border border-border p-1.5 hover:bg-muted" aria-label={`Copy the id of ${b.name}`}>
                        {copied === `b:${b.id}` ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Keys */}
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Keys</h2>
              {isError ? (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 flex items-center gap-3">
                  <p className="text-sm flex-1">{errText(error, 'Could not load the keys.')}</p>
                  <button type="button" onClick={() => refetch()} className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted">Try again</button>
                </div>
              ) : isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading keys...</div>
              ) : !keys?.length ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No keys yet.</div>
              ) : (
                <ul className="space-y-2">
                  {keys.map((k) => (
                    <li key={k.id} className="rounded-xl border border-border bg-card p-3 flex gap-3 items-start">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{k.label}</span>
                          <code className="font-mono text-xs text-muted-foreground">{k.keyPrefix}...</code>
                          {k.isActive
                            ? <span className="text-xs text-emerald-600">Active</span>
                            : <span className="text-xs text-muted-foreground">Revoked</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {k.scopes?.length
                            ? k.scopes.map(scopeTitle).join(', ')
                            : k.accessLevel === 'readwrite' ? 'Orders and imports: read and write' : 'Orders and imports: read only'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Last used {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('en-PH') : 'never'}
                          {k.expiresAt ? `, expires ${new Date(k.expiresAt).toLocaleDateString('en-PH')}` : ''}
                        </p>
                      </div>
                      {k.isActive && (
                        <button
                          type="button"
                          onClick={() => { if (confirm(`Revoke "${k.label}"? Whatever uses it stops working. This cannot be undone.`)) revoke.mutate(k.id); }}
                          className="rounded-md p-1.5 text-red-600 hover:bg-red-500/10"
                          aria-label={`Revoke ${k.label}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {/* Shown once */}
      {issued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold">Your new key: {issued.label}</h2>
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>Copy it now and put it straight where it is used. Clerque will not show it again. Do not send it in a chat or an email.</p>
            </div>
            <div className="flex gap-2">
              <code className="flex-1 break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">{issued.key}</code>
              <button type="button" onClick={() => copy(issued.key, 'key')} className="rounded-lg border border-border px-3 py-2 hover:bg-muted" aria-label="Copy the key">
                {copied === 'key' ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            {!!issued.scopes?.length && (
              <p className="text-xs text-muted-foreground">It may: {issued.scopes.map(scopeTitle).join(', ')}.</p>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { setIssued(null); setCopied(null); }}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
              >
                I have put the key away
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
