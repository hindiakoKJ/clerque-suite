'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ScanLine, Send, X } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BranchPicker } from '@/components/inventory/BranchPicker';
import { useInventoryBranch } from '@/hooks/inventory/useInventoryBranch';
import { listRollCalls, sendRollCall } from '@/lib/inventory/tag-api';
import {
  addRollCallNumbers, apiErrorText, manilaTime, type RollCallRecord, type RollCallSent,
} from '@/lib/inventory/tags';
import { OWNER_ROLES } from '../inventory-nav';

/**
 * Roll call: walk the shelves and scan (or type) every tag found, then send.
 *
 * It is blind on purpose. Staff never see the list of what should be there,
 * so a missing part cannot be covered by typing its number; only the owner
 * gets what is missing, in the bell and below, with when each part was last
 * found. The numbers so far are kept on this device, so a long count survives
 * a reload or a dropped connection.
 */
const draftKey = (branchId: string) => `inventory-roll-call:${branchId}`;

function readDraft(branchId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(draftKey(branchId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
function writeDraft(branchId: string, list: string[]) {
  try {
    if (list.length) localStorage.setItem(draftKey(branchId), JSON.stringify(list));
    else localStorage.removeItem(draftKey(branchId));
  } catch { /* the count still works, it just will not survive a reload */ }
}

export default function RollCallPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isOwner = !!user && OWNER_ROLES.includes(user.role);
  const { branchId, branchName } = useInventoryBranch();

  const [code, setCode]       = useState('');
  const [list, setList]       = useState<string[]>([]);
  const [note, setNote]       = useState('');
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState('');
  const [sent, setSent]       = useState<RollCallSent | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Each branch keeps its own count in progress.
  useEffect(() => {
    if (!branchId) return;
    setList(readDraft(branchId));
    setSent(null);
    setConfirm(false);
  }, [branchId]);

  function add(raw: string = code) {
    if (!branchId) return;
    const r = addRollCallNumbers(list, raw);
    setList(r.list);
    writeDraft(branchId, r.list);
    setNote(r.rejected.length ? `Not a tag number: ${r.rejected.join(', ')}` : '');
    setCode('');
    setSent(null);
    setConfirm(false);
    inputRef.current?.focus();
  }

  function remove(n: string) {
    if (!branchId) return;
    const next = list.filter((x) => x !== n);
    setList(next);
    writeDraft(branchId, next);
    setConfirm(false);
  }

  async function send() {
    if (!branchId || list.length === 0) return;
    setSending(true);
    setError('');
    try {
      const r = await sendRollCall(branchId, list);
      setSent(r);
      setList([]);
      writeDraft(branchId, []);
      setConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['tag-roll-calls'] });
    } catch (e) {
      // The numbers stay on the device: nothing is lost, send again.
      setError(apiErrorText(e, 'The count was not sent. Your numbers are kept; try again.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Roll call</h2>
          <p className="text-sm text-muted-foreground">
            Scan or type the number on every tagged part you find{branchName ? ` at ${branchName}` : ''}, then send.
          </p>
        </div>
        <BranchPicker />
      </div>

      {!branchId ? (
        <p className="text-sm text-muted-foreground">Pick the branch you are counting.</p>
      ) : (
        <>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <div className="relative flex-1">
              <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                inputMode="numeric"
                placeholder="e.g. 000457"
                aria-label="Tag number found"
                className="h-14 pl-10 font-mono text-xl font-semibold"
              />
            </div>
            <Button type="submit" disabled={!code.trim()} className="h-14 px-6 text-base">Add</Button>
          </form>
          {note && <p className="text-sm font-medium text-amber-700 dark:text-amber-300" role="status">{note}</p>}

          <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-base font-semibold">{list.length} part{list.length === 1 ? '' : 's'} found so far</p>
              {list.length > 0 && !confirm && (
                <Button onClick={() => setConfirm(true)} className="h-11 px-5">
                  <Send className="h-4 w-4" /> Send the count
                </Button>
              )}
            </div>
            {confirm && (
              <div className="space-y-2 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-3">
                <p className="text-sm font-medium">
                  Send {list.length} number{list.length === 1 ? '' : 's'} as the full count{branchName ? ` for ${branchName}` : ''}?
                  Any part not on this list is counted as not found.
                </p>
                <div className="flex gap-2">
                  <Button onClick={() => void send()} disabled={sending} className="h-11 px-5">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Yes, send'}
                  </Button>
                  <Button variant="outline" onClick={() => setConfirm(false)} disabled={sending} className="h-11 px-5">Keep counting</Button>
                </div>
              </div>
            )}
            {error && <p className="text-sm font-medium text-red-700 dark:text-red-300" role="alert">{error}</p>}
            {list.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {list.map((n) => (
                  <li key={n} className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 py-1 pl-3 pr-1 font-mono text-sm font-semibold">
                    {n}
                    <button type="button" onClick={() => remove(n)} aria-label={`Remove ${n}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {sent && (
            <section className="space-y-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4" role="status">
              <p className="flex items-center gap-2 text-base font-semibold text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="h-5 w-5" /> Count sent: {sent.received} number{sent.received === 1 ? '' : 's'}.
              </p>
              {sent.result ? (
                <RollCallSummary
                  foundCount={sent.result.found.length}
                  missing={sent.result.missing}
                  unexpected={sent.result.unexpected}
                />
              ) : (
                <p className="text-sm text-muted-foreground">The owner has the result. Thank you.</p>
              )}
            </section>
          )}

          {isOwner && <PastRollCalls branchId={branchId} />}
        </>
      )}
    </div>
  );
}

function RollCallSummary({ foundCount, missing, unexpected }: {
  foundCount: number;
  /** lastSeenAt comes with the past counts below; the count just sent shows without it. */
  missing: { number: string; productName: string; lastSeenAt?: string | null }[];
  unexpected: RollCallRecord['unexpected'];
}) {
  return (
    <div className="space-y-2 text-sm">
      <p>{foundCount} found where they should be. <strong>{missing.length} not found.</strong>{unexpected.length ? ` ${unexpected.length} that should not be on the shelf.` : ''}</p>
      {missing.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {missing.map((m) => (
            <li key={m.number} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
              <span><span className="font-mono font-semibold">{m.number}</span> {m.productName}</span>
              {m.lastSeenAt !== undefined && (
                <span className="text-xs text-muted-foreground">
                  {m.lastSeenAt ? `Last found ${manilaTime(m.lastSeenAt)}` : 'Not found at an earlier count'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {unexpected.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-amber-500/40 bg-amber-500/5">
          {unexpected.map((u) => (
            <li key={u.number} className="px-3 py-2">
              <span className="font-mono font-semibold">{u.number}</span> {u.why}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The owner's view: every count at this branch, newest first. */
function PastRollCalls({ branchId }: { branchId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const { data: calls = [], isLoading, isError, error } = useQuery<RollCallRecord[]>({
    queryKey: ['tag-roll-calls', branchId],
    queryFn: () => listRollCalls(branchId),
    staleTime: 30_000,
  });

  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold">Past roll calls</h3>
      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : isError ? (
        <p className="text-sm text-red-700 dark:text-red-300">{apiErrorText(error, 'Could not load the past roll calls.')}</p>
      ) : calls.length === 0 ? (
        <p className="text-sm text-muted-foreground">No roll call at this branch yet.</p>
      ) : (
        <ul className="space-y-2">
          {calls.map((c) => (
            <li key={c.countedAt} className="rounded-xl border border-border bg-card">
              <button
                type="button"
                onClick={() => setOpen(open === c.countedAt ? null : c.countedAt)}
                className="flex w-full flex-wrap items-baseline justify-between gap-x-3 px-4 py-3 text-left"
                aria-expanded={open === c.countedAt}
              >
                <span className="text-sm font-semibold">{manilaTime(c.countedAt)}{c.countedByName ? ` · ${c.countedByName}` : ''}</span>
                <span className={c.missing.length || c.unexpected.length ? 'text-sm font-semibold text-red-700 dark:text-red-300' : 'text-sm text-emerald-700 dark:text-emerald-300'}>
                  {c.missing.length ? `${c.missing.length} not found` : 'Nothing missing'}
                  {c.unexpected.length ? ` · ${c.unexpected.length} should not be there` : ''} · {c.foundCount} found
                </span>
              </button>
              {open === c.countedAt && (c.missing.length > 0 || c.unexpected.length > 0) && (
                <div className="border-t border-border p-3">
                  <RollCallSummary foundCount={c.foundCount} missing={c.missing} unexpected={c.unexpected} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
